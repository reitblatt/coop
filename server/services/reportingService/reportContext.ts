import { assertUnreachable } from '../../utils/misc.js';

/**
 * Optional context about where a report came from, supplied by the integrator
 * on `POST /api/v1/report`.
 *
 * `surface` and `client` are well-known fields. Anything else goes in
 * `attributes`, which is stored and shown to reviewers but is deliberately not
 * exposed to rules: if org-defined report context schemas are added later,
 * attribute keys become schema fields, and rules referencing raw keys would
 * then need migrating.
 */
export type ReportContext = {
  surface?: string;
  client?: {
    name?: string;
    version?: string;
    platform?: string;
  };
  attributes?: { [key: string]: ReportContextAttributeValue };
};

export type ReportContextAttributeValue = string | number | boolean | null;

const MAX_STRING_LENGTH = 256;

const boundedNullableString = {
  type: ['string', 'null'] as const,
  maxLength: MAX_STRING_LENGTH,
};

export const reportContextSchema = {
  type: 'object' as const,
  properties: {
    surface: boundedNullableString,
    client: {
      type: 'object' as const,
      properties: {
        name: boundedNullableString,
        version: boundedNullableString,
        platform: boundedNullableString,
      },
    },
    // NB: the typings break here if we don't have { required: [] }, but an
    // empty `required` array is invalid in draft-04 and breaks schema
    // compilation, so we use a cast (as rawItemSubmissionSchema does).
    attributes: {
      type: 'object',
      maxProperties: 50,
      additionalProperties: {
        type: ['string', 'number', 'boolean', 'null'],
      },
    } as unknown as {
      type: 'object';
      maxProperties: number;
      required: [];
      additionalProperties: {
        type: readonly ['string', 'number', 'boolean', 'null'];
      };
    },
  },
};

/**
 * The shape accepted on the wire, where the string fields may also be `null`.
 */
export type ReportContextInput = {
  surface?: string | null;
  client?: {
    name?: string | null;
    version?: string | null;
    platform?: string | null;
  };
  attributes?: { [key: string]: ReportContextAttributeValue };
};

/**
 * Normalizes the API input: strips nulls and empty values, and returns
 * undefined if no context was actually provided.
 */
export function normalizeReportContext(
  input: ReportContextInput | undefined,
): ReportContext | undefined {
  if (input == null) {
    return undefined;
  }

  const client = input.client
    ? {
        ...(input.client.name ? { name: input.client.name } : {}),
        ...(input.client.version ? { version: input.client.version } : {}),
        ...(input.client.platform ? { platform: input.client.platform } : {}),
      }
    : {};
  const attributes = input.attributes ?? {};

  const context: ReportContext = {
    ...(input.surface ? { surface: input.surface } : {}),
    ...(Object.keys(client).length > 0 ? { client } : {}),
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
  };

  return Object.keys(context).length > 0 ? context : undefined;
}

/**
 * The single place report context is mapped to `REPORTING_SERVICE.REPORTS`
 * columns. Absent values are omitted so the columns fall back to their ''
 * default.
 */
export function reportContextToWarehouseColumns(
  context: ReportContext | undefined,
) {
  if (!context) {
    return {};
  }
  const { surface, client, attributes } = context;
  return {
    ...(surface ? { report_surface: surface } : {}),
    ...(client?.name ? { report_client_name: client.name } : {}),
    ...(client?.version ? { report_client_version: client.version } : {}),
    ...(client?.platform ? { report_client_platform: client.platform } : {}),
    ...(attributes ? { report_context_attributes: attributes } : {}),
  };
}

/**
 * The report context fields that routing rules can match on. The names match
 * the field roles an org-defined report context schema would use, so that
 * this lookup can later resolve through those roles without changing the
 * rules that use it.
 */
export type ReportContextRuleField =
  'surface' | 'clientName' | 'clientVersion' | 'clientPlatform';

/**
 * The distinct values of each rule field across the given report contexts
 * (one per report on a job). Reports that didn't provide a field are skipped,
 * so a field no report provided maps to an empty array.
 */
export type ReportContextValues = Record<
  ReportContextRuleField,
  readonly string[]
>;

export function getReportContextValues(
  contexts: readonly ReportContext[],
): ReportContextValues {
  const valueOf = (context: ReportContext, field: ReportContextRuleField) => {
    switch (field) {
      case 'surface':
        return context.surface;
      case 'clientName':
        return context.client?.name;
      case 'clientVersion':
        return context.client?.version;
      case 'clientPlatform':
        return context.client?.platform;
      default:
        return assertUnreachable(field);
    }
  };

  const distinctValues = (field: ReportContextRuleField) => [
    ...new Set(
      contexts.flatMap((context) => {
        const value = valueOf(context, field);
        return value ? [value] : [];
      }),
    ),
  ];

  return {
    surface: distinctValues('surface'),
    clientName: distinctValues('clientName'),
    clientVersion: distinctValues('clientVersion'),
    clientPlatform: distinctValues('clientPlatform'),
  };
}
