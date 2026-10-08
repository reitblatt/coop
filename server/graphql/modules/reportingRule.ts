import { isCoopErrorOfType } from '../../utils/errors.js';
import {
  isNonEmptyArray,
  isNonEmptyString,
  type NonEmptyArray,
  type NonEmptyString,
} from '../../utils/typescript-types.js';
import { transformConditionForDB } from '../datasources/RuleApi.js';
import { validateRuleSignalInputs } from '../datasources/ruleSignalInputValidation.js';
import {
  type GQLMutationResolvers,
  type GQLQueryResolvers,
  type GQLReportingRuleResolvers,
} from '../generated.js';
import { unauthenticatedError } from '../utils/errors.js';
import { gqlErrorResult, gqlSuccessResult } from '../utils/gqlResult.js';

const typeDefs = /* GraphQL */ `
  enum ReportingRuleStatus {
    BACKGROUND
    DRAFT
    LIVE
    ARCHIVED
  }

  type ReportingRule {
    id: ID!
    orgId: ID!
    name: String!
    description: String
    status: ReportingRuleStatus!
    creator: User
    conditionSet: ConditionSet!
    itemTypes: [ItemType!]!
    actions: [Action!]!
    policies: [Policy!]!
    insights: ReportingRuleInsights!
  }

  input CreateReportingRuleInput {
    name: String!
    description: String
    status: ReportingRuleStatus!
    conditionSet: ConditionSetInput!
    itemTypeIds: [ID!]!
    actionIds: [ID!]!
    policyIds: [ID!]!
  }

  input UpdateReportingRuleInput {
    id: ID!
    name: String
    description: String
    status: ReportingRuleStatus
    conditionSet: ConditionSetInput
    itemTypeIds: [ID!]
    actionIds: [ID!]
    policyIds: [ID!]
  }

  type ReportingRuleNameExistsError implements Error {
    title: String!
    status: Int!
    type: [String!]!
    pointer: String
    detail: String
    requestId: String
  }

  union CreateReportingRuleResponse =
    | MutateReportingRuleSuccessResponse
    | ReportingRuleNameExistsError

  union UpdateReportingRuleResponse =
    | MutateReportingRuleSuccessResponse
    | ReportingRuleNameExistsError
    | NotFoundError

  type MutateReportingRuleSuccessResponse {
    data: ReportingRule!
  }

  type Query {
    reportingRule(id: ID!): ReportingRule
  }

  type Mutation {
    createReportingRule(
      input: CreateReportingRuleInput!
    ): CreateReportingRuleResponse!
    updateReportingRule(
      input: UpdateReportingRuleInput!
    ): UpdateReportingRuleResponse!
    deleteReportingRule(id: ID!): Boolean!
  }
`;

const ReportingRule: GQLReportingRuleResolvers = {
  async creator(reportingRule, _, { dataSources, getUser }) {
    const user = getUser();
    if (!user || user.orgId !== reportingRule.orgId) {
      throw unauthenticatedError('User required');
    }
    if (!reportingRule.creatorId) {
      return null;
    }

    const { orgId } = user;
    return dataSources.userAPI.getGraphQLUserFromId({
      id: reportingRule.creatorId,
      orgId,
    });
  },
  async itemTypes(reportingRule, _, { services, getUser }) {
    const user = getUser();
    if (!user || user.orgId !== reportingRule.orgId) {
      throw unauthenticatedError('User required');
    }

    const itemTypes = await services.ModerationConfigService.getItemTypes({
      orgId: user.orgId,
    });

    return itemTypes.filter((itemType) =>
      new Set(reportingRule.itemTypeIds).has(itemType.id),
    );
  },
  async actions(reportingRule, _, { dataSources, getUser }) {
    const user = getUser();
    if (user == null) {
      throw unauthenticatedError('Authenticated user required');
    }

    return dataSources.actionAPI.getGraphQLActionsFromIds(
      user.orgId,
      reportingRule.actionIds,
    );
  },
  async policies(reportingRule, _, { services, getUser }) {
    const user = getUser();
    if (user == null) {
      throw unauthenticatedError('Authenticated user required');
    }
    const { orgId } = user;

    const policies = await Promise.all(
      reportingRule.policyIds.map(async (policyId) =>
        services.ModerationConfigService.getPolicy({
          policyId,
          orgId,
        }),
      ),
    );

    return policies;
  },
  async insights(rule, _, context) {
    // just return the rule, which then becomes the parent/source for the
    // insights resolver. But verify the rule is owned by the user's org
    const user = context.getUser();
    if (user == null) {
      throw unauthenticatedError('User required');
    }

    if (rule.orgId !== user.orgId) {
      throw new Error("Rule does not belong to user's org");
    }

    return rule;
  },
};

const Query: GQLQueryResolvers = {
  async reportingRule(_, { id }, { services, getUser }) {
    const user = getUser();
    if (user == null) {
      throw unauthenticatedError('Authenticated user required');
    }

    const reportingRules = await services.ReportingService.getReportingRules({
      orgId: user.orgId,
    });
    const rule = reportingRules.find((rule) => rule.id === id);
    return rule ?? null;
  },
};

const Mutation: GQLMutationResolvers = {
  async createReportingRule(_, { input }, { services, getUser }) {
    const user = getUser();
    if (user == null) {
      throw unauthenticatedError('Authenticated user required');
    }

    const { itemTypeIds, actionIds } = input;

    if (
      !isNonEmptyArrayOfNonEmptyStrings(itemTypeIds) ||
      !isNonEmptyArrayOfNonEmptyStrings(actionIds)
    ) {
      throw new Error('itemTypeIds must be a non-empty array');
    }

    const conditionSet = transformConditionForDB(input.conditionSet);
    await validateRuleSignalInputs(
      {
        signalsService: services.SignalsService,
        moderationConfigService: services.ModerationConfigService,
      },
      { orgId: user.orgId, ruleKind: 'REPORTING', conditionSet, itemTypeIds },
    );

    try {
      const createRule = await services.ReportingService.createReportingRule({
        ...input,
        orgId: user.orgId,
        description: input.description ?? null,
        creatorId: user.id,
        itemTypeIds,
        actionIds,
        policyIds: [...input.policyIds],
        conditionSet,
      });
      return gqlSuccessResult(
        {
          data: createRule,
        },
        'MutateReportingRuleSuccessResponse',
      );
    } catch (e: unknown) {
      if (isCoopErrorOfType(e, ['ReportingRuleNameExistsError'])) {
        return gqlErrorResult(e);
      }

      throw e;
    }
  },
  async updateReportingRule(_, { input }, { services, getUser }) {
    const user = getUser();
    if (user == null) {
      throw unauthenticatedError('Authenticated user required');
    }
    const { id, name, description, status, conditionSet, policyIds } = input;

    const itemTypeIds = (() => {
      if (input.itemTypeIds == null) {
        return undefined;
      }
      if (!isNonEmptyArrayOfNonEmptyStrings(input.itemTypeIds)) {
        throw new Error('itemTypeIds must be a non-empty array');
      }
      return input.itemTypeIds;
    })();

    const actionIds = (() => {
      if (input.actionIds == null) {
        return undefined;
      }
      if (!isNonEmptyArrayOfNonEmptyStrings(input.actionIds)) {
        throw new Error('actionIds must be a non-empty array');
      }
      return input.actionIds;
    })();

    const storedConditionSet = conditionSet
      ? transformConditionForDB(conditionSet)
      : undefined;
    // Archived rules aren't run, so don't make users fix them first. For
    // anything else, check the rule as it will be after this update, falling
    // back to the stored values for whichever of the two wasn't sent.
    if (status !== 'ARCHIVED' && (storedConditionSet || itemTypeIds)) {
      const stored = (
        await services.ReportingService.getReportingRules({
          orgId: user.orgId,
        })
      ).find((it) => it.id === id);
      const effectiveConditionSet = storedConditionSet ?? stored?.conditionSet;
      const effectiveItemTypeIds = itemTypeIds ?? stored?.itemTypeIds;
      // If the rule doesn't exist, the update below reports that.
      if (effectiveConditionSet && effectiveItemTypeIds) {
        await validateRuleSignalInputs(
          {
            signalsService: services.SignalsService,
            moderationConfigService: services.ModerationConfigService,
          },
          {
            orgId: user.orgId,
            ruleKind: 'REPORTING',
            conditionSet: effectiveConditionSet,
            itemTypeIds: effectiveItemTypeIds,
          },
        );
      }
    }

    try {
      const updatedRule = await services.ReportingService.updateReportingRule({
        id,
        name: name ?? undefined,
        description: description ?? undefined,
        status: status ?? undefined,
        conditionSet: storedConditionSet,
        itemTypeIds,
        actionIds,
        policyIds: policyIds ?? undefined,
        orgId: user.orgId,
      });
      return gqlSuccessResult(
        {
          data: updatedRule,
        },
        'MutateReportingRuleSuccessResponse',
      );
    } catch (e: unknown) {
      if (isCoopErrorOfType(e, ['ReportingRuleNameExistsError'])) {
        return gqlErrorResult(e);
      }

      throw e;
    }
  },
  async deleteReportingRule(_, { id }, { services, getUser }) {
    const user = getUser();
    if (user == null) {
      throw unauthenticatedError('Authenticated user required');
    }

    return services.ReportingService.deleteReportingRule({
      orgId: user.orgId,
      id,
    });
  },
};

const resolvers = { ReportingRule, Mutation, Query };
export { typeDefs, resolvers };

function isNonEmptyArrayOfNonEmptyStrings(
  arr: readonly string[],
): arr is NonEmptyArray<NonEmptyString> {
  return isNonEmptyArray(arr) && arr.every(isNonEmptyString);
}
