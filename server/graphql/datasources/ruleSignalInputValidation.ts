import { type ReadonlyDeep } from 'type-fest';

import {
  assertSignalInputsAreEligible,
  type RuleKind,
} from '../../condition_evaluator/signalInputTypeValidation.js';
import { type Dependencies } from '../../iocContainer/index.js';
import {
  getDerivedFieldOutputType,
  type DerivedFieldType,
} from '../../services/derivedFieldsService/index.js';
import { type ConditionSet } from '../../services/moderationConfigService/index.js';
import { type SignalId } from '../../services/signalsService/index.js';

/**
 * Save-time check, shared by every path that persists a rule's ConditionSet
 * (content/user rules, routing rules, reporting rules), that each condition's
 * signal can accept the input the condition selects. This is the I/O shell
 * around the pure {@link assertSignalInputsAreEligible}: it only loads the item
 * types and signals; all of the actual logic lives in the pure function.
 *
 * Pass the condition set in its stored form (i.e., after
 * `transformConditionForDB`).
 */
export async function validateRuleSignalInputs(
  deps: {
    signalsService: Pick<
      Dependencies['SignalsService'],
      'getSignal' | 'getSignalOrThrow'
    >;
    moderationConfigService: Pick<
      Dependencies['ModerationConfigService'],
      'getItemTypes'
    >;
  },
  opts: {
    orgId: string;
    ruleKind: RuleKind;
    conditionSet: ReadonlyDeep<ConditionSet>;
    itemTypeIds: readonly string[];
  },
): Promise<void> {
  const { orgId, ruleKind, conditionSet, itemTypeIds } = opts;
  const { signalsService, moderationConfigService } = deps;

  // Item types that no longer exist are dropped here; if that leaves none, the
  // validator has nothing to resolve against and skips the check.
  const itemTypes =
    ruleKind === 'USER'
      ? []
      : (await moderationConfigService.getItemTypes({ orgId })).filter((it) =>
          itemTypeIds.includes(it.id),
        );

  await assertSignalInputsAreEligible({
    conditionSet,
    ruleKind,
    itemTypes,
    getEligibleInputs: async (signalId: SignalId) =>
      (await signalsService.getSignal({ signalId, orgId }))?.eligibleInputs,
    getDerivedFieldOutputScalarType: async (
      derivationType: DerivedFieldType,
    ) => {
      try {
        const outputType = await getDerivedFieldOutputType(
          signalsService.getSignalOrThrow.bind(signalsService),
          derivationType,
          orgId,
        );
        return outputType.scalarType;
      } catch {
        // E.g., the derivation's signal isn't available to this org. That's a
        // different problem than the one we validate here.
        return undefined;
      }
    },
  });
}
