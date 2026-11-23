# Releases

Every non-release push to `main` automatically creates a semantic release for
`PURE3D-EU/pure3d`. Pull requests and manual workflow dispatches run read-only CI
(Conventional Commit PR title, feature integration tests, Svelte/TypeScript checks). The automatic
workflow builds and publishes an exact archive, then explicitly calls the reusable Pages workflow;
it does not rely on its `GITHUB_TOKEN` tag push starting another workflow. No npm/store publisher
applies because this is a private-package static web app.

## Automatic release and local fallback

For the milestone 9 proposal changes, deploy the updated PocketBase `proposal-service.cjs` before
adding the optional `editions.proposalModelReferences` text field from `pocketbase/pb_schema/collections.json`.
The hook protects the new field and updates proposal validation. Back up and verify the schema
change before publishing the frontend, which expects the new field when saving a proposal. Keep the
legacy `proposalType` field and its data; the form no longer uses it. The unpublish action (#78)
separately requires the route in `orcid.pb.js` and the handler in `admin-workflow-service.cjs`.
The follow-up admin republication action also needs the updated `publication-service.cjs`. It
uses existing unpublish audit records, so editions already withdrawn through this workflow can
be republished without a schema change or a new review. It does not restore a peer review badge
for the revised version.

Main-push releases always run with `--patch`: maintenance commits receive a patch release, while
`feat` and breaking commits still take precedence and produce minor and major releases. Release
runs are serialized and are never cancelled. The job checks out the current `main`, fetches again
during release preflight, and requires it to match `origin/main`. If source moves while gates run,
the final non-forced atomic push is rejected rather than overwriting it. A later queued main run can
release the newer tip. The release commit is pushed with `GITHUB_TOKEN`, so it does not recursively
start this workflow. The hosted job retries the stateful release command up to three times on the
same runner, allowing its journal and exact archive to reconcile transient push/publication response
failures before the run fails.

The local commands remain available for preview and as an optional manual fallback:

```sh
make release-dry-run
# Optional fallback only after explicit authorisation, from clean main with dependencies installed:
make release
# Explicitly release maintenance-only commits as a patch:
make release-dry-run RELEASE_ARGS=--patch
make release RELEASE_ARGS=--patch
```

Dry-run reads local files and Git history only. It prints the proposed version, dated notes,
steps, and blockers even from a dirty feature branch. It does not fetch, install, run checks,
build, write files/state, stage, commit, tag, or publish. Cached origin/main and tags cannot
prove current remote synchronization; this limitation is printed explicitly.

A real automatic or local release requires a clean index and working tree (including untracked
files), `main`, full history, and an existing stable `vX.Y.Z` baseline. It fetches origin/main and
tags, then requires HEAD to equal origin/main. Divergence is rejected; no automatic pull/rebase occurs.
Valid prerelease tags are ignored when choosing the stable version baseline; malformed reachable
`v*` tags are rejected rather than guessed.
The highest reachable stable version is the baseline; commits in `tag..HEAD` determine:

| Commit                                                                      | Release |
| --------------------------------------------------------------------------- | ------- |
| `fix:` or `perf:` (optional scope)                                          | patch   |
| `feat:`                                                                     | minor   |
| Any Conventional Commit with `!`, `BREAKING CHANGE:`, or `BREAKING-CHANGE:` | major   |
| Other commits                                                               | none    |

Major bumps apply literally, including 0.x. No qualifying commits means no release by default.
An explicit `--patch` includes maintenance commits in the notes and applies at least a patch bump
when there are commits since the last release. It never reduces an inferred minor/major bump or
creates a release with no new commits. Retry journals retain their original version and notes.
Squash PR titles must use Conventional Commit syntax; squash titles become main's commit messages.

For an explicitly authorised milestone, add a `Release-As: 2.0.0` trailer to the source commit.
The automatic pipeline uses that exact stable version. It must exceed the latest stable release
and cannot reduce the inferred semantic bump. Conflicting version trailers block the release.
This still runs all normal gates, archive verification and Pages deployment.

The Bun script updates `package.json` and `CITATION.cff` version plus citation release date,
and prepends UTC-dated categorised notes to `CHANGELOG.md`. Bun's lockfile has no root version
field. Schema, CFF format, dependency and bundled Voyager versions are independent, not bumped.
Existing historical versions are not fabricated into a new changelog.

`release.config.mjs` lists the automatic and local fallback gates: feature integration tests under
`src`, `scripts`, and `pocketbase`, Svelte/TypeScript checks, the existing ORCID backend readiness
gate (network access only during an authorised real release), then existing production build and
tar packaging. PocketBase binary integration tests remain separately opt-in and are not claimed as
part of these gates unless `PB_TEST_BINARY` is supplied. See [Testing](testing.md) for the retained
workflows and coverage limits. Dependencies must already be installed; no release-time install.
The build targets the custom-domain root at `https://pure3d.eu` and the public API/assets at
`https://api.pure3d.eu`.
It creates `build/404.html`, `build/version.json`, and ignored `pure3d-vX.Y.Z.tar.gz`.
The version metadata records the tested source commit before the version-only release commit;
retries retain that same source SHA. Build outputs are never committed.

After all gates pass, the release script creates `chore(release): vX.Y.Z` and an annotated `vX.Y.Z`
tag. Signing and commit hooks are disabled for this controlled operation. It atomically pushes
main and the tag (never force), creates or reconciles a draft GitHub Release, uploads the exact
prebuilt archive and its `.sha256` sidecar, verifies downloaded bytes, then publishes the Release.
Existing matching assets are reused; conflicting assets are never overwritten. Published releases
are treated as immutable: missing/different assets block recovery. GitHub Actions uses the scoped
workflow token; the optional local fallback requires configured Git and GitHub CLI authentication.
Repository Actions settings must grant workflows read/write contents access, and branch rules must
allow `github-actions[bot]` to push the release commit to `main`; the workflow never bypasses these
protections or force-pushes. Git pushes that change `.github/workflows/` need a workflow-capable
credential. If HTTPS rejects a workflow update for missing OAuth `workflow` scope, use an
already-authorised SSH key for this repository or explicitly reauthorise HTTPS; do not remove
workflow changes to bypass the rejection. Git transport and GitHub CLI release authentication are
independent.

The reusable `pages.yml` workflow receives the automatic release tag and commit directly. Its tag
trigger remains as a fallback for optional local releases. It waits up to 20 minutes for
publication, downloads only the archive and checksum, verifies SHA-256, version and source parent
commit, rejects unsafe tar members, then uploads the verified site to Pages and deploys it. The verifier supports Python
3.9+: it validates every member before copying only regular files and directories into a fresh
destination. Absolute/traversing paths, symbolic/hard links and special files are rejected;
existing destinations are refused and archive permissions are not restored. No checkout, install or
build runs in that workflow. GitHub Pages must use GitHub Actions as its source. Release publication does
not by itself prove deployment completion; inspect the Pages job.
Prerelease tags can deploy the same way when a matching published GitHub prerelease contains the
prebuilt archive and checksum; they do not alter the stable version baseline. This replaces the
live Pages site, not a separate preview environment.
If publication takes longer than the wait window, finish or rerun the failed release and then rerun
the Pages job. No second tag or release is needed. Repository administrators should enable GitHub
immutable releases for server-enforced protection as well; this tool never replaces assets.

## Failure and retry

A pending release journal lives at `git rev-parse --git-path pure3d-release.json`. It saves the
source SHA, exact before/after contents, chosen date and notes before changing tracked files.
In a persistent local checkout, run `make release` again after resolving a failed gate. Only the
recorded original/prepared file contents are accepted; unrelated changes, moved HEAD, conflicting
tags, or remote movement block recovery. The journal checkpoints the completed build's SHA-256,
atomic push, and publication. Before a build checkpoint, checks/build rerun; afterward retries
require the exact saved archive and skip checks/build. Missing or changed checkpointed bytes block
recovery; restore the original archive.
Retries finish a missing commit/tag, safely repeat the atomic push, reconcile server assets even
when a previous successful response was lost, and remove the journal only after verified
publication. It never duplicates changelog entries or force-replaces tags.
If a gate requires source changes, inspect and abandon the pending release first: restore only
journal-owned changes after reviewing them, unstage those paths, and remove the journal. Do not
remove a completed release commit/tag automatically.

An exclusive `pure3d-release.lock` directory beside the journal prevents concurrent script runs;
workflow concurrency serializes automatic runs. Ordinary failures release the lock. After a killed
local process, verify no release process remains, then remove only that stale lock directory and
retry. Do not delete the journal to bypass checks. Because hosted runners are ephemeral, inspect a
failed automatic run before retrying if it reached the push or publication steps.

For workflow changes, run `bun --no-env-file test scripts/release.test.ts`,
`make release-dry-run`, and `git diff --check`. Never exercise the mutating command in the
project checkout merely to test release tooling.
