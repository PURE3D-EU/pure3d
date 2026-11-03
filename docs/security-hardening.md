# Application security hardening

This records the local repairs following the October 2026 source review. It is not a
production penetration-test report or a claim of ASVS compliance.

## Backup exposure

The tracked `pocketbase/pb_data 27-nov-25.zip` has been removed from the current tree.
Database archives, SQLite files, MinIO data and logs are ignored. The backup contained
historical user and superuser authentication records. No credential values belong in this
document or in a review transcript.

Removing the file does **not** remove it from prior commits, forks or existing clones.
An operator must privately assess reuse of those accounts, passwords and token keys, rotate
anything still valid and invalidate affected sessions. Coordinated history removal requires
separate explicit approval; do not force-push or rewrite history as an automatic cleanup.

## Local services

Docker publishes PocketBase, MinIO and the frontend only on `127.0.0.1`. Native Vite Make
targets also bind to loopback. Container-internal listeners remain reachable within the
development Docker network. Do not expose the demo stack to an untrusted network.

Compose now requires private local `POCKETBASE_ADMIN_PASSWORD` and `MINIO_ROOT_PASSWORD`
values instead of supplying predictable fallback passwords. Existing `.env` files were not
edited, and running services were not restarted. Supply missing local passwords before the
next start; never reuse production credentials. The application-level demo accounts remain
an explicitly local development facility, not a production authentication method.

The PocketBase image is pinned to the documented 0.40.3 rehearsal target and an inspected
image digest. The MinIO server digest matches the locally installed
`RELEASE.2025-09-07T16-13-09Z` image. These pins make updates deliberate; they are not evidence
of a container-vulnerability scan. Helper images are not security-certified by these pins.

## Dependencies

The editor family is updated together, including ProseMirror's malicious-paste fix. DOMPurify,
sanitize-html, Svelte and the compatible SvelteKit 2/Vite 7 toolchain are updated. `bun audit fix`
also updates vulnerable transitive versions within supported dependency constraints. Compatible
Paraglide 2 and ESLint 9/TypeScript-ESLint updates remove the remaining high-severity
localisation and lint-tooling advisories without changing application framework generations.

The dependency audit still exits non-zero for upstream constrained dependencies: SvelteKit 2
and cookie, deepmerge, minimatch under lint tooling, and postcss-selector-parser under
Tailwind typography. The recorded audit reports six distinct low/moderate advisories across
these five package names, with no high/critical advisories remaining.
These are not silently ignored or forced through incompatible overrides; assess their actual
call paths separately from browser/backend exploitability. A full SvelteKit 3/tooling migration
is not disguised as a small security patch.

## Backend boundaries

- Reviewers submit reviews; they cannot directly PATCH an edition into an accepted/rejected
  proposal state. The trusted unanimous-approval path remains available.
- Membership list/view rules follow parent visibility and access, including private sandbox
  ownership. Hidden collection-file downloads recheck parent access; public covers remain public.
- Non-superuser filter/sort input is restricted to schema-local fields and supported JSON paths.
  Private workflow fields, cross-collection lookups and relation traversals are rejected before
  native query evaluation. PocketBase still parses the grammar. Public credit predicates and
  quoted searches containing protected field names are covered by real-backend journeys.
- Native PocketBase already rejected the tested `@collection` requests and excluded the tested
  private sibling before these changes. The guard now also rejects admitted relation paths;
  this is defence in depth, not a claim that every relation boundary was exploited or proved.
- Contact admission reserves per-client and global quotas atomically. Client keys are HMACs with
  a process-local random secret rather than stored raw IP addresses. SMTP is replaced only at
  the external transport boundary in disposable feature tests.
- The touched schema bootstrap/repair commands require explicit credentials and restrict their
  target to loopback or the established `http://pocketbase:8090` Compose service origin. Repair
  restores the checked-in private read rules rather than blanket public access.

The original sandbox fixture dependency was already present at the implementation baseline.
Existing native-suite cleanup defects were repaired by deleting workflow children before parents,
not by relaxing production relations. Assignment sequencing preserves the original assertions.
The disposable OAuth fixture registers before production guards in one hook file, avoiding
PocketBase's nondeterministic cross-file registration order; deployed hooks are not reordered.

## Destructive storage operations

Raw storage-key deletion is deliberately unavailable. PocketBase's filesystem interface exposes
unconditional deletion, so checking size/time first cannot protect a replacement uploaded between
the check and delete. The authenticated DELETE route now fails closed with 501 and never deletes;
the storage UI removes the dead controls and explains the limitation. Inventory and download remain
available. Re-enabling deletion needs provider-supported conditional/version deletion or equivalent
coordination covering every writer, not another metadata check.

## Security verification

Final focused backend evidence on 3 November 2026:

- `PB_TEST_BINARY=/security/pocketbase bun --no-env-file test pocketbase/tests` passed:
  **38 tests, zero failures, 988 assertions**, PocketBase 0.40.3 / Bun 1.4.2 in the cached Docker
  runtime. The final source/dependency snapshot was mounted read-only, with no external network
  and only temporary writable test storage. Production hooks, schema, fixtures, CLI scripts
  and dependency manifests were hash-compared with the working tree.
- After the coordinator preserved the established Compose service origin in the new CLI guard,
  the native Bun 1.4.4 / PocketBase 0.39.7 `local schema commands` journey also passed:
  **one test, 20 assertions**. The entire 0.40.3 batch above was then rerun on that final state.
- The first coordinator Docker replay omitted the snapshot's dependencies and failed before
  feature execution. Dependencies were copied into the isolated snapshot; the corrected run
  above passed. Earlier baseline teardown/assignment/preflight failures are resolved, not skipped.
- Scoped backend syntax/ESLint/format checks passed during repair. Integrated scoped
  `git diff --check` also passed. These do not replace the deferred full application gates.

Focused frontend evidence on 3 November 2026:

- Offline real-SDK probes exercised catalogue pagination beyond 500 records, complete counts,
  logout clearing, late-result rejection and auth-owner lifecycle handling. Edited Svelte
  components compiled successfully. These were execution probes, not a delivered browser suite.
- Headless Playwright in an isolated security-test context exercised startup cleanup with
  synthetic localStorage/cookie fixtures and real IndexedDB. Sensitive legacy cache/key/cookie
  values were cleared; the legacy gallery record was retained, not deleted.
- A synthetic identity through the real PocketBase auth store followed by logout caused an
  actual document navigation to the public home; an old-document marker did not survive.
  Backend requests were replaced at the HTTP boundary for that identity probe; no real login,
  content write or Google request occurred. An initial probe used the wrong heading selector;
  it was corrected and the journey passed.
- The storage page with a synthetic administrator and HTTP inventory fixture displayed its
  deletion explanation, no Delete controls and an available Download control. The generic HTTP
  fixture does not emulate realtime SSE, producing expected subscription errors in that probe;
  realtime acceptance was not claimed.
- The local home page rendered with the updated dependencies. Its existing local backend
  returns 404 for `open_calls`; no schema bootstrap was run to hide that environment gap.
- Compose configuration parsed successfully with synthetic passwords. Without an explicit
  `MINIO_ROOT_PASSWORD`, the existing private environment correctly fails the new start guard.
- `bun --no-env-file audit --audit-level high` passed: 445 packages checked, six advisories
  below the threshold. The unfiltered audit still exits 1 for those six lower-severity entries.
- Full typecheck/lint/build and the wider browser matrix remain deferred until finalisation.

CI installs the official checksum-pinned PocketBase 0.40.3 Linux executable and exports
`PB_TEST_BINARY` before feature tests in both pull-request and automatic-release workflows.
Native tests must exercise disposable databases, never the configured local or production DB.
See [testing](testing.md) for the public-entry-point feature suites and remaining browser gaps.

Use OWASP ASVS 5.0 as the review checklist, evaluating Level 2 for this editorial system.
Prioritise cross-role direct API requests, draft/public boundaries, file access, rejected and
stale writes, hostile editor content and account-switch races over a large count of isolated
helper tests. Dependency scanners complement these journeys; they do not replace them.

## Deployment boundary

Local hook/schema changes do not alter production. Deploying hooks, applying access rules or
file protection, credential rotation, reviewing live CSP/HSTS/CORS/rate limits, and production
backup/restore checks each retain their approval and safety requirements in `AGENTS.md`.
Schema changes require a verified fresh backup and read-back; a frontend release cannot apply
them. No production access is needed to implement or run disposable local security journeys.
