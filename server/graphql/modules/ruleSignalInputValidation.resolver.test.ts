import { describe, expect, it, vi } from 'vitest';

import { UserPermission } from '../../services/userManagementService/index.js';
import { jsonStringify } from '../../utils/encoding.js';
import { resolvers as reportingResolvers } from './reportingRule.js';
import { resolvers as routingResolvers } from './routingRule.js';

// These check that the routing and reporting rule mutations run signal input
// validation, including falling back to a stored rule for whatever an update
// doesn't send. No database: the services are stubs.

const field = (name: string, type: string) => ({
  name,
  type,
  required: false,
  container: null,
});

const itemTypes = [
  {
    id: 'text-type',
    kind: 'CONTENT',
    name: 'Text',
    schema: [field('body', 'STRING')],
    schemaFieldRoles: {},
  },
  {
    id: 'image-type',
    kind: 'CONTENT',
    name: 'Image',
    schema: [field('pic', 'IMAGE')],
    schemaFieldRoles: {},
  },
];

const imageSignal = {
  id: jsonStringify({ type: 'IMAGE_SIMILARITY_MATCH' }),
  type: 'IMAGE_SIMILARITY_MATCH',
  name: 'Image matches bank',
};

const condition = (name: string, contentTypeId: string) => ({
  conjunction: 'AND' as const,
  conditions: [
    {
      input: { type: 'CONTENT_FIELD' as const, name, contentTypeId },
      comparator: 'EQUALS' as const,
      threshold: 'true',
      signal: imageSignal,
    },
  ],
});

// The stored form of `condition('pic', 'image-type')`.
const storedCondition = {
  conjunction: 'AND',
  conditions: [
    {
      input: {
        type: 'CONTENT_FIELD',
        name: 'pic',
        contentTypeId: 'image-type',
      },
      comparator: 'EQUALS',
      threshold: 'true',
      signal: { ...imageSignal, args: undefined },
    },
  ],
};

const makeContext = (service: object) => {
  const user = {
    id: 'u1',
    orgId: 'org',
    getPermissions: () => [UserPermission.MANAGE_ROUTING_RULES],
  };
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- stub of the full resolver context
  return {
    getUser: () => user,
    services: {
      SignalsService: {
        getSignal: async () => ({ eligibleInputs: ['IMAGE'] }),
        getSignalOrThrow: async () => {
          throw new Error('unused');
        },
      },
      ModerationConfigService: { getItemTypes: async () => itemTypes },
      ...service,
    },
  } as never;
};

const call = async (fn: unknown, ...args: unknown[]) =>
  (fn as (...a: unknown[]) => Promise<unknown>)(undefined, ...args);

describe('routing rule mutations', () => {
  const Mutation = routingResolvers.Mutation;
  const setup = () => {
    const ManualReviewToolService = {
      createRoutingRule: vi.fn(async () => ({ id: 'r1' })),
      updateRoutingRule: vi.fn(async () => ({ id: 'r1' })),
      getRoutingRules: vi.fn(async () => [
        {
          id: 'r1',
          itemTypeIds: ['image-type'],
          conditionSet: storedCondition,
        },
      ]),
    };
    return {
      ManualReviewToolService,
      context: makeContext({ ManualReviewToolService }),
    };
  };
  const base = {
    name: 'rule',
    status: 'LIVE',
    destinationQueueId: 'q',
  };

  it('rejects creating a rule whose signal cannot take its input', async () => {
    const { ManualReviewToolService, context } = setup();
    await expect(
      call(
        Mutation.createRoutingRule,
        {
          input: {
            ...base,
            itemTypeIds: ['text-type'],
            conditionSet: condition('body', 'text-type'),
          },
        },
        context,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(ManualReviewToolService.createRoutingRule).not.toHaveBeenCalled();
  });

  it('creates a rule whose signal can take its input', async () => {
    const { ManualReviewToolService, context } = setup();
    await call(
      Mutation.createRoutingRule,
      {
        input: {
          ...base,
          itemTypeIds: ['image-type'],
          conditionSet: condition('pic', 'image-type'),
        },
      },
      context,
    );
    expect(ManualReviewToolService.createRoutingRule).toHaveBeenCalledOnce();
  });

  it('validates stored conditions when an update only changes item types', async () => {
    const { ManualReviewToolService, context } = setup();
    await expect(
      call(
        Mutation.updateRoutingRule,
        { input: { id: 'r1', itemTypeIds: ['text-type'] } },
        context,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(ManualReviewToolService.updateRoutingRule).not.toHaveBeenCalled();
  });

  it('does not validate updates that change neither', async () => {
    const { ManualReviewToolService, context } = setup();
    await call(
      Mutation.updateRoutingRule,
      { input: { id: 'r1', name: 'renamed' } },
      context,
    );
    expect(ManualReviewToolService.getRoutingRules).not.toHaveBeenCalled();
    expect(ManualReviewToolService.updateRoutingRule).toHaveBeenCalledOnce();
  });
});

describe('reporting rule mutations', () => {
  const Mutation = reportingResolvers.Mutation;
  const setup = () => {
    const ReportingService = {
      createReportingRule: vi.fn(async () => ({ id: 'r1' })),
      updateReportingRule: vi.fn(async () => ({ id: 'r1' })),
      getReportingRules: vi.fn(async () => [
        {
          id: 'r1',
          itemTypeIds: ['image-type'],
          conditionSet: storedCondition,
        },
      ]),
    };
    return { ReportingService, context: makeContext({ ReportingService }) };
  };
  const base = {
    name: 'rule',
    status: 'LIVE',
    actionIds: ['a'],
    policyIds: [],
  };

  it('rejects creating a rule whose signal cannot take its input', async () => {
    const { ReportingService, context } = setup();
    await expect(
      call(
        Mutation.createReportingRule,
        {
          input: {
            ...base,
            itemTypeIds: ['text-type'],
            conditionSet: condition('body', 'text-type'),
          },
        },
        context,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(ReportingService.createReportingRule).not.toHaveBeenCalled();
  });

  it('validates new conditions against the stored item types', async () => {
    const { ReportingService, context } = setup();
    await expect(
      call(
        Mutation.updateReportingRule,
        {
          input: { id: 'r1', conditionSet: condition('body', 'text-type') },
        },
        context,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(ReportingService.updateReportingRule).not.toHaveBeenCalled();
  });

  it('lets an invalid rule be archived', async () => {
    const { ReportingService, context } = setup();
    await call(
      Mutation.updateReportingRule,
      {
        input: {
          id: 'r1',
          status: 'ARCHIVED',
          itemTypeIds: ['text-type'],
        },
      },
      context,
    );
    expect(ReportingService.updateReportingRule).toHaveBeenCalledOnce();
  });
});
