# Session changelog

- 2026-11-12 · OpenCode · File sizes: implemented metadata-only size retrieval and labels for model, companion and shared file uploads; not yet verified on an authenticated workflow.
- 2026-11-12 · OpenCode · Screenshot: local preview responds, but the isolated browser redirects the edition workflow to the homepage without authentication, blocking a screenshot of the changed panel.
- 2026-11-12 · OpenCode · Authenticated browser panel: captured the updated workflow and confirmed visible sizes of 75.1 MB for the model and 3.8 KB for the scene; no content changed.
- 2026-11-12 · OpenCode · Landing page: restored only the three-stage illustrated cards to their version immediately before commit 4e08e78 (3 November), including original copy, images and responsive styles. Confirmed assets exist and diff whitespace check passes; no browser verification or tests run.

- 2026-11-12 · OpenCode · Landing illustration concept: displayed a chat-only three-card Vlooienburg mockup using one simplified canal-side block as wireframe, annotated model and edition-review illustration; application code unchanged this iteration.

- 2026-11-12 · OpenCode · Landing illustrations: implemented three lightweight Vlooienburg-inspired SVGs for model study, annotation and review, preserving card layout and copy. Local browser confirmed all three assets loaded and captured the rendered cards; tests not run (not requested).

- 2026-11-12 · OpenCode · Illustration rollback request: inspected current checkout and found the Vlooienburg mockup already removed, with original capture/annotate/review images and alt text restored; no application edits needed. Awaiting partner design.

- 2026-11-12 — OpenCode — Hero: removed the “Source Edition –” prefix; retained the edition title credit and link. No tests run (not requested).

- 2026-11-12 · OpenCode · Edition descriptions: removed the default-viewer plain-text branch and reused the existing sanitised ContentRenderer for all viewer layouts, retaining view-preset buttons. Prettier parsed/formatted the changed Svelte file; browser verification and tests not run (not requested); not deployed.

- 2026-11-13 · OpenCode · Rich-text display follow-up: traced editor-backed fields and public renderers; fixed HTML-bearing edition/collection search snippets, catalogue suggestions, Imagine preview and meta descriptions using shared sanitised text extraction. Collection-card and admin-feedback previews now also decode entities and preserve paragraph spacing.
- 2026-11-13 · OpenCode · Verification: Prettier processed affected files and the Svelte compiler parsed all eight changed components successfully; existing CMS bodies, collection descriptions, peer reviews, viewer help and story sanitisation inspected. No browser-wide verification, tests or deployment performed.

- 2026-11-13 · OpenCode · Security follow-up: created and read back Task #115 to track rollout reconciliation, private credential/history decisions, residual advisories and deferred non-test delivery checks; linked it to this session. No application edits, tests or production operations performed.
