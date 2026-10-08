import { getScalarType, ScalarTypes } from '@roostorg/coop-types';

import {
  CoopInput,
  type ItemType,
} from '../../services/moderationConfigService/index.js';
import { makeBadRequestError } from '../../utils/errors.js';
import { type GQLConditionSetInput } from '../generated.js';

/**
 * Image signals (e.g. "Image matches hash bank") read hashes that are only
 * computed for Image-typed fields. If a rule points such a signal at an input
 * that no selected content type can supply as an image, the condition can never
 * be satisfied, and nothing at runtime says why. Reject those rules at save
 * time instead.
 *
 * @param isImageOnlySignal Whether the signal's only eligible input is IMAGE.
 */
export async function assertImageSignalInputsAreImages(
  conditionSet: GQLConditionSetInput,
  itemTypes: readonly Pick<ItemType, 'name' | 'schema'>[],
  isImageOnlySignal: (signal: {
    type: string;
    id?: string;
  }) => Promise<boolean>,
) {
  const imageFieldNames = new Set(
    itemTypes.flatMap((it) =>
      it.schema
        .filter((field) => getScalarType(field) === ScalarTypes.IMAGE)
        .map((field) => field.name),
    ),
  );

  const check = async (
    condition: GQLConditionSetInput['conditions'][number],
  ) => {
    if (condition.conditions) {
      for (const sub of condition.conditions) {
        await check(sub);
      }
      return;
    }

    const { input, signal } = condition;
    if (!input || !signal || !(await isImageOnlySignal(signal))) {
      return;
    }

    if (
      input.type === 'CONTENT_COOP_INPUT' &&
      (input.name as string) === CoopInput.ANY_IMAGE &&
      imageFieldNames.size === 0
    ) {
      throw makeBadRequestError('Rule input has no images', {
        detail:
          `The signal "${signal.name}" needs an image, but none of this ` +
          `rule's content types (${itemTypes.map((it) => it.name).join(', ')}) ` +
          `have a field of type Image, so "Any image" would never match.`,
        shouldErrorSpan: true,
      });
    }

    if (
      input.type === 'CONTENT_FIELD' &&
      input.name != null &&
      !imageFieldNames.has(input.name)
    ) {
      throw makeBadRequestError('Rule input is not an image', {
        detail:
          `The signal "${signal.name}" needs an image, but "${input.name}" ` +
          `is not a field of type Image on any of this rule's content types.`,
        shouldErrorSpan: true,
      });
    }
  };

  for (const condition of conditionSet.conditions) {
    await check(condition);
  }
}
