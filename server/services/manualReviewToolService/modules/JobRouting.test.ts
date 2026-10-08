import { ScalarTypes } from '@roostorg/coop-types';
import { uid } from 'uid';

import { type Dependencies } from '../../../iocContainer/index.js';
import createContentItemTypes from '../../../test/fixtureHelpers/createContentItemTypes.js';
import createMrtQueue from '../../../test/fixtureHelpers/createMrtQueue.js';
import createOrg from '../../../test/fixtureHelpers/createOrg.js';
import createUser from '../../../test/fixtureHelpers/createUser.js';
import { makeTransactionalTestWithFixture } from '../../../test/harness/transactionalTest.js';
import { toCorrelationId } from '../../../utils/correlationIds.js';
import { jsonStringify } from '../../../utils/encoding.js';
import { type NonEmptyString } from '../../../utils/typescript-types.js';
import {
  makeSubmissionId,
  submissionDataToItemSubmission,
} from '../../itemProcessingService/makeItemSubmission.js';
import { itemSubmissionToItemSubmissionWithTypeIdentifier } from '../../itemProcessingService/makeItemSubmissionWithTypeIdentifier.js';
import { toNormalizedItemDataOrErrors } from '../../itemProcessingService/toNormalizedItemDataOrErrors.js';
import {
  CoopInput,
  type ItemType,
} from '../../moderationConfigService/index.js';
import { type ReportContext } from '../../reportingService/index.js';
import { SignalType } from '../../signalsService/index.js';
import { UserPermission } from '../../userManagementService/index.js';

describe('JobRouting tests', () => {
  const jobRoutingTestWithFixtures = makeTransactionalTestWithFixture(
    async ({ deps }) => {
      const manualReviewToolService = deps.ManualReviewToolService;
      const { org } = await createOrg(
        {
          KyselyPg: deps.KyselyPg,
          ModerationConfigService: deps.ModerationConfigService,
          ApiKeyService: deps.ApiKeyService,
        },
        uid(),
      );
      const { user } = await createUser(deps.KyselyPg, org.id);
      const userId = user.id;
      const { itemTypes } = await createContentItemTypes({
        moderationConfigService: deps.ModerationConfigService,
        orgId: org.id,
        extra: {
          fields: [
            {
              name: 'text',
              type: ScalarTypes.STRING,
              required: false,
              container: null,
            },
          ],
        },
      });
      const itemType = itemTypes[0];

      const defaultQueue =
        await manualReviewToolService.createManualReviewQueue({
          name: 'Default Queue',
          description: null,
          userIds: [userId],
          hiddenActionIds: [],
          isAppealsQueue: false,
          invokedBy: {
            userId,
            permissions: [UserPermission.EDIT_MRT_QUEUES],
            orgId: org.id,
          },
        });
      const anotherQueue =
        await manualReviewToolService.createManualReviewQueue({
          name: 'Another Queue',
          description: null,
          userIds: [userId],
          hiddenActionIds: [],
          isAppealsQueue: false,
          invokedBy: {
            userId,
            permissions: [UserPermission.EDIT_MRT_QUEUES],
            orgId: org.id,
          },
        });
      const policyQueue = await manualReviewToolService.createManualReviewQueue(
        {
          name: 'Policy Queue',
          description: null,
          userIds: [userId],
          hiddenActionIds: [],
          isAppealsQueue: false,
          invokedBy: {
            userId,
            permissions: [UserPermission.EDIT_MRT_QUEUES],
            orgId: org.id,
          },
        },
      );
      const noPolicyQueue =
        await manualReviewToolService.createManualReviewQueue({
          name: 'No Policy Queue',
          description: null,
          userIds: [userId],
          hiddenActionIds: [],
          isAppealsQueue: false,
          invokedBy: {
            userId,
            permissions: [UserPermission.EDIT_MRT_QUEUES],
            orgId: org.id,
          },
        });

      await manualReviewToolService.createRoutingRule({
        orgId: org.id,
        name: 'Some rule',
        status: 'LIVE',
        itemTypeIds: [itemType.id as NonEmptyString],
        creatorId: '',
        conditionSet: {
          conjunction: 'AND',
          conditions: [
            {
              input: {
                type: 'CONTENT_FIELD',
                name: 'text',
                contentTypeId: itemType.id,
              },
              signal: {
                id: jsonStringify({
                  type: SignalType.TEXT_MATCHING_CONTAINS_TEXT,
                }),
                type: SignalType.TEXT_MATCHING_CONTAINS_TEXT,
              },
              matchingValues: { strings: ['test'] },
            },
          ],
        },
        destinationQueueId: anotherQueue.id,
      });

      await manualReviewToolService.createRoutingRule({
        orgId: org.id,
        name: 'Policy ID rule',
        status: 'LIVE',
        itemTypeIds: [itemType.id as NonEmptyString],
        creatorId: '',
        conditionSet: {
          conjunction: 'OR',
          conditions: [
            {
              input: {
                type: 'CONTENT_COOP_INPUT',
                name: 'Relevant Policy',
              },
              threshold: 'testPolicyId',
              comparator: 'EQUALS',
            },
          ],
        },
        destinationQueueId: policyQueue.id,
      });

      await manualReviewToolService.createRoutingRule({
        orgId: org.id,
        name: 'Policy ID not provided rule',
        status: 'LIVE',
        itemTypeIds: [itemType.id as NonEmptyString],
        creatorId: '',
        conditionSet: {
          conditions: [
            {
              input: {
                type: 'CONTENT_COOP_INPUT',
                name: 'Relevant Policy',
              },
              comparator: 'IS_NOT_PROVIDED',
            },
            {
              input: {
                type: 'CONTENT_FIELD',
                contentTypeId: itemType.id,
                name: 'text',
              },
              signal: {
                id: jsonStringify({
                  type: SignalType.TEXT_MATCHING_CONTAINS_TEXT,
                }),
                type: SignalType.TEXT_MATCHING_CONTAINS_TEXT,
              },
              matchingValues: { strings: ['garbage'] },
            },
          ],
          conjunction: 'AND',
        },
        destinationQueueId: noPolicyQueue.id,
      });

      await manualReviewToolService.createRoutingRule({
        orgId: org.id,
        name: 'Source Type rule',
        status: 'LIVE',
        itemTypeIds: [itemType.id as NonEmptyString],
        creatorId: '',
        conditionSet: {
          conjunction: 'OR',
          conditions: [
            {
              input: {
                type: 'CONTENT_COOP_INPUT',
                name: 'Source',
              },
              threshold: 'post-actions',
              comparator: 'EQUALS',
            },
          ],
        },
        destinationQueueId: anotherQueue.id,
      });

      return {
        manualReviewToolService,
        org,
        itemType,
        defaultQueue,
        anotherQueue,
        policyQueue,
        noPolicyQueue,
      };
    },
  );

  jobRoutingTestWithFixtures(
    "reorderRoutingRules does not change another organization's routing rules",
    async ({ manualReviewToolService, org, deps }) => {
      const { org: otherOrg } = await createOrg(
        {
          KyselyPg: deps.KyselyPg,
          ModerationConfigService: deps.ModerationConfigService,
          ApiKeyService: deps.ApiKeyService,
        },
        uid(),
      );
      const { user: otherUser } = await createUser(deps.KyselyPg, otherOrg.id);
      const { itemTypes: otherItemTypes } = await createContentItemTypes({
        moderationConfigService: deps.ModerationConfigService,
        orgId: otherOrg.id,
        extra: {
          fields: [
            {
              name: 'text',
              type: ScalarTypes.STRING,
              required: false,
              container: null,
            },
          ],
        },
      });
      const { queue: otherQueue } = await createMrtQueue({
        orgId: otherOrg.id,
        mrtService: manualReviewToolService,
        userId: otherUser.id,
      });

      for (const name of ['Other org rule 1', 'Other org rule 2']) {
        await manualReviewToolService.createRoutingRule({
          orgId: otherOrg.id,
          name,
          status: 'LIVE',
          itemTypeIds: [otherItemTypes[0].id as NonEmptyString],
          creatorId: '',
          conditionSet: {
            conjunction: 'OR',
            conditions: [
              {
                input: {
                  type: 'CONTENT_COOP_INPUT',
                  name: 'Source',
                },
                threshold: 'post-actions',
                comparator: 'EQUALS',
              },
            ],
          },
          destinationQueueId: otherQueue.id,
        });
      }

      const getPersistedRoutingRuleOrder = async (orgId: string) =>
        (
          await deps.KyselyPg.selectFrom('manual_review_tool.routing_rules')
            .select('id')
            .where('org_id', '=', orgId)
            .orderBy('sequence_number')
            .execute()
        ).map((rule) => rule.id);

      const otherOrgOrder = await getPersistedRoutingRuleOrder(otherOrg.id);
      const order = await getPersistedRoutingRuleOrder(org.id);
      const expectedOrder = order.slice().reverse();

      const reorderedRules = await manualReviewToolService.reorderRoutingRules({
        orgId: org.id,
        order: expectedOrder,
      });

      expect(reorderedRules.map((rule) => rule.id)).toEqual(expectedOrder);
      await expect(getPersistedRoutingRuleOrder(otherOrg.id)).resolves.toEqual(
        otherOrgOrder,
      );
    },
    10_000,
  );

  jobRoutingTestWithFixtures(
    'Should enqueue based off of routing rule',
    async ({ manualReviewToolService, org, itemType, anotherQueue }) => {
      const normalizedDataOrError = toNormalizedItemDataOrErrors(
        [itemType.id],
        itemType,
        { text: 'test' },
      );
      if (Array.isArray(normalizedDataOrError)) {
        throw new Error('Error validating item data');
      }

      const itemSubmission = await submissionDataToItemSubmission(
        async () => itemType,
        {
          orgId: org.id,
          submissionId: makeSubmissionId(),
          itemId: uid(),
          itemTypeId: itemType.id,
          itemTypeVersion: '',
          itemTypeSchemaVariant: 'original',
          data: normalizedDataOrError,
          creatorId: null,
          creatorTypeId: null,
        },
      );
      if (itemSubmission instanceof Error) {
        throw new Error('Error creating item submission');
      }

      const item =
        itemSubmissionToItemSubmissionWithTypeIdentifier(itemSubmission);
      await manualReviewToolService.enqueue({
        enqueueSource: 'RULE_EXECUTION',
        enqueueSourceInfo: { kind: 'RULE_EXECUTION', rules: ['abc'] },
        createdAt: new Date(),
        orgId: org.id,
        correlationId: toCorrelationId({ type: 'submit-report', id: uid() }),
        policyIds: [],
        payload: {
          kind: 'DEFAULT',
          reportHistory: [],
          item,
        },
      });

      const pendingJobCount = await manualReviewToolService.getPendingJobCount({
        orgId: org.id,
        queueId: anotherQueue.id,
      });
      expect(pendingJobCount).toBe(1);
    },
  );

  jobRoutingTestWithFixtures(
    'Should match on policy rule',
    async ({ manualReviewToolService, org, itemType, policyQueue }) => {
      const normalizedDataOrError = toNormalizedItemDataOrErrors(
        [itemType.id],
        itemType,
        { text: '12345' },
      );
      if (Array.isArray(normalizedDataOrError)) {
        throw new Error('Error validating item data');
      }

      const itemSubmission = await submissionDataToItemSubmission(
        async () => itemType,
        {
          orgId: org.id,
          submissionId: makeSubmissionId(),
          itemId: uid(),
          itemTypeId: itemType.id,
          itemTypeVersion: '',
          itemTypeSchemaVariant: 'original',
          data: normalizedDataOrError,
          creatorId: null,
          creatorTypeId: null,
        },
      );
      if (itemSubmission instanceof Error) {
        throw new Error('Error creating item submission');
      }

      const item =
        itemSubmissionToItemSubmissionWithTypeIdentifier(itemSubmission);
      await manualReviewToolService.enqueue({
        enqueueSource: 'RULE_EXECUTION',
        enqueueSourceInfo: { kind: 'RULE_EXECUTION', rules: ['abc'] },
        createdAt: new Date(),
        orgId: org.id,
        correlationId: toCorrelationId({ type: 'submit-report', id: uid() }),
        policyIds: ['testPolicyId', 'testPolicyId2'],
        payload: {
          kind: 'DEFAULT',
          reportHistory: [],
          item,
        },
      });

      const pendingJobCount = await manualReviewToolService.getPendingJobCount({
        orgId: org.id,
        queueId: policyQueue.id,
      });
      expect(pendingJobCount).toBe(1);
    },
  );

  jobRoutingTestWithFixtures(
    'Should not match on policy rule',
    async ({
      manualReviewToolService,
      org,
      itemType,
      defaultQueue,
      policyQueue,
    }) => {
      const initialJobCount = await manualReviewToolService.getPendingJobCount({
        orgId: org.id,
        queueId: policyQueue.id,
      });
      const initialDefaultJobCount =
        await manualReviewToolService.getPendingJobCount({
          orgId: org.id,
          queueId: defaultQueue.id,
        });
      const normalizedDataOrError = toNormalizedItemDataOrErrors(
        [itemType.id],
        itemType,
        { text: '12345' },
      );
      if (Array.isArray(normalizedDataOrError)) {
        throw new Error('Error validating item data');
      }

      const itemSubmission = await submissionDataToItemSubmission(
        async () => itemType,
        {
          orgId: org.id,
          submissionId: makeSubmissionId(),
          itemId: uid(),
          itemTypeId: itemType.id,
          itemTypeVersion: '',
          itemTypeSchemaVariant: 'original',
          data: normalizedDataOrError,
          creatorId: null,
          creatorTypeId: null,
        },
      );
      if (itemSubmission instanceof Error) {
        throw new Error('Error creating item submission');
      }

      const item =
        itemSubmissionToItemSubmissionWithTypeIdentifier(itemSubmission);
      await manualReviewToolService.enqueue({
        enqueueSource: 'RULE_EXECUTION',
        enqueueSourceInfo: { kind: 'RULE_EXECUTION', rules: ['abc'] },
        createdAt: new Date(),
        orgId: org.id,
        correlationId: toCorrelationId({ type: 'submit-report', id: uid() }),
        policyIds: ['notTestPolicyId'],
        payload: {
          kind: 'DEFAULT',
          reportHistory: [],
          item,
        },
      });

      const pendingJobCount = await manualReviewToolService.getPendingJobCount({
        orgId: org.id,
        queueId: policyQueue.id,
      });
      expect(pendingJobCount).toBe(initialJobCount);

      const pendingDefaultJobCount =
        await manualReviewToolService.getPendingJobCount({
          orgId: org.id,
          queueId: defaultQueue.id,
        });
      expect(pendingDefaultJobCount).toBe(initialDefaultJobCount + 1);
    },
  );

  jobRoutingTestWithFixtures(
    'When queueId is passed to enqueue, job is added to that queue (skips routing)',
    async ({
      manualReviewToolService,
      org,
      itemType,
      defaultQueue,
      anotherQueue,
    }) => {
      const initialDefault = await manualReviewToolService.getPendingJobCount({
        orgId: org.id,
        queueId: defaultQueue.id,
      });
      const initialAnother = await manualReviewToolService.getPendingJobCount({
        orgId: org.id,
        queueId: anotherQueue.id,
      });

      const normalizedDataOrError = toNormalizedItemDataOrErrors(
        [itemType.id],
        itemType,
        { text: 'other' },
      );
      if (Array.isArray(normalizedDataOrError)) {
        throw new Error('Error validating item data');
      }

      const itemSubmission = await submissionDataToItemSubmission(
        async () => itemType,
        {
          orgId: org.id,
          submissionId: makeSubmissionId(),
          itemId: uid(),
          itemTypeId: itemType.id,
          itemTypeVersion: '',
          itemTypeSchemaVariant: 'original',
          data: normalizedDataOrError,
          creatorId: null,
          creatorTypeId: null,
        },
      );
      if (itemSubmission instanceof Error) {
        throw new Error('Error creating item submission');
      }

      const item =
        itemSubmissionToItemSubmissionWithTypeIdentifier(itemSubmission);
      // Pass explicit queueId so routing is skipped (e.g. NCMEC default queue).
      await manualReviewToolService.enqueue(
        {
          enqueueSource: 'RULE_EXECUTION',
          enqueueSourceInfo: { kind: 'RULE_EXECUTION', rules: ['abc'] },
          createdAt: new Date(),
          orgId: org.id,
          correlationId: toCorrelationId({ type: 'submit-report', id: uid() }),
          policyIds: [],
          payload: {
            kind: 'DEFAULT',
            reportHistory: [],
            item,
          },
        },
        anotherQueue.id,
      );

      const defaultQueueCount =
        await manualReviewToolService.getPendingJobCount({
          orgId: org.id,
          queueId: defaultQueue.id,
        });
      const anotherQueueCount =
        await manualReviewToolService.getPendingJobCount({
          orgId: org.id,
          queueId: anotherQueue.id,
        });
      expect(defaultQueueCount).toBe(initialDefault);
      expect(anotherQueueCount).toBe(initialAnother + 1);
    },
  );

  jobRoutingTestWithFixtures(
    'Should match on source type',
    async ({ manualReviewToolService, org, itemType, anotherQueue }) => {
      const normalizedDataOrError = toNormalizedItemDataOrErrors(
        [itemType.id],
        itemType,
        { text: '12345' },
      );
      if (Array.isArray(normalizedDataOrError)) {
        throw new Error('Error validating item data');
      }

      const itemSubmission = await submissionDataToItemSubmission(
        async () => itemType,
        {
          orgId: org.id,
          submissionId: makeSubmissionId(),
          itemId: uid(),
          itemTypeId: itemType.id,
          itemTypeVersion: '',
          itemTypeSchemaVariant: 'original',
          data: normalizedDataOrError,
          creatorId: null,
          creatorTypeId: null,
        },
      );
      if (itemSubmission instanceof Error) {
        throw new Error('Error creating item submission');
      }

      const item =
        itemSubmissionToItemSubmissionWithTypeIdentifier(itemSubmission);
      await manualReviewToolService.enqueue({
        enqueueSource: 'POST_ACTIONS',
        enqueueSourceInfo: { kind: 'POST_ACTIONS' },
        createdAt: new Date(),
        orgId: org.id,
        correlationId: toCorrelationId({ type: 'post-actions', id: uid() }),
        policyIds: ['testPolicyId2091283102398'],
        payload: {
          kind: 'DEFAULT',
          reportHistory: [],
          item,
        },
      });

      const pendingJobCount = await manualReviewToolService.getPendingJobCount({
        orgId: org.id,
        queueId: anotherQueue.id,
      });
      expect(pendingJobCount).toBe(1);
    },
  );

  // Regression: only the first policy id used to be checked.
  jobRoutingTestWithFixtures(
    'Should match a policy id that is not the first on the job',
    async ({ manualReviewToolService, org, itemType, policyQueue }) => {
      const normalizedDataOrError = toNormalizedItemDataOrErrors(
        [itemType.id],
        itemType,
        { text: '12345' },
      );
      if (Array.isArray(normalizedDataOrError)) {
        throw new Error('Error validating item data');
      }

      const itemSubmission = await submissionDataToItemSubmission(
        async () => itemType,
        {
          orgId: org.id,
          submissionId: makeSubmissionId(),
          itemId: uid(),
          itemTypeId: itemType.id,
          itemTypeVersion: '',
          itemTypeSchemaVariant: 'original',
          data: normalizedDataOrError,
          creatorId: null,
          creatorTypeId: null,
        },
      );
      if (itemSubmission instanceof Error) {
        throw new Error('Error creating item submission');
      }

      const item =
        itemSubmissionToItemSubmissionWithTypeIdentifier(itemSubmission);
      await manualReviewToolService.enqueue({
        enqueueSource: 'REPORT',
        enqueueSourceInfo: { kind: 'REPORT' },
        createdAt: new Date(),
        orgId: org.id,
        correlationId: toCorrelationId({ type: 'submit-report', id: uid() }),
        policyIds: ['otherPolicy', 'testPolicyId'],
        payload: {
          kind: 'DEFAULT',
          reportHistory: [],
          item,
        },
      });

      const pendingJobCount = await manualReviewToolService.getPendingJobCount({
        orgId: org.id,
        queueId: policyQueue.id,
      });
      expect(pendingJobCount).toBe(1);
    },
  );

  jobRoutingTestWithFixtures(
    "Should fall back to default queue when run rules no longer match db's queue list",
    async ({
      manualReviewToolService,
      org,
      itemType,
      defaultQueue,
      anotherQueue,
    }) => {
      const initialPendingJobCount =
        await manualReviewToolService.getPendingJobCount({
          orgId: org.id,
          queueId: defaultQueue.id,
        });
      // deleteManualReviewQueueForTestsDO_NOT_USE removes any routing rules that
      // reference the queue (RESTRICT FK) before deleting it. After deletion,
      // enqueue should find no matching rules and fall back to the default queue.
      await manualReviewToolService.deleteManualReviewQueueForTestsDO_NOT_USE(
        org.id,
        anotherQueue.id,
      );

      const normalizedDataOrError = toNormalizedItemDataOrErrors(
        [itemType.id],
        itemType,
        { text: 'test' },
      );
      if (Array.isArray(normalizedDataOrError)) {
        throw new Error('Error validating item data');
      }

      const itemSubmission = await submissionDataToItemSubmission(
        async () => itemType,
        {
          orgId: org.id,
          submissionId: makeSubmissionId(),
          itemId: uid(),
          itemTypeId: itemType.id,
          itemTypeVersion: '',
          itemTypeSchemaVariant: 'original',
          data: normalizedDataOrError,
          creatorId: null,
          creatorTypeId: null,
        },
      );
      if (itemSubmission instanceof Error) {
        throw new Error('Error creating item submission');
      }

      await manualReviewToolService.enqueue({
        enqueueSource: 'RULE_EXECUTION',
        enqueueSourceInfo: { kind: 'RULE_EXECUTION', rules: ['abc'] },
        createdAt: new Date(),
        orgId: org.id,
        correlationId: toCorrelationId({ type: 'submit-report', id: uid() }),
        policyIds: [],
        payload: {
          kind: 'DEFAULT',
          reportHistory: [],
          item: itemSubmissionToItemSubmissionWithTypeIdentifier(
            itemSubmission,
          ),
        },
      });

      const pendingJobCount = await manualReviewToolService.getPendingJobCount({
        orgId: org.id,
        queueId: defaultQueue.id,
      });
      expect(pendingJobCount).toBe(initialPendingJobCount + 1);
    },
  );

  jobRoutingTestWithFixtures(
    'Should not allow to save a routing rule for a queue that does not exist',
    async ({ manualReviewToolService, org, itemType }) => {
      await manualReviewToolService
        .createRoutingRule({
          orgId: org.id,
          name: 'Some rule',
          status: 'LIVE',
          itemTypeIds: [itemType.id as NonEmptyString],
          creatorId: '',
          conditionSet: {
            conjunction: 'AND',
            conditions: [
              {
                input: {
                  type: 'CONTENT_FIELD',
                  name: 'text',
                  contentTypeId: itemType.id,
                },
                signal: {
                  id: jsonStringify({
                    type: SignalType.TEXT_MATCHING_CONTAINS_TEXT,
                  }),
                  type: SignalType.TEXT_MATCHING_CONTAINS_TEXT,
                },
                matchingValues: { strings: ['test'] },
              },
            ],
          },
          destinationQueueId: uid(),
        })
        .then(
          async (result) => {
            await manualReviewToolService.deleteRoutingRule({
              id: result.id,
              orgId: org.id,
            });
            throw new Error("Promise should've rejected!");
          },
          (_e) => {
            /* swallow error as it's expected */
          },
        );
    },
  );

  jobRoutingTestWithFixtures(
    'Route to correct queue if policy Id is not provided',
    async ({ manualReviewToolService, noPolicyQueue, org, itemType }) => {
      const normalizedDataOrError = toNormalizedItemDataOrErrors(
        [itemType.id],
        itemType,
        { text: 'garbage' },
      );
      if (Array.isArray(normalizedDataOrError)) {
        throw new Error('Error validating item data');
      }

      const itemSubmission = await submissionDataToItemSubmission(
        async () => itemType,
        {
          orgId: org.id,
          submissionId: makeSubmissionId(),
          itemId: uid(),
          itemTypeId: itemType.id,
          itemTypeVersion: '',
          itemTypeSchemaVariant: 'original',
          data: normalizedDataOrError,
          creatorId: null,
          creatorTypeId: null,
        },
      );
      if (itemSubmission instanceof Error) {
        throw new Error('Error creating item submission');
      }

      const item =
        itemSubmissionToItemSubmissionWithTypeIdentifier(itemSubmission);
      await manualReviewToolService.enqueue({
        enqueueSource: 'RULE_EXECUTION',
        enqueueSourceInfo: { kind: 'RULE_EXECUTION', rules: ['abc'] },
        createdAt: new Date(),
        orgId: org.id,
        correlationId: toCorrelationId({ type: 'submit-report', id: uid() }),
        policyIds: [],
        payload: {
          kind: 'DEFAULT',
          reportHistory: [],
          item,
        },
      });

      const pendingJobCount = await manualReviewToolService.getPendingJobCount({
        orgId: org.id,
        queueId: noPolicyQueue.id,
      });
      expect(pendingJobCount).toBe(1);
    },
  );

  describe('report context inputs', () => {
    async function enqueueReportJob(opts: {
      manualReviewToolService: Dependencies['ManualReviewToolService'];
      orgId: string;
      itemType: ItemType;
      reportContexts: ReadonlyArray<ReportContext | undefined>;
    }) {
      const { manualReviewToolService, orgId, itemType, reportContexts } = opts;
      const normalizedDataOrError = toNormalizedItemDataOrErrors(
        [itemType.id],
        itemType,
        { text: 'nothing to match here' },
      );
      if (Array.isArray(normalizedDataOrError)) {
        throw new Error('Error validating item data');
      }
      const itemSubmission = await submissionDataToItemSubmission(
        async () => itemType,
        {
          orgId,
          submissionId: makeSubmissionId(),
          itemId: uid(),
          itemTypeId: itemType.id,
          itemTypeVersion: '',
          itemTypeSchemaVariant: 'original',
          data: normalizedDataOrError,
          creatorId: null,
          creatorTypeId: null,
        },
      );
      if (itemSubmission instanceof Error) {
        throw new Error('Error creating item submission');
      }

      await manualReviewToolService.enqueue({
        enqueueSource: 'REPORT',
        enqueueSourceInfo: { kind: 'REPORT' },
        createdAt: new Date(),
        orgId,
        correlationId: toCorrelationId({ type: 'submit-report', id: uid() }),
        policyIds: [],
        payload: {
          kind: 'DEFAULT',
          item: itemSubmissionToItemSubmissionWithTypeIdentifier(
            itemSubmission,
          ),
          reportHistory: reportContexts.map((context) => ({
            reportId: uid(),
            reportedAt: new Date(),
            ...(context ? { context } : {}),
          })),
        },
      });
    }

    async function createReportContextRule(opts: {
      manualReviewToolService: Dependencies['ManualReviewToolService'];
      orgId: string;
      itemTypeId: string;
      destinationQueueId: string;
      name: CoopInput;
      condition:
        | { comparator: 'EQUALS'; threshold: string }
        | { comparator: 'IS_NOT_PROVIDED' };
    }) {
      await opts.manualReviewToolService.createRoutingRule({
        orgId: opts.orgId,
        name: `${opts.name} rule`,
        status: 'LIVE',
        itemTypeIds: [opts.itemTypeId as NonEmptyString],
        creatorId: '',
        conditionSet: {
          conjunction: 'OR',
          conditions: [
            {
              input: { type: 'CONTENT_COOP_INPUT', name: opts.name },
              ...opts.condition,
            },
          ],
        },
        destinationQueueId: opts.destinationQueueId,
      });
    }

    jobRoutingTestWithFixtures(
      'routes on report surface when a report on the job matches',
      async ({
        manualReviewToolService,
        org,
        itemType,
        policyQueue,
        defaultQueue,
      }) => {
        await createReportContextRule({
          manualReviewToolService,
          orgId: org.id,
          itemTypeId: itemType.id,
          destinationQueueId: policyQueue.id,
          name: CoopInput.REPORT_SURFACE,
          condition: { comparator: 'EQUALS', threshold: 'profile' },
        });
        const countIn = async (queueId: string) =>
          manualReviewToolService.getPendingJobCount({
            orgId: org.id,
            queueId,
          });
        const initialDefault = await countIn(defaultQueue.id);

        await enqueueReportJob({
          manualReviewToolService,
          orgId: org.id,
          itemType,
          reportContexts: [{ surface: 'feed' }],
        });
        expect(await countIn(policyQueue.id)).toBe(0);
        expect(await countIn(defaultQueue.id)).toBe(initialDefault + 1);

        // Matches if any report on the job has the value.
        await enqueueReportJob({
          manualReviewToolService,
          orgId: org.id,
          itemType,
          reportContexts: [
            undefined,
            { surface: 'feed' },
            { surface: 'profile' },
          ],
        });
        expect(await countIn(policyQueue.id)).toBe(1);
      },
    );

    jobRoutingTestWithFixtures(
      'routes on report client name, version and platform',
      async ({ manualReviewToolService, org, itemType, policyQueue }) => {
        for (const [name, threshold] of [
          [CoopInput.REPORT_CLIENT_NAME, 'Ivory'],
          [CoopInput.REPORT_CLIENT_VERSION, '2.3.1'],
          [CoopInput.REPORT_CLIENT_PLATFORM, 'ios'],
        ] as const) {
          await createReportContextRule({
            manualReviewToolService,
            orgId: org.id,
            itemTypeId: itemType.id,
            destinationQueueId: policyQueue.id,
            name,
            condition: { comparator: 'EQUALS', threshold },
          });
        }

        for (const client of [
          { name: 'Ivory' },
          { version: '2.3.1' },
          { platform: 'ios' },
          { name: 'Other', version: '1.0', platform: 'web' },
        ]) {
          await enqueueReportJob({
            manualReviewToolService,
            orgId: org.id,
            itemType,
            reportContexts: [{ client }],
          });
        }

        expect(
          await manualReviewToolService.getPendingJobCount({
            orgId: org.id,
            queueId: policyQueue.id,
          }),
        ).toBe(3);
      },
    );

    jobRoutingTestWithFixtures(
      'treats a field no report provided as not provided',
      async ({ manualReviewToolService, org, itemType, policyQueue }) => {
        await createReportContextRule({
          manualReviewToolService,
          orgId: org.id,
          itemTypeId: itemType.id,
          destinationQueueId: policyQueue.id,
          name: CoopInput.REPORT_CLIENT_PLATFORM,
          condition: { comparator: 'IS_NOT_PROVIDED' },
        });

        // No context at all, and context without a platform, both count as
        // not provided; a report with a platform does not.
        for (const reportContexts of [
          [undefined],
          [{ surface: 'feed', client: { name: 'Ivory' } }],
          [{ client: { platform: 'ios' } }],
        ]) {
          await enqueueReportJob({
            manualReviewToolService,
            orgId: org.id,
            itemType,
            reportContexts,
          });
        }

        expect(
          await manualReviewToolService.getPendingJobCount({
            orgId: org.id,
            queueId: policyQueue.id,
          }),
        ).toBe(2);
      },
    );
  });
});
