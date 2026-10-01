# Live API tests

Tests named `*.live.test.ts` call real third-party APIs with real
credentials. They check that Coop's requests still match what each provider
accepts, which mocked unit tests can't catch when a provider changes its API.

They are excluded from the unit and integration suites and run only with:

```bash
(cd server && npm run test:live)
```

In CI, `.github/workflows/live_api_checks.yaml` runs them nightly, on demand,
and on changes to the paths it lists. Credentials come from the `live-api`
GitHub Environment. Pull requests from forks skip the job because GitHub
doesn't pass secrets to them.

## Adding tests for a provider

1. Put the test next to the code it covers, named `<provider>.live.test.ts`.
2. Read credentials and IDs with `requireLiveTestEnv`, so a missing variable
   fails the run instead of skipping it.
3. Assert on behavior that won't drift: response shape, error handling, and
   loose thresholds on unambiguous inputs. Don't assert exact model scores.
4. In the workflow, add the provider's code to the `paths` filters and its
   variables to the test step's `env`. Secrets go in the `live-api`
   environment; non-secret IDs can be environment variables (`vars`).
5. Use a dedicated test account, and pin model or labeler versions where the
   provider supports it, so results don't change underneath the test.
