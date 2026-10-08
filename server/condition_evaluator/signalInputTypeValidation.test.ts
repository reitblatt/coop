import { describe, expect, it } from 'vitest';

import {
  CoopInput,
  type ConditionSet,
  type ItemType,
} from '../services/moderationConfigService/index.js';
import { type SignalInputType } from '../services/signalsService/index.js';
import { jsonStringify } from '../utils/encoding.js';
import {
  assertSignalInputsAreEligible,
  type SignalInputValidationArgs,
} from './signalInputTypeValidation.js';

const field = (name: string, type: string) => ({
  name,
  type,
  required: false,
  container: null,
});

const arrayField = (name: string, valueScalarType: string) => ({
  name,
  type: 'ARRAY',
  required: false,
  container: { containerType: 'ARRAY', keyScalarType: null, valueScalarType },
});

const makeItemType = (
  id: string,
  schema: object[],
  kind: 'CONTENT' | 'USER' = 'CONTENT',
) =>
  ({
    id,
    kind,
    name: id,
    schema,
    schemaFieldRoles: kind === 'CONTENT' ? { creatorId: 'author' } : {},
    description: null,
    version: '1',
    schemaVariant: 'original',
    orgId: 'org',
  }) as unknown as ItemType;

const post = makeItemType('post', [
  field('text', 'STRING'),
  field('avatar', 'IMAGE'),
  field('author', 'RELATED_ITEM'),
  arrayField('photos', 'IMAGE'),
]);
const textOnlyPost = makeItemType('post', [
  field('text', 'STRING'),
  field('author', 'RELATED_ITEM'),
]);
const comment = makeItemType('comment', [
  field('text', 'STRING'),
  field('author', 'RELATED_ITEM'),
]);
// Same field name as `post.avatar`, but a different type.
const commentWithTextAvatar = makeItemType('comment', [
  field('avatar', 'STRING'),
]);

const signalInputs: Record<string, readonly SignalInputType[] | undefined> = {
  IMAGE_ONLY: ['IMAGE'],
  TEXT_ONLY: ['STRING'],
  USER_ONLY: ['USER_ID'],
  POLICY_ONLY: ['POLICY_ID'],
  FULL_ITEM_ONLY: ['FULL_ITEM'],
  MISSING: undefined,
};

const leaf = (
  input: object,
  signalType: string | null = 'IMAGE_ONLY',
  extra: object = {},
) =>
  ({
    conjunction: 'AND',
    conditions: [
      {
        input,
        comparator: 'GREATER_THAN',
        threshold: 1,
        signal:
          signalType == null
            ? undefined
            : {
                id: jsonStringify({ type: signalType }),
                type: signalType,
                name: `Signal ${signalType}`,
              },
        ...extra,
      },
    ],
  }) as unknown as ConditionSet;

const check = async (
  conditionSet: ConditionSet,
  overrides: Partial<SignalInputValidationArgs> = {},
) =>
  assertSignalInputsAreEligible({
    conditionSet,
    ruleKind: 'CONTENT',
    itemTypes: [post],
    getEligibleInputs: async (signalId) => signalInputs[signalId.type],
    getDerivedFieldOutputScalarType: async () => 'STRING',
    ...overrides,
  });

const contentField = (name: string, contentTypeId = 'post') => ({
  type: 'CONTENT_FIELD',
  name,
  contentTypeId,
});
const coopInput = (name: string) => ({ type: 'CONTENT_COOP_INPUT', name });

describe('assertSignalInputsAreEligible', () => {
  describe('CONTENT_FIELD', () => {
    it('accepts an IMAGE field of any name', async () => {
      await expect(
        check(leaf(contentField('avatar'))),
      ).resolves.toBeUndefined();
    });

    it('accepts an array field whose values are the eligible type', async () => {
      await expect(
        check(leaf(contentField('photos'))),
      ).resolves.toBeUndefined();
    });

    it('rejects a field of an ineligible type, naming field, type and signal', async () => {
      const err = await check(leaf(contentField('text'))).catch((e) => e);
      expect(err).toMatchObject({ status: 400 });
      expect(err.title).toMatch(/Signal IMAGE_ONLY/);
      expect(err.detail).toMatch(/text/);
      expect(err.detail).toMatch(/STRING/);
      expect(err.detail).toMatch(/IMAGE/);
    });

    it('rejects when the field is missing from every item type', async () => {
      await expect(check(leaf(contentField('nope')))).rejects.toMatchObject({
        status: 400,
      });
    });

    it('accepts a field that only exists on some of the rule item types', async () => {
      await expect(
        check(leaf(contentField('avatar')), { itemTypes: [post, comment] }),
      ).resolves.toBeUndefined();
    });

    it('pins a CONTENT_FIELD to its contentTypeId when choosing the schema', async () => {
      // Evaluator would hand the IMAGE signal a STRING for `comment` items.
      await expect(
        check(leaf(contentField('avatar')), {
          itemTypes: [post, commentWithTextAvatar],
        }),
      ).resolves.toBeUndefined(); // contentTypeId pins the field to `post`
      await expect(
        check(leaf(contentField('avatar', 'comment')), {
          itemTypes: [post, commentWithTextAvatar],
        }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('CONTENT_COOP_INPUT', () => {
    it('rejects "Any image" when no item type has an image field', async () => {
      await expect(
        check(leaf(coopInput(CoopInput.ANY_IMAGE)), {
          itemTypes: [textOnlyPost],
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('accepts "Any image" when an item type has an image field', async () => {
      await expect(
        check(leaf(coopInput(CoopInput.ANY_IMAGE))),
      ).resolves.toBeUndefined();
    });

    it('rejects a text signal on "Any image" (not just image signals)', async () => {
      await expect(
        check(leaf(coopInput(CoopInput.ANY_IMAGE), 'TEXT_ONLY')),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('accepts a text signal on "All text"', async () => {
      await expect(
        check(leaf(coopInput(CoopInput.ALL_TEXT), 'TEXT_ONLY')),
      ).resolves.toBeUndefined();
    });

    it('accepts a user signal on the content author, and rejects others', async () => {
      await expect(
        check(leaf(coopInput(CoopInput.AUTHOR_USER), 'USER_ONLY')),
      ).resolves.toBeUndefined();
      await expect(
        check(leaf(coopInput(CoopInput.AUTHOR_USER), 'TEXT_ONLY')),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('resolves policy ids for routing rules but not reporting rules', async () => {
      const policyLeaf = leaf(coopInput(CoopInput.POLICY_ID), 'POLICY_ONLY');
      await expect(
        check(policyLeaf, { ruleKind: 'ROUTING' }),
      ).resolves.toBeUndefined();
      // The reporting engine runs rules with no policy ids on the input.
      await expect(
        check(policyLeaf, { ruleKind: 'REPORTING' }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('FULL_ITEM and USER_ID', () => {
    it('checks FULL_ITEM against signals that take full items', async () => {
      await expect(
        check(leaf({ type: 'FULL_ITEM' }, 'FULL_ITEM_ONLY')),
      ).resolves.toBeUndefined();
      await expect(
        check(leaf({ type: 'FULL_ITEM' }, 'TEXT_ONLY')),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('checks USER_ID in user rules', async () => {
      const opts = { ruleKind: 'USER' as const, itemTypes: [] };
      await expect(
        check(leaf({ type: 'USER_ID' }, 'USER_ONLY'), opts),
      ).resolves.toBeUndefined();
      await expect(
        check(leaf({ type: 'USER_ID' }, 'TEXT_ONLY'), opts),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('CONTENT_DERIVED_FIELD', () => {
    const derived = (source: object) => ({
      type: 'CONTENT_DERIVED_FIELD',
      spec: { source, derivationType: 'VIDEO_TRANSCRIPTION' },
    });

    it("checks the derivation's output type against the signal", async () => {
      const source = {
        type: 'CONTENT_FIELD',
        name: 'photos',
        contentTypeId: 'post',
      };
      await expect(
        check(leaf(derived(source), 'TEXT_ONLY')),
      ).resolves.toBeUndefined();
      await expect(
        check(leaf(derived(source), 'IMAGE_ONLY')),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('skips derived fields whose output type is unknown', async () => {
      const source = {
        type: 'CONTENT_FIELD',
        name: 'photos',
        contentTypeId: 'post',
      };
      await expect(
        check(leaf(derived(source), 'IMAGE_ONLY'), {
          getDerivedFieldOutputScalarType: async () => undefined,
        }),
      ).resolves.toBeUndefined();
    });

    it('rejects when the derivation source resolves to nothing', async () => {
      const source = {
        type: 'CONTENT_FIELD',
        name: 'nope',
        contentTypeId: 'post',
      };
      await expect(
        check(leaf(derived(source), 'TEXT_ONLY')),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('states that must not be rejected', () => {
    it('ignores conditions with no signal', async () => {
      await expect(
        check(leaf(contentField('text'), null)),
      ).resolves.toBeUndefined();
    });

    it('ignores IS_NOT_PROVIDED and IS_UNAVAILABLE comparators', async () => {
      for (const comparator of ['IS_NOT_PROVIDED', 'IS_UNAVAILABLE']) {
        await expect(
          check(leaf(contentField('text'), 'IMAGE_ONLY', { comparator })),
        ).resolves.toBeUndefined();
      }
    });

    it('ignores signals that cannot be found', async () => {
      await expect(
        check(leaf(contentField('text'), 'MISSING')),
      ).resolves.toBeUndefined();
    });

    it('ignores rules with no resolvable item types yet', async () => {
      await expect(
        check(leaf(contentField('text')), { itemTypes: [] }),
      ).resolves.toBeUndefined();
    });
  });

  it('checks conditions in nested condition sets', async () => {
    const nested = {
      conjunction: 'OR',
      conditions: [leaf(contentField('avatar')), leaf(contentField('text'))],
    } as unknown as ConditionSet;
    await expect(check(nested)).rejects.toMatchObject({ status: 400 });
  });
});
