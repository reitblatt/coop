import { describe, expect, it } from 'vitest';

import { type ConditionSet } from '../../services/moderationConfigService/index.js';
import { jsonStringify } from '../../utils/encoding.js';
import { validateRuleSignalInputs } from './ruleSignalInputValidation.js';

const field = (name: string, type: string) => ({
  name,
  type,
  required: false,
  container: null,
});

const itemTypes = [
  {
    id: 'post',
    kind: 'CONTENT',
    name: 'Post',
    schema: [field('text', 'STRING')],
    schemaFieldRoles: {},
  },
  {
    id: 'other',
    kind: 'CONTENT',
    name: 'Other',
    schema: [field('pic', 'IMAGE')],
    schemaFieldRoles: {},
  },
];

// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- stubs of the injected services
const deps = {
  signalsService: {
    getSignal: async ({ signalId }: { signalId: { type: string } }) =>
      signalId.type === 'IMAGE_ONLY'
        ? { eligibleInputs: ['IMAGE'] }
        : undefined,
    getSignalOrThrow: async () => {
      throw new Error('not available');
    },
  },
  moderationConfigService: { getItemTypes: async () => itemTypes },
} as never;

const conditionSet = (fieldName: string, contentTypeId: string) =>
  ({
    conjunction: 'AND',
    conditions: [
      {
        input: { type: 'CONTENT_FIELD', name: fieldName, contentTypeId },
        comparator: 'GREATER_THAN',
        threshold: 1,
        signal: {
          id: jsonStringify({ type: 'IMAGE_ONLY' }),
          type: 'IMAGE_ONLY',
          name: 'Image only',
        },
      },
    ],
  }) as unknown as ConditionSet;

const validate = async (
  conditions: ConditionSet,
  itemTypeIds: string[],
  ruleKind: 'CONTENT' | 'USER' = 'CONTENT',
) =>
  validateRuleSignalInputs(deps, {
    orgId: 'org',
    ruleKind,
    conditionSet: conditions,
    itemTypeIds,
  });

describe('validateRuleSignalInputs', () => {
  it('only resolves against the rule’s own item types', async () => {
    await expect(
      validate(conditionSet('pic', 'other'), ['other']),
    ).resolves.toBeUndefined();
    await expect(
      validate(conditionSet('text', 'post'), ['post']),
    ).rejects.toMatchObject({ status: 400 });
    // `other` isn't selected, so its image field doesn't count.
    await expect(
      validate(conditionSet('pic', 'other'), ['post']),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('skips rules whose item types no longer exist', async () => {
    await expect(
      validate(conditionSet('text', 'gone'), ['gone']),
    ).resolves.toBeUndefined();
  });

  it('resolves no content fields for user rules', async () => {
    await expect(
      validate(conditionSet('text', 'post'), [], 'USER'),
    ).rejects.toMatchObject({ status: 400 });
  });
});
