# Contributing

This page covers how to get a change into Coop: forking, branching, checking your work, and opening a pull request. For the project's community standards, read the ROOST [Code of Conduct](https://github.com/roostorg/.github/blob/main/CODE_OF_CONDUCT.md) and [Contributing Guidelines](https://github.com/roostorg/.github/blob/main/CONTRIBUTING.md) first.

If you haven't set up Coop yet, start with [Getting Started](README.md) and [Local Development](local.md).

## Fork and branch

1. [Fork roostorg/coop](https://github.com/roostorg/coop/fork) on GitHub.
2. Clone your fork and add the main repository as `upstream`:

   ```sh
   git clone https://github.com/<your-username>/coop.git && cd coop
   git remote add upstream https://github.com/roostorg/coop.git
   ```

3. Create a branch from an up-to-date `main`:

   ```sh
   git fetch upstream
   git checkout -b my-change upstream/main
   ```

Use `pnpm`, not `npm`, and Node 24 (see `.nvmrc`). Don't commit `.env` files or credentials.

## Make your change

- Keep the change small and focused. Put unrelated changes in separate pull requests.
- New behavior needs a test. A bug fix needs a regression test.
- Don't edit `client/src/graphql/generated.ts` or `server/graphql/generated.ts` by hand. Change the GraphQL source, then run `pnpm run generate` from the root.
- If you add or upgrade a dependency, say so in the pull request. Check the license is compatible with Apache 2.0 and that there are no known CVEs.
- If you add a database migration, name the file with a UTC timestamp prefix: `date -u +"%Y.%m.%dT%H.%M.%S"`. Don't edit a migration that has already been applied; add a new one.
- If the change is notable to someone deploying Coop, add one line under `## [Unreleased]` in `CHANGELOG.md`, following [Keep a Changelog](https://keepachangelog.com/en/2.0.0/). See [Releases](releases.md).
- If you change anything user-facing, update the related docs.

Commits that touch staged files run `lint-staged` through a pre-commit hook, so you may see formatting or lint fixes applied when you commit.

## Run the checks

Run these from the repository root before you push. They match what CI runs.

```sh
pnpm install --frozen-lockfile && pnpm run prettier
pnpm run generate && test -z "$(git status --porcelain)"
docker compose run --rm backend pnpm run lint
docker compose run --rm backend pnpm run typecheck
docker compose run --rm backend pnpm run build
docker compose run --rm client pnpm run lint
docker compose run --rm client pnpm run build
docker compose run --rm test
```

To fix formatting, run `pnpm run prettier:fix`. The second command fails if codegen changes any tracked files, which means you need to commit the regenerated output. It also fails if you have other uncommitted changes, so run it on a clean working tree.

If you pass `--build` to `docker compose run`, Compose rebuilds the image first. Without it, Compose only builds when no image exists yet, so you may be testing stale code.

For a quicker local loop, `pnpm run check:prepush` runs typecheck and tests for the server and build and tests for the client. See [Testing](local.md#testing) and [Running CI locally](local.md#running-ci-locally) for more.

## Open a pull request

1. Push your branch to your fork:

   ```sh
   git push -u origin my-change
   ```

2. On GitHub, open a pull request from your branch to `main` on roostorg/coop.
3. Give it a descriptive, imperative title, like "Add X" or "Fix Y".
4. Fill in the [pull request template](https://github.com/roostorg/coop/blob/main/.github/PULL_REQUEST_TEMPLATE.md). GitHub loads it automatically when you open the pull request. It asks for:
   - **Context & Requests for Reviewers:** what changed and why, with a link to the issue if there is one, and anything you want reviewers to look at closely.
   - **Tests:** how you tested the change, including screenshots for UI changes.
   - **Rollout Plan (optional):** anything that has to happen before this can be deployed.
   - **Checklist:** check only the items that apply. They cover docs, the changelog, `NOT NULL` columns in migrations, and error handling in new signals.

## What reviewers look for

- The change is small enough to review in one sitting, and does one thing.
- The description explains the change and how you tested it.
- Tests cover the new behavior or the bug.
- All CI checks pass.
- Docs and the changelog are updated when they should be.
- Changes to auth or session middleware, database migrations, the dependency list, or GraphQL types and fields that other code relies on get extra scrutiny. Removing or renaming a GraphQL type or field breaks existing clients, so raise it in an issue before you start.

Reviewers may ask for changes. Push more commits to the same branch and the pull request updates.

## Get help

Ask in [GitHub Discussions](https://github.com/roostorg/coop/discussions) or on the [ROOST Discord](https://discord.gg/97GQqtNAkE).
