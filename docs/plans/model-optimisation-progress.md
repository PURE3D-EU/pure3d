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
- No commit, push, schema migration or deployment performed. Install the three documented backend
  files together only after separate deployment approval; incompatible backends retain local
  analysis/preview/download but cannot apply or restore.
