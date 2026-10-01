import { trace } from '@opentelemetry/api';
import { ScalarTypes } from '@roostorg/coop-types';

import { requireLiveTestEnv } from '../../../../../test/live/requireLiveTestEnv.js';
import { isCoopErrorOfType } from '../../../../../utils/errors.js';
import SafeTracer from '../../../../../utils/SafeTracer.js';
import { fetchHTTP } from '../../../../networkingService/index.js';
import { type SignalInput } from '../../SignalBase.js';
import { getZentropiScores, runZentropiLabelerImpl } from './zentropiUtils.js';

const apiKey = requireLiveTestEnv('ZENTROPI_API_KEY');
const labelerId = requireLiveTestEnv('ZENTROPI_TEST_LABELER_ID');
// Pinned rather than "latest", so editing the labeler doesn't change results.
const labelerVersionId = requireLiveTestEnv('ZENTROPI_TEST_LABELER_VERSION_ID');

const tracer = new SafeTracer(trace.getTracer('noop'));
const fetchScores = getZentropiScores.bind(null, async (query) =>
  fetchHTTP(tracer, query),
);

async function run(
  text: string,
  opts: { apiKey?: string; labelerVersionId?: string } = {},
) {
  const versionId = opts.labelerVersionId ?? labelerVersionId;
  return runZentropiLabelerImpl(
    async () => ({
      apiKey: opts.apiKey ?? apiKey,
      labelerVersions: [{ id: versionId, labelerId, label: 'CI' }],
    }),
    {
      value: { type: ScalarTypes.STRING, value: text },
      orgId: 'live-test',
      subcategory: versionId,
    } as SignalInput<ScalarTypes['STRING']>,
    fetchScores,
  );
}

describe('Zentropi API (live)', () => {
  it('scores clearly violating content high', async () => {
    const result = await run('I am going to find you and kill you');
    expect(result.score).toBeGreaterThan(0.8);
  });

  it('scores clearly benign content low', async () => {
    const result = await run('Have a nice day!');
    expect(result.score).toBeLessThan(0.2);
  });

  it('reports an unknown labeler version as a permanent error', async () => {
    await expect(
      run('test', {
        labelerVersionId: '00000000-0000-0000-0000-000000000000',
      }),
    ).rejects.toSatisfy((e) => isCoopErrorOfType(e, 'SignalPermanentError'));
  });

  it('reports an invalid API key as a permanent error', async () => {
    await expect(run('test', { apiKey: 'zt_invalid' })).rejects.toSatisfy((e) =>
      isCoopErrorOfType(e, 'SignalPermanentError'),
    );
  });
});
