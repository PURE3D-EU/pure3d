# Security hardening checkpoint

Baseline: `4e08e78`, 3 November 2026. Authorised: local fixes following the application
security review, including removal of the tracked database backup. Not authorised:
Git history rewriting, commits, production credential rotation, schema migration or deployment.

## Requirements

- [x] Remove the tracked database ZIP from the working tree and ignore database archives.
- [x] Restrict proposal verdict transitions and private membership/query/file access.
- [x] Make contact throttling concurrency-safe; disable raw storage deletion in API and UI.
- [x] Repair native backend fixtures. CI now supplies the checksum-pinned real backend binary.
- [x] Prevent private browser data and Gemini keys surviving account changes; remove auth cookie.
- [x] Repair obsolete feedback submission and catalogue pagination.
- [x] Update vulnerable editor/sanitiser/development dependencies compatibly; upstream constrained advisories remain documented.
- [x] Restrict local service exposure without changing established ports or production defaults.
- [x] Review integrated changes and record focused security verification and remaining limits.

## Ownership

- Backend worker: hooks, schema, native backend tests and relevant access-rule scripts.
- Frontend worker: `src/`, excluding generated Paraglide files.
- Coordinator: backup removal, dependency manifests, local configuration, CI and documentation.

Concurrent unrelated changes appeared in `AGENTS.md` and `docs/legacy-backup-recovery.md`;
preserve them and exclude them from this task's verification claims.

## Outstanding operational work

The backup remains retrievable from Git history until separately authorised coordinated removal.
Historical credentials need a private reuse assessment and rotation if still valid. Local hook and
schema changes do not protect production until separately approved and safely deployed.
Existing private `.env` lacks `MINIO_ROOT_PASSWORD`; Compose correctly refuses to start without
an explicit local value. Synthetic-environment Compose validation passed without touching `.env`.
Focused headless browser privacy/logout journeys passed; detailed evidence and remaining audit
advisories are recorded in `docs/security-hardening.md`. The final PocketBase 0.40.3 backend
security batch passed: 38 tests, zero failures, 988 assertions. The lexical query guard rejects
cross-record paths while preserving supported public credit searches. Baseline fixture/cleanup
failures are repaired. The coordinator also preserved and tested the local Compose service
origin in CLI guards. Full application typecheck/lint/build remain deferred until finalisation.
Backend evidence is in the task temporary `pure3d-backend-security/` folder.
