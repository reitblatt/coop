import {
  type Field,
  type ScalarType,
  type TaggedScalar,
} from '@roostorg/coop-types';
import { type ReadonlyDeep } from 'type-fest';

import { type RuleInput } from '../rule_engine/RuleEvaluator.js';
import { type DerivedFieldType } from '../services/derivedFieldsService/index.js';
import {
  makeSubmissionId,
  type ItemSubmission,
  type NormalizedItemData,
} from '../services/itemProcessingService/index.js';
import {
  type ConditionInput,
  type ConditionSet,
  type ItemType,
  type LeafCondition,
  type TaggedItemData,
} from '../services/moderationConfigService/index.js';
import {
  getSignalInputType,
  type SignalId,
  type SignalInputType,
} from '../services/signalsService/index.js';
import { jsonParse } from '../utils/encoding.js';
import { makeBadRequestError } from '../utils/errors.js';
import { assertUnreachable } from '../utils/misc.js';
import { instantiateOpaqueType } from '../utils/typescript-types.js';
import { getSignalInputValueOrValues } from './leafCondition.js';

/**
 * Which engine will evaluate the rule. This matters because each engine builds
 * its `RuleInput` differently, which changes what a given ConditionInput
 * resolves to (e.g., only routing rules are evaluated with policy ids).
 *
 * - CONTENT: `RuleEngine` (content rules), with the full item submission.
 * - USER: `RunUserRulesJob`, with only a user's id (no item data).
 * - ROUTING: `JobRouting`/`AppealsJobRouting`, which add `policyIds` and
 *   `sourceType` to the submission.
 * - REPORTING: `ReportingRuleEngine`, with the bare submission.
 */
export type RuleKind = 'CONTENT' | 'USER' | 'ROUTING' | 'REPORTING';

export type SignalInputValidationArgs = {
  conditionSet: ReadonlyDeep<ConditionSet>;
  ruleKind: RuleKind;
  /**
   * The item types the rule will run on. Pass the full ItemTypes (with
   * schemas); ids that couldn't be loaded should simply be left out. Ignored
   * for user rules, which don't have item data.
   */
  itemTypes: readonly ItemType[];
  /** Returns undefined for signals that can't be found or aren't enabled. */
  getEligibleInputs: (
    signalId: SignalId,
  ) => Promise<readonly SignalInputType[] | undefined>;
  /**
   * The scalar type that a derived field's value will have, or undefined if it
   * isn't known (in which case conditions on that derived field are skipped).
   */
  getDerivedFieldOutputScalarType: (
    derivationType: DerivedFieldType,
  ) => Promise<ScalarType | undefined>;
};

/**
 * Rejects (with a 400) any condition whose signal can never be run on the value
 * its input produces, which would otherwise only show up at run time as a
 * swallowed error and an ERRORED condition.
 *
 * To make sure this can't disagree with the rule engine, it doesn't re-derive
 * what each input resolves to. Instead it builds a placeholder `RuleInput` per
 * item type (every schema field present, with a dummy value) and runs the
 * evaluator's own {@link getSignalInputValueOrValues} on it. The `type` of the
 * values that come back is the type the signal would be handed at run time,
 * and is compared with `signal.eligibleInputs` exactly as
 * `SignalsService.runSignal` does (via `getSignalInputType`).
 *
 * A condition is rejected if, for any of the rule's item types, the input
 * produces a type the signal doesn't accept; or if the input produces no values
 * at all on any of the item types (the condition could never match). Item types
 * that simply lack the input are fine as long as some other item type has it,
 * mirroring how the evaluator marks such conditions INAPPLICABLE.
 *
 * Conditions are skipped (not rejected) when we can't know enough, or when the
 * evaluator wouldn't report an eligibility error: no signal; the signal can't
 * be found; IS_NOT_PROVIDED (returns before running the signal); IS_UNAVAILABLE
 * (treats a signal error as the thing being tested); no resolvable item types
 * (e.g., a partially-filled rule).
 *
 * Derived fields: the value's type is the output type of the derivation's
 * signal, which is static per derivation type, so we use that. The derivation's
 * source is resolved with the same evaluator code, so a source that yields
 * nothing is rejected too. We deliberately don't check the source against the
 * derivation signal's eligible inputs: a derivation that fails at run time is
 * a supported state, surfaced to rules via IS_UNAVAILABLE.
 */
export async function assertSignalInputsAreEligible(
  args: SignalInputValidationArgs,
): Promise<void> {
  const probes = makeProbes(args.ruleKind, args.itemTypes);
  // Without any item types we can't resolve anything, so there's nothing
  // meaningful to check (e.g., content types not chosen yet).
  if (probes.length === 0) {
    return;
  }

  for (const leaf of getLeafConditions(args.conditionSet)) {
    await assertLeafIsEligible(leaf, probes, args);
  }
}

function getLeafConditions(
  conditionSet: ReadonlyDeep<ConditionSet>,
): ReadonlyDeep<LeafCondition>[] {
  return (
    conditionSet.conditions as readonly ReadonlyDeep<
      LeafCondition | ConditionSet
    >[]
  ).flatMap((it) =>
    'conditions' in it
      ? getLeafConditions(it)
      : [it as ReadonlyDeep<LeafCondition>],
  );
}

type Probe = { name: string; ruleInput: RuleInput };

async function assertLeafIsEligible(
  condition: ReadonlyDeep<LeafCondition>,
  probes: readonly Probe[],
  args: SignalInputValidationArgs,
) {
  const { signal, input, comparator } = condition;
  if (
    comparator === 'IS_NOT_PROVIDED' ||
    comparator === 'IS_UNAVAILABLE' ||
    !signal
  ) {
    return;
  }

  const eligibleInputs = await args.getEligibleInputs(jsonParse(signal.id));
  if (!eligibleInputs) {
    return;
  }

  const derivedOutputType =
    input.type === 'CONTENT_DERIVED_FIELD'
      ? await args.getDerivedFieldOutputScalarType(input.spec.derivationType)
      : undefined;
  if (input.type === 'CONTENT_DERIVED_FIELD' && !derivedOutputType) {
    return;
  }

  const resolved: { probe: Probe; types: Set<SignalInputType> }[] = [];
  for (const probe of probes) {
    resolved.push({
      probe,
      types: await resolveInputTypes(input, probe.ruleInput, derivedOutputType),
    });
  }

  const signalName = signal.name ?? signal.type;
  const inputDescription = describeInput(input);

  if (resolved.every((it) => it.types.size === 0)) {
    throw makeBadRequestError(`Signal "${signalName}" has no input to run on`, {
      detail:
        `The condition's input (${inputDescription}) has no values for ` +
        `${describeProbes(probes)}, so this condition could never match.`,
      shouldErrorSpan: true,
    });
  }

  for (const { probe, types } of resolved) {
    const bad = [...types].filter((it) => !eligibleInputs.includes(it));
    if (bad.length > 0) {
      throw makeBadRequestError(
        `Signal "${signalName}" can't be used with this input`,
        {
          detail:
            `The condition's input (${inputDescription}) provides ` +
            `${bad.join(', ')}${probe.name ? ` on ${probe.name}` : ''}, but ` +
            `this signal only accepts ${eligibleInputs.join(', ')}.`,
          shouldErrorSpan: true,
        },
      );
    }
  }
}

/**
 * The types of the values the evaluator would pass to the condition's signal.
 */
async function resolveInputTypes(
  input: ReadonlyDeep<ConditionInput>,
  ruleInput: RuleInput,
  derivedOutputType: ScalarType | undefined,
): Promise<Set<SignalInputType>> {
  const isDerived = input.type === 'CONTENT_DERIVED_FIELD';
  const value = await getSignalInputValueOrValues(
    isDerived ? input.spec.source : input,
    ruleInput,
  );

  const values: (TaggedScalar<ScalarType> | TaggedItemData)[] =
    value === undefined ? [] : Array.isArray(value) ? value : [value];
  if (values.length === 0) {
    return new Set();
  }

  return new Set(
    isDerived && derivedOutputType
      ? [derivedOutputType]
      : values.map(getSignalInputType),
  );
}

// ---- Probe construction ----------------------------------------------------

// Values only need to be present: the evaluator's input resolution reads field
// *types* from the schema and never inspects the values. This one is shaped
// like an ItemIdentifier so that role fields like `creatorId` look sensible.
const PLACEHOLDER = { id: 'probe', typeId: 'probe' };

function makeProbes(
  ruleKind: RuleKind,
  itemTypes: readonly ItemType[],
): Probe[] {
  if (ruleKind === 'USER') {
    return [
      {
        name: '',
        ruleInput: {
          itemId: 'probe',
          itemType: { id: 'probe', kind: 'USER', name: 'user' },
        },
      },
    ];
  }

  return itemTypes.map((itemType) => ({
    name: itemType.name,
    ruleInput: makeSubmissionProbe(ruleKind, itemType),
  }));
}

function makeSubmissionProbe(
  ruleKind: RuleKind,
  itemType: ItemType,
): RuleInput {
  const data = Object.fromEntries(
    itemType.schema.map((it) => [it.name, placeholderForField(it)]),
  );
  const submission = instantiateOpaqueType<ItemSubmission>({
    submissionId: makeSubmissionId(),
    itemId: 'probe',
    // Mirrors getCreator(): users have no creator; others do iff the schema
    // maps a creatorId role.
    creator:
      itemType.kind !== 'USER' && itemType.schemaFieldRoles.creatorId
        ? PLACEHOLDER
        : undefined,
    data: data as NormalizedItemData,
    itemType,
  });

  // JobRouting adds the report's policies and the source to the submission.
  return ruleKind === 'ROUTING'
    ? { ...submission, policyIds: ['probe'], sourceType: 'post-content' }
    : submission;
}

function placeholderForField(field: Field): unknown {
  return field.type === 'ARRAY'
    ? [PLACEHOLDER]
    : field.type === 'MAP'
      ? { probe: PLACEHOLDER }
      : PLACEHOLDER;
}

// ---- Messages --------------------------------------------------------------

function describeProbes(probes: readonly Probe[]) {
  return probes.length === 1 && probes[0].name === ''
    ? 'this rule'
    : `the rule's item types (${probes.map((it) => it.name).join(', ')})`;
}

function describeInput(input: ReadonlyDeep<ConditionInput>): string {
  switch (input.type) {
    case 'CONTENT_FIELD':
      return `field "${input.name}"`;
    case 'CONTENT_COOP_INPUT':
      return `"${input.name}"`;
    case 'FULL_ITEM':
      return 'the full item';
    case 'USER_ID':
      return 'the user';
    case 'CONTENT_DERIVED_FIELD':
      return `derived field "${input.spec.derivationType}" of ${describeInput(input.spec.source)}`;
    default:
      return assertUnreachable(input);
  }
}
