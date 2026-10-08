// Should be human-readable
export enum CoopInput {
  ALL_TEXT = 'All text',
  ANY_IMAGE = 'Any image',
  ANY_GEOHASH = 'Any geohash',
  ANY_VIDEO = 'Any video',
  AUTHOR_USER = 'Content author (user)',
  POLICY_ID = 'Relevant Policy',
  SOURCE = 'Creation Source',
  // These values must match the server's CoopInput values exactly, as they're
  // stored in rule conditions and compared by the server.
  REPORT_SURFACE = 'Report surface',
  REPORT_CLIENT_NAME = 'Report client name',
  REPORT_CLIENT_VERSION = 'Report client version',
  REPORT_CLIENT_PLATFORM = 'Report client platform',
}

export const REPORT_CONTEXT_COOP_INPUTS: readonly string[] = [
  CoopInput.REPORT_SURFACE,
  CoopInput.REPORT_CLIENT_NAME,
  CoopInput.REPORT_CLIENT_VERSION,
  CoopInput.REPORT_CLIENT_PLATFORM,
];

/**
 * Coop inputs whose values are compared directly against a threshold, without
 * running a signal first (even though, being strings, text signals would
 * otherwise be eligible).
 */
export function isComparatorOnlyCoopInput(
  input: { type: string; name?: string | null } | null | undefined,
): boolean {
  return (
    input?.type === 'CONTENT_COOP_INPUT' &&
    (input.name === CoopInput.SOURCE ||
      REPORT_CONTEXT_COOP_INPUTS.includes(input.name ?? ''))
  );
}

export const CoopInputEnumInverted = Object.fromEntries(
  Object.entries(CoopInput).map(([key, value]) => [value, key]),
) as { [key: string]: string | undefined };
