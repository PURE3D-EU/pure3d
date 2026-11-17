# Model health and optimisation — #117

Branch: `main`. Issue: https://github.com/PURE3D-EU/pure3d/issues/117

## Agreed scope

- Editor action opens a responsive, keyboard-accessible model health/settings modal.
- Browser-side bounded self-contained GLB analysis and byte-preserving lossless repacking.
- Explicitly lossy JPEG colour-texture reduction; no simplification or precision reduction.
- Real viewer preview, measured savings and download before explicit application.
- Preserve source `modelFile`; save viewing copy into existing companion fields with an updated scene.
- Atomic stale-protected apply and restore, with previous scene retained and capability gate.
- No production deployment, schema migration, commits or pushes. No application tests authorised.

## Progress

- Created issue #117 and linked it to the session.
- Implemented modal UI, settings, worker cancellation, measured savings, download and real Voyager
  preview approval; edition assets coordinate upload/editor mutual exclusion.
- Implemented bounded GLB analysis, exact binary deduplication/JSON compaction and opt-in eligible
  JPEG reduction in a dedicated worker, without new dependencies.
- Implemented capability-gated atomic apply/restore with unchanged source `modelFile`, preserved
  companions, signed history, stale-file guards and safe single-model scene mapping.
- Preserved signed history through subsequent Voyager scene saves. Added Blob preview overrides
  rather than uploading preview files or modifying the generated Voyager runtime.
- Inspected returned implementation and corrected GLB asset type, source aliases, unsafe numeric
  metadata, decoded memory bounds, cancellation races and post-save confirmation.
- Existing dirty newsletter, landing-page and 3d-lab changes remain unrelated and untouched.

## Delivery evidence and boundaries

- Focused Svelte compiler invocation compiled the two changed editor components without warnings.
- Existing Vite server returned HTTP 200 for the modal, processor and worker module transformations.
- Node syntax checks passed for the three affected backend hook/service files; scoped diff
  whitespace checks passed. These are compilation/syntax observations, not runtime verification.
- Application tests, typechecks, lint sweeps and production builds were not run. No browser save,
  optimisation or restore journey was exercised; runtime behaviour remains unverified.
- Initial implementation performed no commit, push, schema migration or deployment. Incompatible
  backends retain local analysis/preview/download but cannot apply or restore.

## Authorised production hook deployment — 17 November 2026

- User committed/pushed implementation (`666e29a`) and separately authorised the backend update.
- Re-discovered PocketBase 0.40.3 in `pure3d-archive-pocketbase-1` on the approved production host.
  Confirmed existing `modelFile`, `modelAssets` and `sceneDocument` fields; no schema migration needed.
- Compared installed hooks; preserved unrelated differences. Backed up the complete installed hook
  directory and verified it under root-owned mode-700
  `/var/backups/pure3d-model-optimisation-20261117T152329Z`.
- Installed only the two new optimisation hook files and changed Voyager save service, with staged
  and installed SHA-256 verification and atomic per-file replacement. Restarted only PocketBase;
  bounded readiness retries recovered from the initial empty HTTP response without rollback.
- Verified local/public health, fresh production admin authentication, authenticated
  `viewing-copy-v1` capability with advertised limits, anonymous capability rejection (401),
  read-only edition access, unchanged database file fields, file ownership/modes and unchanged
  unrelated hook checksums. Cleaned up only task-owned staging files; retained rollback backup.
- Existing Voyager capability rejects superuser credentials (403) because its unchanged route
  requires the `users` auth collection; this initial probe mismatch was explained by the installed
  registration. No user impersonation or permission changes were used.
- No production model/content saves, optimisation/restore journeys or application tests performed.
  Deployment verification does not establish end-to-end save or visual correctness.
