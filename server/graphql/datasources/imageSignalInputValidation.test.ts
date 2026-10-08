import { describe, expect, it } from 'vitest';

import { assertImageSignalInputsAreImages } from './imageSignalInputValidation.js';

const field = (name: string, type: string, container: unknown = null) => ({
  name,
  type,
  required: false,
  container,
});

const itemTypes = [
  {
    name: 'Post',
    schema: [field('text', 'STRING'), field('avatar', 'IMAGE')],
  },
] as never;

const textOnlyItemTypes = [
  { name: 'Post', schema: [field('text', 'STRING')] },
] as never;

// Test fixture: the generated GQL input type is stricter than what we need.
const leaf = (input: object) =>
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  ({
    conditions: [
      {
        input,
        comparator: 'EQUALS',
        signal: {
          type: 'IMAGE_SIMILARITY_MATCH',
          id: '{}',
          name: 'Image match',
        },
      },
    ],
    conjunction: 'AND',
  }) as never;

const imageOnly = async () => true;

describe('assertImageSignalInputsAreImages', () => {
  it('accepts an Image field of any name', async () => {
    await expect(
      assertImageSignalInputsAreImages(
        leaf({ type: 'CONTENT_FIELD', name: 'avatar' }),
        itemTypes,
        imageOnly,
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects a non-image field', async () => {
    await expect(
      assertImageSignalInputsAreImages(
        leaf({ type: 'CONTENT_FIELD', name: 'text' }),
        itemTypes,
        imageOnly,
      ),
    ).rejects.toThrow(/not a field of type Image/);
  });

  it('rejects "Any image" when no content type has an Image field', async () => {
    await expect(
      assertImageSignalInputsAreImages(
        leaf({ type: 'CONTENT_COOP_INPUT', name: 'Any image' }),
        textOnlyItemTypes,
        imageOnly,
      ),
    ).rejects.toThrow(/none of this rule's content types/);
  });

  it('accepts "Any image" when a content type has an Image field', async () => {
    await expect(
      assertImageSignalInputsAreImages(
        leaf({ type: 'CONTENT_COOP_INPUT', name: 'Any image' }),
        itemTypes,
        imageOnly,
      ),
    ).resolves.toBeUndefined();
  });

  it('ignores signals that are not image-only', async () => {
    await expect(
      assertImageSignalInputsAreImages(
        leaf({ type: 'CONTENT_FIELD', name: 'text' }),
        itemTypes,
        async () => false,
      ),
    ).resolves.toBeUndefined();
  });
});
