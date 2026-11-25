# ORCID Attribution and Rollout

## Existing Account Sign-in

An exact, unique, canonical ORCID stored on an existing user is treated as a curated
account mapping. On the first successful ORCID OAuth sign-in, the backend links that
identity to the existing account and retains its role; no separate pending approval is
required. A pending mapping remains available when no ORCID is stored. New ORCID users
receive a regular account. Names and email addresses alone never authorize linking;
duplicate ORCIDs and conflicting external identities fail closed. Stored ORCIDs are
therefore security-sensitive, especially on privileged accounts: curate and audit them
before inviting users, and never set `orcidVerifiedAt` without OAuth proof. Admins can set
an exact ORCID on an unverified account via `POST /api/pure3d/orcid/curated/{userId}` with
`{ "orcid": "https://orcid.org/..." }`. It rejects invalid IDs, existing different mappings,
duplicates and external-link conflicts; it never sets verification or changes roles.

## Missing-Algorithm JWKS Recovery

For an already configured ORCID-only deployment, deploy the current `pocketbase/pb_hooks/`
files and restart PocketBase first. Then, with superuser credentials injected privately:

```sh
POCKETBASE_URL=https://api.pure3d.eu bun --no-env-file scripts/configure-orcid.ts --update-jwks
```

This command confirms a new PocketBase backup, changes only the existing provider's
`extra.jwksURL`, and checks the saved OAuth configuration. It does not require the ORCID client
secret, rotate session signing secrets, rerun schema/onboarding dispositions, or change identities.
Do **not** rerun `--apply` for this repair. Pause concurrent provider-settings edits during the update.
If operating through SSH, `POCKETBASE_URL=http://127.0.0.1:60131` may address the tunnel;
the persisted JWKS URL still comes from the backend's authenticated `/api/pure3d/orcid/config`.

The bridge is `GET /api/pure3d/orcid/jwks`. Its expected verifier URL defaults to
`http://127.0.0.1:8090/api/pure3d/orcid/jwks`, using PocketBase's existing container listener.
No public-origin environment variable is needed for OVH. For a different backend listener only,
set **PocketBase's startup environment** `ORCID_JWKS_ORIGIN=http://127.0.0.1:PORT`, restart it,
then run `--update-jwks`. Only an explicit IPv4 loopback HTTP origin with a valid port is accepted.
The frontend URL, `meta.appURL`, request Host and operator's tunnel are never used as key sources.
Full `--apply`, OAuth hooks, linked-account checks and readiness use the same expected bridge URL.
After repair, check `/api/pure3d/orcid/ready` and perform a real ORCID sign-in separately.

## Readiness and Credit Audit

`GET /api/pure3d/orcid/ready` is a public, no-store deployment check for installed hooks, OAuth
configuration and the required schema. It intentionally does not scan every credit record, so release
probes remain cheap as the catalogue grows. Operators can run the authenticated superuser-only
`GET /api/pure3d/orcid/credits-audit` endpoint when they need the full canonical-credit audit. That
audit is no-store and scans collections, editions and linked identities; do not add it to public health
checks or frequent monitoring.

Public-source verification: ORCID's [JWKS](https://orcid.org/oauth/jwks) contains RSA `use: sig`
keys without `alg`; its [discovery document](https://orcid.org/.well-known/openid-configuration)
advertises `id_token_signing_alg_values_supported: ["RS256"]`. PocketBase
[0.40.3 JWK lookup](https://github.com/pocketbase/pocketbase/blob/v0.40.3/tools/auth/internal/jwk/jwk.go)
requires a matching `kid` **and nonempty `alg`**, explaining the production error.

The bridge fetches only the allowlisted ORCID issuer's `/oauth/jwks` over HTTPS (production or
explicit sandbox). It validates the key set, rejects private/non-RSA/non-signing keys and explicit
algorithms other than RS256, and supplies RS256 only when absent. It returns only public signing-key
fields, with no cache and a ten-second upstream timeout; failures return 502 without upstream bodies.
PocketBase still performs the actual RS256 signature, audience, issuer and expiry validation;
the existing stricter identity-proof hooks remain unchanged apart from the expected JWKS location.

The disposable 0.40.3 integration test reproduces the raw missing-alg failure, then runs the actual
bridge handler with only ORCID HTTP transport stubbed to a generated RSA public key. A valid signed
token passes native verification and reaches the hook's intentional test-provider rejection;
tampered signatures, audience, issuer, expiry and an explicit mismatched key algorithm fail earlier.
This is synthetic regression evidence, **not a live ORCID authentication claim**.

## Author Credits

ORCIDs are optional for creator and contributor credits in the application. Submission and
publication still require at least one creator, and any supplied ORCID must be valid. Use the
person's confirmed identifier; do not invent one or infer it from a name. Legacy migration
safeguards and verified account requirements are separate from credit attribution.

Adding a co-author to a proposal gives them credit, not access. Neither proposal
approval nor signing in with that ORCID grants editing rights automatically. After approval, the
submitting author can use the **Team** tab on the edition's Workflow page to add the co-author's account as a
collaborator once they have signed in.

The canonical ordered JSON field on both `collections` and `editions` is `credits`:

```ts
type Credit = {
	type: 'person' | 'org';
	name: string;
	orcid: string | null; // https://orcid.org/NNNN-NNNN-NNNN-NNNX, valid MOD 11-2 checksum
	role: 'creator' | 'contributor';
	provenance: 'manual' | 'oauth';
	userId?: string;
	contributionRole?: string;
};
```

ORCID belongs to a person, not an organization. Organization credits have `orcid: null`, no
`userId`, and manual provenance. A manually approved identifier is attribution evidence, not OAuth
ownership proof. A linked account must already have matching verified ORCID and exactly one matching
`oidc` external identity. This migration never sets user identity, verification timestamps,
memberships, or permissions, and never manufactures OAuth provenance.

## Safe Inventory

These commands are operator instructions, **not evidence that production has been migrated**.
Use the current branch, keep private reports outside the repository, and never commit credentials,
reports, database backups, or private source JSON. Inject `POCKETBASE_ADMIN_EMAIL` and
`POCKETBASE_ADMIN_PASSWORD` from a secret manager or a protected environment. Do not put secrets in
CLI arguments, URLs, shell history, screenshots, or debug logs. `--target` is mandatory; neither
inventory nor migration defaults to a production or local database. Remote targets require HTTPS;
plain HTTP is permitted only for loopback.

```sh
bun run report:authors --target https://POCKETBASE_ORIGIN --output /PRIVATE_EXISTING_DIRECTORY/orcid-review.json
bun run migrate:orcid-credits --target https://POCKETBASE_ORIGIN --manifest /PRIVATE_EXISTING_DIRECTORY/orcid-review.json
```

Replace the placeholder origin and directory explicitly. Both commands default to read-only remote
operations: authentication, inventory, schema/identity reads, and preflight. They do not create a
server backup, change schema, disable login, or update records. The inventory writes one **new** local
file with mode `0600` and refuses to overwrite it. It reports counts, not names or credentials, to
stdout; failures never dump SDK responses. Files contain attribution and record snapshots and must
be handled as private review material. Protect the containing directory as well.

The inventory covers creators **and** contributors on both collections and editions, including
hidden/draft records. Existing canonical credits are retained where present; otherwise it converts
`dcCreator`, then `dcContributor`, without trimming names, splitting commas, deduplicating, sorting,
or linking accounts. A scalar string is one credit, not a comma-separated list. Invalid legacy
shapes fail closed rather than drop entries. `dcInstitution` remains contextual metadata and is not
silently converted into authorship. Snapshots include all original fields, including legacy fields,
so reviewers can compare existing canonical attribution against legacy attribution.

Inventory also reads only `id`, `name`, `nickname`, `username`, `orcid` and `orcidVerifiedAt` from
`users`. Each person credit's private `profileCandidates` lists every account matching an existing
credit user ID, canonical ORCID, or normalized profile name. Evidence includes the exact account ID,
stored ORCID, `verifiedAt` timestamp, source field and original matching value. Name normalization
includes case/punctuation and comma-name variants for suggestions only; credited text is unchanged.
Multiple matches remain separate entries so name/ORCID collisions and conflicting accounts are visible.
Email addresses and private auth fields are not used for matching or fetched for this report.

**Every profile candidate is `unapproved`, even if unique or already OAuth-verified.** Candidates do
not populate credit ORCID/userId fields or review evidence and migration ignores the candidate list.
Reviewers must confirm identity and explicitly approve the mapping; application/runtime name matching
is not restored. A profile timestamp is reported evidence, not a substitute for the migration's live
verified-account/external-auth checks.

Optional public ORCID candidate suggestions:

```sh
bun run report:authors --target https://POCKETBASE_ORIGIN --output /PRIVATE_EXISTING_DIRECTORY/orcid-candidates.json --lookup-orcid
```

Use this flag when asking the tool to **try to find ORCIDs automatically**. It searches only person
credits missing an identifier, including optional contributors. Check the privacy policy and obtain
authorization to disclose those names first. `ORCID_ENVIRONMENT=production` (default) searches
`https://pub.orcid.org`; `ORCID_ENVIRONMENT=sandbox` searches `https://pub.sandbox.orcid.org`.
This is public search, not sign-in: no PocketBase credentials or provider tokens are sent to ORCID.

Queries are quoted with Lucene special characters escaped and encoded using URL parameters. Names
longer than 500 characters are skipped. Calls are sequential, with a one-second pause between requests,
a ten-second request timeout, at most 100 distinct-name requests per run, and at most five candidate
identifiers per credit. Repeated exact names reuse search evidence but retain every indexed credit.
There are no automatic retries. Do not repeatedly rerun a rate-limited report to evade provider limits.

Private `suggestions` entries contain the record fingerprint and credit index, candidate identifiers,
and search evidence (API source, escaped query, timestamp and HTTP status when available). Outcomes
are `candidates`, `no-results`, `denied`, `rate-limited`, `unavailable`, or `skipped`. A 401/403 denial,
429 rate limit, network failure or malformed response halts further requests **without losing the
inventory**: the command still saves the manifest and marks remaining lookups skipped. The 100-request
bound also leaves remaining credits in the report. Raw API/error bodies, names and tokens are not logged.

Suggestions never change credit status, evidence, ORCID, provenance, or account links, and migration
ignores them. Inspect the private report, independently confirm candidates with the authors, and
record actual approval evidence in the credit review. Search evidence alone is not identity proof,
even for one result. On denial or no match, use manual author confirmation; never fabricate a mapping.
Without `--lookup-orcid`, no requests are made to ORCID.

## Review Manifest

Keep an immutable copy of the initial inventory in protected storage. Have an authorized reviewer
edit a separate copy. The manifest contains `version: 1`, exact `target`, and per-record collection,
ID, SHA-256 fingerprint, original snapshot, review status, and indexed credit reviews. Fingerprints
cover every record field except PocketBase's `updated` timestamp; the original timestamp is also
checked before first application. Fingerprints detect conflicts, not malicious edits or reviewer
identity: protect files and retain reviewer approval in your controlled change record.

For each credit, preserve `index`, `name`, and `role` exactly. Duplicate names have separate indices
and each requires review. Set `status` and a nonempty `evidence` reference (author confirmation,
institutional evidence, reviewer/date or controlled ticket). Evidence must substantiate identity,
not merely record that a search returned the same name.

- `pending`: not reviewed; cannot be applied as part of an approved record.
- `unresolved`: reviewed but not identified; preserve original type/ORCID/account link unchanged.
- `approved`: explicitly approve `type`, canonical checksum-valid `orcid`, and optional `userId`.
- For an approved organization, use `type: "org"`, `orcid: null`, and omit `userId`.
- An approved person contributor may have `orcid: null`; any supplied identifier must still be valid,
  and an account link always requires a matching verified ORCID.
- For a manually mapped person, do not add an OAuth provenance claim. Existing proof cannot be replaced.

Example credit review, **illustrative only, not identity evidence**:

```json
{
	"index": 0,
	"name": "Doe, Jane",
	"role": "creator",
	"status": "approved",
	"evidence": "Replace with actual author confirmation and reviewer/date",
	"type": "person",
	"orcid": "https://orcid.org/0000-0002-1825-0097"
}
```

Set the **record** `status` to `approved` only when every indexed entry has evidence and is either
approved or explicitly unresolved. Leave other records `pending` or mark them `blocked`; neither
will be changed. An approved draft may retain unresolved person creators, but cannot be submitted or
published until their ORCIDs are resolved. An active record (visible collection or non-draft/published
edition) with unresolved person creators is rejected before writes by default; keep it blocked and
resolve the queue unless using the explicit PRE-HOOK preservation mode below.
A contributor without ORCID does not block publication or migration of an otherwise reviewed record. The migration
does not unpublish, hide, delete, relabel, or overwrite existing identity proof to force progress.
Zero creators is also a publication blocker. Empty legacy attribution needs separate author review,
not fabricated defaults.

Do not remove records to manufacture a clean queue. Preflight may process an approved subset; that
is **not** a complete rollout check. Compare a fresh full inventory and its IDs with the original,
verify every credit including contributors, and track skipped/unresolved records to closure.

## Backup-Gated Apply

Test on a restored, isolated copy first. Arrange a maintenance window that stops application writes,
background jobs, and other administrators. PocketBase's REST record API has no atomic compare-and-swap
PATCH, so snapshots alone cannot close the read/write race. `--maintenance-confirmed` is an operator
assertion, not a server lock. Do not supply it until isolation is real.

```sh
bun run migrate:orcid-credits --target https://POCKETBASE_ORIGIN --manifest /PRIVATE_EXISTING_DIRECTORY/orcid-reviewed.json
bun run migrate:orcid-credits --target https://POCKETBASE_ORIGIN --manifest /PRIVATE_EXISTING_DIRECTORY/orcid-reviewed.json --apply --maintenance-confirmed --audit /PRIVATE_EXISTING_DIRECTORY/orcid-apply-NEW.jsonl
```

Apply performs full approved-record preflight and linked-account proof checks first. If changes are
needed, it creates a uniquely named `orcid-credits-*.zip` through **PocketBase's backups API** and
confirms a nonempty entry in the backup listing **before any schema or record write**, on every target.
Missing backup permissions or an unconfirmed backup aborts. No-op reruns perform no remote backup or writes,
but an apply run still records a private audit of its skipped results.
Backup API success is not a restore test: separately verify backup storage, retention, encryption,
download access, and restore capability. PocketBase backups do not replace independent R2/MinIO asset
backups; this migration never changes object-storage paths or assets.

After backup, apply rechecks record and schema snapshots, adds only a missing JSON `credits` field
to each collection, and updates only approved `credits` arrays. It does **not** call
`configure-orcid.ts`, bootstrap scripts, schema import, or login cutover. It checks each record again
immediately before writing and reads it back to verify exact stored content. Deletions, identity
remapping, legacy-field cleanup, and publication state changes are deliberately absent. Source fields
remain intact. Re-running the same reviewed manifest recognizes exact applied content and skips it.
Other content changes require a fresh inventory and review. A schema-only partial run exposing null
credits can be resumed without altering the snapshot.

The run is not a transaction across records. On failure, stop and inspect privately; earlier writes
may have succeeded. Keep the original manifest and confirmed backup, run read-only preflight again,
and investigate conflicts or hook normalization before retrying. Do not overwrite fingerprints to
suppress conflicts. For rollback, use PocketBase's supported backup restore procedure only under a
separately approved maintenance operation; restoring a database can discard later unrelated writes.

### PRE-HOOK Legacy Preservation

`--preserve-unresolved` is an explicit maintenance-only choice to preserve exact legacy attribution
before deploying ORCID hooks, not author identity approval or a publication exemption. It can retain
existing active publication states with unresolved creators (or no creators); normal submission and
publication validation remains unchanged. Do not remove installed hooks to make this mode pass.

```sh
bun run migrate:orcid-credits --target https://main.57-129-98-223.sslip.io --manifest /PRIVATE_EXISTING_DIRECTORY/orcid-preservation-reviewed.json --preserve-unresolved
bun run migrate:orcid-credits --target https://main.57-129-98-223.sslip.io --manifest /PRIVATE_EXISTING_DIRECTORY/orcid-preservation-reviewed.json --preserve-unresolved --apply --maintenance-confirmed --audit /PRIVATE_EXISTING_DIRECTORY/orcid-preservation-NEW.jsonl
```

- The authenticated `GET /api/pure3d/orcid/config` must return **HTTP 404**. A successful response,
  authentication failure, network error or any other status fails closed. The tool checks at preflight
  and again immediately before each schema or record write; isolate writers and hook deployments
  throughout the maintenance window because these checks are not an atomic lock.
- Every selected record must be `approved`, with original `credits` absent, null or an empty array.
  Every indexed credit must be `unresolved` with nonempty review evidence and unchanged type, ORCID
  and account link. The result must exactly equal the legacy `dcCreator`/`dcContributor` conversion:
  no approved identity mappings or mixed preservation/identity-resolution records in this mode.
- Names, order, duplicates, legacy source fields and publication states remain intact. The converter's
  default person type is provisional and still needs person/organization review. No identities,
  memberships or OAuth proof are created. Pending/blocked records remain skipped.
- Apply retains the same fresh confirmed backup, exclusive private audit, snapshot checks and exact
  readback gates described above. The audit and summary record `preserveUnresolved`; publication
  blockers remain reported. Exact reruns are skipped, not treated as identity approval.

Rehearse on a restored copy, preserve the private manifest/audit and unresolved queue, verify parity,
then deploy the complete hooks and perform the separately authorized login cutover while traffic is
restricted. Resolve attribution before subsequent submission/publication. Account deferral below is
a separate explicit choice and does not resolve author credits.

### Private Apply Audit

`--apply` requires `--audit NEW_PRIVATE_FILE`; read-only runs reject `--audit` and create no audit.
The file must not already exist and its containing directory must exist and be protected. The audit
opens with exclusive creation and mode `0600` after manifest validation/authentication and before
migration preflight or any backup/schema/data operation. Invalid arguments, unreadable manifests,
failed authentication or an existing/unwritable audit path can fail before an audit starts; none of
those cases performs migration writes. Never reuse a prior audit path or use the manifest path.

The audit is append-only **JSONL**: each newline is one JSON event, flushed with `fsync` before the
next operation. It records the target, run ID and manifest record fingerprints, backup request and
confirmation, schema-write acknowledgements, record-write intent, per-record results and a completed
or failed run footer. Every event carries the same reserved `backupId` (`orcid-credits-<runId>.zip`).
The identifier alone is not backup proof: require a `backup` event with `status: "confirmed"` and
`backupConfirmed: true`. Failed preflight/backup or no-op runs may never create that reserved backup.
Events written before confirmation correctly retain `backupConfirmed: false`.

Per-record `record` results are keyed by backup ID, collection and record ID:

- `applied`: PATCH succeeded and a separate readback matched the expected fingerprint. The audit
  includes the complete committed readback, expected/readback fingerprints and `committed: true`.
- `skipped`: `not-approved`, `already-applied`, or `run-aborted-before-write`. Already-applied records
  include matching readback and `committed: true`, but `writeAttempted: false`; no PATCH occurred in
  this run. Other skipped records have no readback and `committed: false`.
- `failed`: records the failing phase, write-attempt/acknowledgement flags and available readback,
  without SDK error bodies or credentials. If PATCH may have reached the server, failure handling
  reads the record again without retrying PATCH. `committed: true` means expected content was observed
  despite the error; `null` means the write outcome is unconfirmed. A pre-write failure is `false`.

Successful results are durable **before the next record write**, not only at process shutdown.
Caught failures append the failing record, remaining unattempted/skipped results and failed footer
before closing the file. Disk failure or abrupt termination can leave an incomplete final JSONL line
or an intent without a result/footer; preserve completed lines and treat the last write as uncertain.
Investigate with fresh read-only inventory before retrying. An audit failure stops further writes;
the audit is not a database transaction or a substitute for a tested backup.

Audits contain private attribution/readback data. Do not log their contents, publish them as frontend
assets or commit them. Keep each audit beside its immutable reviewed manifest and confirmed backup
in protected operator storage. Aggregate console counts alone do not establish which records committed.

## ORCID Registration

1. Register the application in ORCID's developer tools with the actual production owner and support
   contact. Obtain legitimate client credentials; missing client ID/secret blocks cutover. Users can
   obtain their own identifiers at `https://orcid.org/register`.
2. Register the **exact public PocketBase callback** used by the SDK OAuth flow, normally
   `https://POCKETBASE_ORIGIN/api/oauth2-redirect`. It is not the static frontend `/register` page.
   Verify the redirect URI generated by the deployed client/SDK and its reverse proxy, including
   scheme, hostname, path, and trailing-slash behavior; register it exactly, without wildcards.
3. Use separate sandbox registrations, secrets and databases. Configure with
   `ORCID_ENVIRONMENT=sandbox` and start the sandbox PocketBase hooks with
   `ORCID_ISSUER=https://sandbox.orcid.org`. Production uses `ORCID_ENVIRONMENT=production` and
   `ORCID_ISSUER=https://orcid.org` (both default to production when omitted). Cutover verifies
   that the hooks' reported issuer agrees with the selected environment. Do not switch environments
   on a database holding identity mappings. Sandbox identifiers are stored in the same canonical
   `https://orcid.org/...` format, so database isolation is essential. Use HTTPS callbacks in production
   and register each environment's exact callback separately under ORCID's registration rules.
4. Store `ORCID_CLIENT_ID` and `ORCID_CLIENT_SECRET` only in the protected backend/operator
   environment. Never expose the secret as `PUBLIC_*`, browser config, a query parameter, source code,
   or a log. Run configuration without shell tracing. Restrict PocketBase superuser and settings access.
5. The configured provider is PocketBase generic **`oidc`**, with production authorization
   `https://orcid.org/oauth/authorize`, token `https://orcid.org/oauth/token`, issuer
   `https://orcid.org`, JWKS `http://127.0.0.1:8090/api/pure3d/orcid/jwks` (the normalization bridge),
   empty `userInfoURL`, and PKCE enabled. Sandbox uses `https://sandbox.orcid.org` for the issuer
   and upstream `/oauth/...` endpoints; the same bridge path fetches sandbox keys, with public
   profile refresh from `https://pub.sandbox.orcid.org`. The client explicitly requests
   **`scopes: ['openid']`**. The current configuration notes that
   PocketBase v0.35 does not persist a scopes setting. Do not assume the generic OIDC defaults work;
   verify actual provider requests and ORCID registration support for the requested scope. Do not
   replace ID-token proof with public profile lookup or silently widen scopes.
6. Use the SDK's state/PKCE OAuth handling and trusted exact callback; never accept arbitrary callback
   or post-login redirect URLs. Verify issuer, signature/JWKS, audience/authorized party, subject,
   expiration, and matching account link. Backend hooks reject name/email-based automatic linking.
   Check the actual deployed PocketBase version supports the configured ID-token verification path.
7. Existing accounts need a separately approved pending mapping through the private admin endpoint:
   `GET /api/pure3d/orcid/pending/{userId}` to inspect and
   `POST /api/pure3d/orcid/pending/{userId}` with `{ "orcid": "https://orcid.org/..." }` to propose
   the confirmed identifier (`null` clears it). Back up before this separate data operation too.
   Do not patch identity fields directly. Only the real owner's subsequent ORCID authentication
   establishes OAuth proof. Do not fabricate verification timestamps or external-auth records.
8. `POST /api/pure3d/orcid/profile-refresh` refreshes public profile fields after verified login.
   The client attempts it after successful sign-in; an outage does not undo verified sign-in and
   users can retry from Profile. Do not imply private ORCID data access or that search results verify ownership. Confirm
   provider access/refresh tokens and raw profile payloads are absent from browser auth responses,
   application storage, telemetry, and default logs.

## Deployment and Cutover

The production backend is `https://api.pure3d.eu` on the existing OVH service. PocketBase uses that
origin's `/api`; assets use `/assets/project/...`, retaining all legacy project paths. GitHub Pages
serves the separate frontend at `https://pure3d.eu` with an empty `APP_BASE_PATH`, and
`https://www.pure3d.eu` redirects to the apex.

The existing ORCID application needs the exact callback
`https://api.pure3d.eu/api/oauth2-redirect` registered and its application URL set to
`https://pure3d.eu`. This documentation does not claim that the external registration or DNS cutover
has executed. Verify the SDK-generated redirect against that registration before enabling sign-in.

The SvelteKit app is a **static SPA**. Deploying the frontend does not deploy PocketBase hooks.
Production needs a separate deployment of the complete `pocketbase/pb_hooks/` directory, including
`orcid.pb.js`, `orcid-service.cjs`, `orcid-validation.cjs` and the required `review-service.cjs` helper,
followed by the service's supported reload/restart. Do not deploy only the hook entrypoint. Verify the authenticated read-only
`GET /api/pure3d/orcid/config` returns `backend: "pure3d-orcid-v1"` and the expected `issuer` from
the PocketBase process's `ORCID_ISSUER`. Test schema/hook compatibility on
the restored database before touching production; restrict public traffic during staged deployment.

`scripts/configure-orcid.ts` is a separate cutover tool. Its no-argument dry run is offline:

```sh
bun --no-env-file scripts/configure-orcid.ts
```

Preparation and cutover are separate, mutually exclusive commands:

```sh
# Writes fields/indexes only, after a confirmed backup; no ORCID client secret required.
POCKETBASE_URL=http://localhost:60021 bun scripts/configure-orcid.ts --prepare

# First approve and read back pending mappings with the private admin endpoint.
# Then, in an isolated maintenance window, with matching hooks issuer and real client credentials:
POCKETBASE_URL=http://localhost:60021 ORCID_ENVIRONMENT=sandbox bun scripts/configure-orcid.ts --apply
```

These examples target local PocketBase and are not automatic startup steps. Both write modes require
`POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL` and `POCKETBASE_ADMIN_PASSWORD` from the protected operator
environment. `--prepare` checks schema/identity compatibility, creates and verifies a fresh backup,
aligns fields and indexes (including private `pendingOrcid`), and reads back the prepared identity
fields. It preserves existing login methods, API rules and token signing settings. It neither grants
approval nor requires existing privileged accounts to have already approved mappings, so administrators
can prepare the schema **before** using the pending-mapping endpoint. Preparation is not a cutover and
does not yet configure an ORCID provider or revoke sessions.

After preparation, approve and read back the exact privileged mappings. `--apply` requires the private
identity fields to exist; it refuses an unprepared schema. It aligns profile/credit/membership fields,
indexes and API rules, enables `oidc`, and disables user password/OTP/MFA and automatic profile mapping.
It additionally requires `ORCID_CLIENT_ID` and `ORCID_CLIENT_SECRET`.
Set `ORCID_ENVIRONMENT` explicitly for an operator run and set matching `ORCID_ISSUER` on PocketBase.
Before any schema/auth writes, the configuration CLI preflights schema and identities, checks
privileged account mappings, then creates a fresh `orcid-config-*.zip` through PocketBase's backups API
and confirms its nonempty listing. Backup/preflight failure prevents those writes. It rechecks
privileged accounts after schema alignment, before disabling legacy login, then reads back the saved
auth configuration. In the same collection update that disables legacy login, it replaces the
`users` authentication-token signing secret with a new random secret. **All existing `users` sessions
become invalid**, including previously verified ORCID sessions; users must sign in with ORCID again.
Repeating `--apply` rotates the secret again. `_superusers` login and sessions are unchanged. Do not
print, export or manually copy token signing secrets. Verify old users JWT access/refresh is rejected
after cutover rather than assuming a disabled password button invalidates issued tokens.

Schema/auth updates are not transactional: retain the backup, isolate writers in
a maintenance window, and investigate any partial failure before retrying.

Privileged accounts include `admin`/`editorial_board` users, collection owners/editors, and **all**
edition membership accounts. Each must have either matching verified ORCID/external-auth proof or an
administrator-approved canonical `pendingOrcid` with no conflicting external link. Non-declined review
assignments also require a mapped reviewer. Missing mappings block the default strict cutover; a pending
mapping is not verified ownership until the real user authenticates. Keep
superuser recovery access and test the backup restore separately. Configuration does not reconcile
author credits, so complete the reviewed credit workflow separately.

### Explicit Unmapped-Account Cutover (Issue 70)

The operator has authorized an ORCID-only cutover for
`https://main.57-129-98-223.sslip.io` while preserving the 66 unmapped privileged/member accounts with
their existing roles and memberships. This is authorization, **not evidence of execution**. The tool
does not hard-code that target, read a prior private inventory as permission, or contact it by default.
Jesse must first exist as a real global `admin` with a separately approved, read-back `pendingOrcid`
(or matching verified ORCID/external-auth proof). Do not fabricate an account or approval to pass this gate.

After the existing preparation, real admin mapping, backup/restore rehearsal and writer isolation,
an operator can explicitly choose the following mode. Keep credentials in the protected environment:

```sh
POCKETBASE_URL=https://main.57-129-98-223.sslip.io ORCID_ENVIRONMENT=production bun scripts/configure-orcid.ts --apply --defer-unmapped --onboarding-report /PRIVATE_EXISTING_DIRECTORY/orcid-cutover-NEW.json
```

- `--apply` alone remains strict. The two new flags must be supplied together, in the order shown,
  only with `--apply`. Missing paths, duplicate/unknown flags and combinations with `--prepare` fail.
- Both modes require at least one **global admin** with matching verified identity proof or an
  administrator-approved canonical pending mapping. A superuser, editorial-board member, candidate
  ORCID or timestamp without its matching external link does not satisfy this requirement.
- Only genuinely absent approved/verified mappings can be deferred. Canonical stored but unverified
  ORCIDs are candidate evidence only. Malformed/duplicate identifiers, mismatched verified identities,
  invalid pending mappings, unrelated external providers, dangling account or collection/edition
  references, schema conflicts and issuer mismatches still fail. Deferral never catches and ignores
  a preflight error. Identity validation includes nonprivileged accounts too.
- The report contains `version`, exact target/issuer, timestamp, operator superuser ID, explicit
  `operatorChoice: "defer-unmapped-preserve-roles-disable-login"`, reserved `backupId`, and one entry
  per deferred account. Entries contain the account ID, `requestedRole` (the existing global role),
  existing membership/assignment IDs, targets, roles/stages/statuses, stored `orcidCandidates` marked
  `unapproved`, and `status: "require_identity_linking"`. No names are matched, no external candidate
  search runs, and no identity verification is asserted or written.
- The containing directory must already exist and be private. The report is exclusively created
  (`wx`), mode `0600`, fully written, `fsync`-flushed and closed **before even requesting the backup**,
  and before schema/auth changes. Existing files and symlinks are not overwritten. File creation,
  write, flush or close failure prevents those operations. Never put this report in Git or public assets.
- The immutable report records `status: "preflight_confirmed"` and
  `backupStatus: "confirmation_required"`: it is an intent snapshot, **not backup or cutover success
  evidence**. The CLI then creates that exact backup and requires a nonempty backup API readback before
  schema/auth writes. Confirm the report's backup ID against PocketBase and retain separate execution
  evidence. A failed backup leaves the report intact; every retry needs a new report path.
- The final preflight revalidates all identity/admin requirements and compares the deferred-account
  snapshot, including role/membership/candidate state, before disabling legacy login. The guard is
  generated only from live trusted preflight; no input report or guard JSON is accepted. A changed
  snapshot aborts auth cutover, but preceding schema changes may already have occurred. Maintenance
  isolation is still mandatory because REST checks cannot eliminate the final read/write race.
- No account, role, membership, pending mapping or verified identity is granted, deleted or downgraded.
  Password/OTP login is disabled and all old user JWTs are revoked. Deferred accounts cannot regain
  their existing privileged access until an admin approves the exact pending mapping and the owner
  signs in with ORCID. The report is never automatically consumed as approval. `_superusers` recovery
  remains unchanged; content attribution and publication gates remain separate.

### Native Backend Rehearsal

The issue-70 target's operator-specified backend version is PocketBase **0.40.3**. Run the complete
backend suite on the official native binary against disposable loopback databases, never the OVH origin:

```sh
PB_TEST_BINARY=/ABSOLUTE/PRIVATE/PATH/pocketbase bun --no-env-file test pocketbase/tests
PB_TEST_BINARY=/ABSOLUTE/PRIVATE/PATH/pocketbase PB_TEST_ORCID_ENVIRONMENT=sandbox bun --no-env-file test pocketbase/tests
```

The integration rehearsal exercises strict rejection, missing report/admin gates, exclusive private
report creation before backup, backup failure, the actual defer CLI with 66 synthetic accounts, exact
user/membership preservation, and old JWT rejection. Existing tests also exercise backend authorization,
pending approval, native OIDC/JWKS verification, readiness, trusted activity and strict cutover.
These are synthetic local checks, not a real ORCID login or production restore test.

The 0.40.x JSON implementation can vary object key ordering. The deferred snapshot is constructed with
explicit fields and stable ID sorting; provider `extra` readback uses structural equality, not JSON
key order. The 0.40.3 rehearsal requires no backend-hook or SDK changes for the exercised auth, backup
and schema APIs. Release notes also state that 0.40.0 backup generation no longer transaction-locks
the database, reinforcing the requirement to isolate writers rather than treating backup as a lock.

Never use broad
`create-pocketbase-collections.ts`, `make install`, the compose setup chain, or bootstrap imports to
reconcile production data.

The credit migration is independently callable before login cutover, including before the new hooks
are deployed. When hooks are already installed, preflight uses their validator and refuses any
normalization/rejection of reviewed content before writes. The current backend preserves exact names,
whitespace, contribution-role text and duplicate credit entries. Do not disable validation to push
through public unresolved authors. The explicit PRE-HOOK preservation mode above must precede hook
deployment; it is not a post-deployment bypass. Plan both stages in the maintenance window.

## Local Provisioning and Author Onboarding

The local compose setup uses the PocketBase **superuser** to bootstrap schema, documentation,
legacy users and content. The retired `scripts/seed-users.js` was removed after verifying there were
no active callers; it is not a supported provisioning path. Imported users are unverified accounts
with randomly generated bootstrap passwords, not ready-to-use author logins. No ORCID, pending
approval, verification timestamp or external identity is fabricated by import.

For a new isolated sandbox, configure the PocketBase service with
`ORCID_ISSUER=https://sandbox.orcid.org` (the compose service passes this variable through), and use
`ORCID_ENVIRONMENT=sandbox` for operator configuration/lookup commands. Keep sandbox credentials and
data separate from production. Superuser bootstrap remains available without creating an anonymous
application user or using an imported user's password. Do not point the setup service at production.

The active importer can finish while author onboarding remains pending:

```sh
# Local bootstrap only; credentials come from the protected environment.
POCKETBASE_URL=http://localhost:60021 bun scripts/import-data.ts --onboarding-dir data/import-onboarding
```

Compose invokes the same importer with `/app/data/import-onboarding`, persisted through its checkout
bind mount as `data/import-onboarding/` on the host. This ignored directory is created with mode
`0700`; an existing directory must already be private and must not be a symlink. Each pending run
creates a new `edition-author-onboarding-<uuid>.json` with exclusive creation, mode `0600` and flushed
writes. Protect its ownership as well as permissions; keep it out of Git, public exports and logs.
The importer prints the report location, pending-author count, other missing-target count and next
steps without printing names, source rows or credentials.

Every **new author assignment** is staged for explicit review, even if its account is already
verified. Existing author memberships are left untouched. Legacy edition `editor` maps to requested
`author`; it is never silently changed to `collaborator`. Eligible reader/collaborator/reviewer
memberships continue to import normally. Missing user or edition targets are also preserved in the
report instead of disappearing. Duplicate pending source rows retain separate indices.

Each pending entry records the original `editionUser.json` row, source index/fingerprint, original
edition ID and user hash, candidate PocketBase IDs (or null), requested role, reason, `status: "pending"`
and empty approval evidence. These fields preserve legacy membership intent, not account identity
proof or granted access. The report is written **before any edition-membership creates**; report
failure stops that phase. If a later create fails, the report survives. Earlier content-import phases
may already have completed. Preserve the original source JSON for retries and auditing.

Onboarding is an explicit administrative workflow:

1. Keep the generated report immutable and record review in a separate protected copy/change ticket.
   Verify the edition's `mongoId` against `legacyEditionId` and the user's `userHash` against
   `legacyUserHash`. Candidate IDs from import are not approval. Resolve missing or conflicting
   targets explicitly; do not link by matching names or invent missing users.
2. Obtain the actual owner's ORCID confirmation and record reviewer/date/evidence. Use the protected
   pending-ORCID endpoint for an approved account mapping, with the required backup and deployed
   onboarding schema/hooks. On an existing database, run `configure-orcid.ts --prepare` first if its
   private identity fields are not present; do not use `--apply` to try to skip the approval phase.
   A source membership or a public search hit is not OAuth ownership proof.
3. Complete provider configuration only after its privileged-account preflight is satisfied. Have
   the real user authenticate with ORCID. Confirm their canonical ORCID, verified timestamp and
   matching external identity before adding an `author` membership. A pending mapping alone is
   insufficient for the backend's author-membership gate.
4. Through the authorized membership workflow/API, grant exactly the reviewed edition/user/role.
   Check for an existing assignment first. Do not downgrade roles to work around validation. Record
   the granted membership ID in the protected review record.
5. Re-run the local importer if needed: existing granted assignments are skipped and remaining
   intent gets a fresh report. Prior reports and reviewer evidence are never overwritten or consumed
   automatically. Reconcile the latest queue against earlier reports and the original source.

The onboarding report is **not** the credit migration manifest. Neither importer nor credit migration
automatically applies reviewed membership reports. Configuration preflight examines actual accounts
and memberships, not this private file: operators must account for deferred author intent separately.
An import-complete message means content import finished, not that author access, ORCID sign-in or
publication readiness has been approved.

### Retired Exporter

`scripts/export-from-pocketbase.ts` was removed after checking the repository for callers and finding
none outside the script itself. It used the obsolete `projects` collection, old admin authentication,
CLI password arguments, lossy `dcCreator` strings and a one-page export into frontend assets. The
active app reads PocketBase `collections`/`editions` and canonical ordered `credits` directly; there
is no replacement static-export startup step. Use PocketBase's supported backups for full database
recovery, and `report:authors` for private attribution inventory (not a whole-database backup).

### Current Release Blockers

- Unresolved person creators (except the explicit PRE-HOOK preservation step above), missing privileged-account mappings (unless explicitly deferred as above), issuer/environment disagreement,
  schema conflicts or an unconfirmed backup block the relevant migration/cutover step. Contributor
  ORCIDs are optional; do not relabel a real author as a contributor to evade the author requirement.
- The active legacy importer is local bootstrap only and writes canonical credits for new records,
  preserving duplicates and names. Imports with unresolved person creators stay draft/hidden;
  original JSON remains the attribution/publication-history source. It skips existing records and is
  **not** production migration. Hooks allow superuser bootstrap user/content creation without identity
  assertions, while still enforcing credit/publication validation. New author assignments are preserved
  in the private onboarding queue so bootstrap can finish without bypassing verified-ORCID checks.
  Unreviewed assignments still block completion of author onboarding, not unrelated content import.
- Production credentials, ORCID registration/scopes/callback, the deployed provider sign-in flow,
  PocketBase version, verified legacy-account mappings, and unmatched authors require real operator
  verification. No successful production rollout or OAuth round trip is claimed by these scripts.

### Verification Checklist

- Run `bun run test:orcid-migration`, `bun run check`, and the formatting/lint checks before deployment.
- Rehearse backup failure, stale manifests, duplicate authors, organizations, unresolved co-authors,
  and a partial-run retry against a restored isolated database. Verify backup restore independently.
- Check both record collections: counts, creator/contributor order, exact names, duplicates, canonical
  checksums, approved links, unchanged legacy fields, and unchanged publication states/assets.
- Resolve every pending/blocked attribution record and every unresolved individual author before publication; keep
  the reviewed queue as an auditable artifact. Optional missing contributor ORCIDs are not author
  blockers. Review existing canonical credits against legacy fields.
- Reconcile the private author-assignment onboarding reports separately; verify exact source targets,
  approved mappings, real ORCID ownership and the final requested membership roles. No seed-password
  account or unreviewed report entry should provide author access.
- Exercise real ORCID registration and sign-in on desktop/mobile; check state/PKCE, callback, scope,
  expired/wrong issuer/audience tokens, duplicate identities, and rejected automatic name/email linking.
- Confirm public browsing remains possible, OAuth-only login is enforced, `_superusers` recovery still
  works and role/membership checks hold. A missing ORCID on a credit no longer blocks
  submission or publication in the application.
- Confirm `--prepare` preserves login, rules and existing sessions; then verify `--apply` rejects old
  users JWT access/refresh, requires fresh ORCID sign-in and preserves superuser sessions. Rehearse
  missing prepared fields, unapproved privileged mappings and backup failure before rollout.
- Confirm protected profile refresh and pending mapping authorization, no token leakage, and production
  hook health after restart. Do not switch frontend traffic until these checks pass.
- Only after separately verified attribution parity, queue closure, backup/restore approval and an
  explicit cleanup change may legacy source fields be removed. Neither script offers a cleanup flag.
