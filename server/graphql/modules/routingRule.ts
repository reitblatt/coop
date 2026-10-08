import { type ConditionSet } from '../../services/moderationConfigService/index.js';
import { UserPermission } from '../../services/userManagementService/index.js';
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
  type GQLRoutingRuleResolvers,
} from '../generated.js';
import { type Context } from '../resolvers.js';
import { forbiddenError, unauthenticatedError } from '../utils/errors.js';
import { gqlErrorResult, gqlSuccessResult } from '../utils/gqlResult.js';

const typeDefs = /* GraphQL */ `
  type RoutingRule {
    id: ID!
    name: String!
    creatorId: String!
    description: String
    itemTypes: [ItemType!]!
    status: RoutingRuleStatus!
    conditionSet: ConditionSet!
    destinationQueue: ManualReviewQueue!
  }

  enum RoutingRuleStatus {
    LIVE
  }

  input CreateRoutingRuleInput {
    name: String!
    description: String
    status: RoutingRuleStatus!
    itemTypeIds: [ID!]!
    conditionSet: ConditionSetInput!
    destinationQueueId: ID!
    sequenceNumber: Int
    isAppealsRule: Boolean
  }

  input UpdateRoutingRuleInput {
    id: ID!
    name: String
    description: String
    status: RoutingRuleStatus
    itemTypeIds: [ID!]
    conditionSet: ConditionSetInput
    destinationQueueId: ID
    sequenceNumber: Int
    isAppealsRule: Boolean
  }

  input ReorderRoutingRulesInput {
    order: [ID!]!
    isAppealsRule: Boolean
  }

  input DeleteRoutingRuleInput {
    id: ID!
    isAppealsRule: Boolean
  }

  type RoutingRuleNameExistsError implements Error {
    title: String!
    status: Int!
    type: [String!]!
    pointer: String
    detail: String
    requestId: String
  }

  type QueueDoesNotExistError implements Error {
    title: String!
    status: Int!
    type: [String!]!
    pointer: String
    detail: String
    requestId: String
  }

  type MutateRoutingRuleSuccessResponse {
    data: RoutingRule!
  }

  type MutateRoutingRulesOrderSuccessResponse {
    data: [RoutingRule!]!
  }

  union CreateRoutingRuleResponse =
    | MutateRoutingRuleSuccessResponse
    | RoutingRuleNameExistsError
    | QueueDoesNotExistError

  union UpdateRoutingRuleResponse =
    | MutateRoutingRuleSuccessResponse
    | RoutingRuleNameExistsError
    | NotFoundError
    | QueueDoesNotExistError

  union ReorderRoutingRulesResponse = MutateRoutingRulesOrderSuccessResponse

  type Mutation {
    createRoutingRule(
      input: CreateRoutingRuleInput!
    ): CreateRoutingRuleResponse!
    updateRoutingRule(
      input: UpdateRoutingRuleInput!
    ): UpdateRoutingRuleResponse!
    deleteRoutingRule(input: DeleteRoutingRuleInput!): Boolean!
    reorderRoutingRules(
      input: ReorderRoutingRulesInput!
    ): ReorderRoutingRulesResponse!
  }
`;

const RoutingRule: GQLRoutingRuleResolvers = {
  async destinationQueue(routingRule, _, context) {
    const user = context.getUser();
    if (!user || user.orgId !== routingRule.orgId) {
      throw unauthenticatedError('User required');
    }

    const userCanEditMRTQueues = user
      .getPermissions()
      .includes(UserPermission.EDIT_MRT_QUEUES);

    const queueSelector = {
      orgId: user.orgId,
      queueId: routingRule.destinationQueueId,
    };

    const queue = userCanEditMRTQueues
      ? await context.services.ManualReviewToolService.getQueueForOrgAndDangerouslyBypassPermissioning(
          queueSelector,
        )
      : await context.services.ManualReviewToolService.getQueueForOrg({
          userId: user.id,
          ...queueSelector,
        });

    // Assume the queue won't be missing, as the db requires routing rules to
    // point to existing queues -- although technically the queue could've been
    // deleted between loading the rule and querying for the queue.
    return queue!;
  },
  async itemTypes(routingRule, _, context) {
    const user = context.getUser();
    if (!user || user.orgId !== routingRule.orgId) {
      throw unauthenticatedError('User required');
    }

    const itemTypes =
      await context.services.ModerationConfigService.getItemTypes({
        orgId: user.orgId,
      });

    return itemTypes.filter((itemType) =>
      routingRule.itemTypeIds.includes(itemType.id),
    );
  },
};

/**
 * Checks that, after an update, every condition's signal can accept its input.
 * This is the rule as it will be after the update, so whichever of the
 * condition set and item types isn't being sent falls back to the stored one.
 */
async function validateUpdatedRoutingRule(
  context: Context,
  opts: {
    id: string;
    orgId: string;
    conditionSet: ConditionSet | undefined;
    itemTypeIds: readonly string[] | null | undefined;
  },
) {
  const { id, orgId, conditionSet, itemTypeIds } = opts;
  if (!conditionSet && !itemTypeIds) {
    return;
  }

  const stored = (
    await context.services.ManualReviewToolService.getRoutingRules({ orgId })
  ).find((it) => it.id === id);
  const effectiveConditionSet = conditionSet ?? stored?.conditionSet;
  const effectiveItemTypeIds = itemTypeIds ?? stored?.itemTypeIds;
  // If the rule doesn't exist, the update itself reports that.
  if (!effectiveConditionSet || !effectiveItemTypeIds) {
    return;
  }

  await validateRuleSignalInputs(
    {
      signalsService: context.services.SignalsService,
      moderationConfigService: context.services.ModerationConfigService,
    },
    {
      orgId,
      ruleKind: 'ROUTING',
      conditionSet: effectiveConditionSet,
      itemTypeIds: effectiveItemTypeIds,
    },
  );
}

const Query: GQLQueryResolvers = {};

const Mutation: GQLMutationResolvers = {
  async createRoutingRule(_, params, context) {
    const user = context.getUser();
    const { itemTypeIds } = params.input;

    if (user == null) {
      throw unauthenticatedError('User required.');
    }
    if (!user.getPermissions().includes(UserPermission.MANAGE_ROUTING_RULES)) {
      throw forbiddenError(
        'User does not have permission to manage routing rules',
      );
    }

    if (!itemTypeIdsAreValid(itemTypeIds)) {
      throw new Error('itemTypeIds must be a non-empty array');
    }

    const conditionSet = transformConditionForDB(params.input.conditionSet);
    await validateRuleSignalInputs(
      {
        signalsService: context.services.SignalsService,
        moderationConfigService: context.services.ModerationConfigService,
      },
      {
        orgId: user.orgId,
        ruleKind: 'ROUTING',
        conditionSet,
        itemTypeIds,
      },
    );

    try {
      const routingRule =
        await context.services.ManualReviewToolService.createRoutingRule({
          ...params.input,
          itemTypeIds,
          orgId: user.orgId,
          creatorId: user.id,
          conditionSet,
          isAppealsRule: params.input.isAppealsRule ?? false,
        });

      return gqlSuccessResult(
        { data: routingRule },
        'MutateRoutingRuleSuccessResponse',
      );
    } catch (e: unknown) {
      if (
        isCoopErrorOfType(e, [
          'RoutingRuleNameExistsError',
          'QueueDoesNotExistError',
        ])
      ) {
        return gqlErrorResult(e);
      }

      throw e;
    }
  },
  async updateRoutingRule(_, params, context) {
    const user = context.getUser();
    const { itemTypeIds } = params.input;
    if (user == null) {
      throw unauthenticatedError('User required.');
    }
    if (!user.getPermissions().includes(UserPermission.MANAGE_ROUTING_RULES)) {
      throw forbiddenError(
        'User does not have permission to manage routing rules',
      );
    }

    if (itemTypeIds && !itemTypeIdsAreValid(itemTypeIds)) {
      throw new Error('itemTypeIds must be a non-empty array');
    }

    const conditionSet = params.input.conditionSet
      ? transformConditionForDB(params.input.conditionSet)
      : undefined;
    await validateUpdatedRoutingRule(context, {
      id: params.input.id,
      orgId: user.orgId,
      conditionSet,
      itemTypeIds,
    });

    try {
      const routingRule =
        await context.services.ManualReviewToolService.updateRoutingRule({
          id: params.input.id,
          orgId: user.orgId,
          name: params.input.name ?? undefined,
          description: params.input.description ?? undefined,
          status: params.input.status ?? undefined,
          itemTypeIds: itemTypeIds ?? undefined,
          destinationQueueId: params.input.destinationQueueId ?? undefined,
          conditionSet,
          sequenceNumber: params.input.sequenceNumber ?? undefined,
          isAppealsRule: params.input.isAppealsRule ?? false,
        });

      return gqlSuccessResult(
        { data: routingRule },
        'MutateRoutingRuleSuccessResponse',
      );
    } catch (e: unknown) {
      if (
        isCoopErrorOfType(e, [
          'RoutingRuleNameExistsError',
          'NotFoundError',
          'QueueDoesNotExistError',
        ])
      ) {
        return gqlErrorResult(e);
      }

      throw e;
    }
  },
  async deleteRoutingRule(_, params, context) {
    const user = context.getUser();
    if (user == null) {
      throw unauthenticatedError('User required.');
    }
    if (!user.getPermissions().includes(UserPermission.MANAGE_ROUTING_RULES)) {
      throw forbiddenError(
        'User does not have permission to manage routing rules',
      );
    }

    return context.services.ManualReviewToolService.deleteRoutingRule({
      id: params.input.id,
      orgId: user.orgId,
      isAppealsRule: params.input.isAppealsRule ?? false,
    });
  },
  async reorderRoutingRules(_, params, context) {
    const user = context.getUser();
    if (user == null) {
      throw unauthenticatedError('User required.');
    }
    if (!user.getPermissions().includes(UserPermission.MANAGE_ROUTING_RULES)) {
      throw forbiddenError(
        'User does not have permission to manage routing rules',
      );
    }

    const { order } = params.input;
    const reorderedRules =
      await context.services.ManualReviewToolService.reorderRoutingRules({
        orgId: user.orgId,
        order,
        isAppealsRule: params.input.isAppealsRule ?? false,
      });

    return gqlSuccessResult(
      { data: reorderedRules },
      'MutateRoutingRulesOrderSuccessResponse',
    );
  },
};

const resolvers = {
  RoutingRule,
  Query,
  Mutation,
};

export { typeDefs, resolvers };

function itemTypeIdsAreValid(
  arr: readonly string[],
): arr is NonEmptyArray<NonEmptyString> {
  return isNonEmptyArray(arr) && arr.every(isNonEmptyString);
}
