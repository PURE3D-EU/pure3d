# CMS component editing

## Implemented

- Shared visible Edit, Select, Move up/down, Duplicate and Delete controls, separate from
  serialised/public HTML, for every insert-menu component and images.
- Labelled cancellable forms for component settings, list items, profile links and media;
  current/past profile transfers apply atomically in one editor transaction.
- Editable column/expandable/callout content, preserved CMS parsing on every shared editor
  surface independently of insertion feature flags, and blocked preview link navigation.
- Reactive toolbar state, undo/redo controls and parent-content synchronisation which does
  not emit dirty updates or overwrite history on selection changes.
- Image library/upload/replacement/removal, alternative text, captions and image titles.
- Backend column validation handles nested profile sections without relaxing URL validation.

## Verification

- Browser integration journey in `scripts/browser/cms-editor-journey.mjs`: actual CMS page,
  imported-format content, all component editors, lists, profile transfer, media, cancellation,
  undo/redo, block operations, Save changes, reload and actual public rendering. External
  PocketBase HTTP calls are intercepted; synthetic administrator only, no remote writes.
- Desktop and 390×844 mobile journey passed. Mobile profile dialog has no horizontal overflow.
- Typecheck: zero errors, 15 warnings elsewhere. Production static build passed.
- Scoped formatting, ESLint, hook syntax and whitespace checks passed on the final state.
- Independent review found outer callout editing affected nested callout styles. Fixed with a
  position-specific transaction; the expanded desktop and mobile browser journeys pass the
  regression and insertion/removal of every insert-menu component. Keyboard Enter/Edit and
  Escape/cancel were also exercised directly.

## Backend verification and limits

Native backend coverage was extended in `pocketbase/tests/open-calls.integration.test.ts`.
The default host run skipped both tests; the available Linux ARM64 binary cannot run directly
on macOS. The blocker was resolved using the already-installed `oven/bun:1` Docker image
(Bun 1.4.2), a read-only checkout/binary mount and `--network none`: **2 tests passed, 103
assertions, zero failures** against a disposable real PocketBase instance. Host checks/build
used Bun 1.4.4. No installation, backend deployment or production save was attempted.

Cancelling discards document changes, but an asset already uploaded remains in the media
library, matching the CMS's existing upload semantics. Explicit record selection/order is
supported for edition/open-call components; no query/filter/display modes exist in their
stored format. New editing controls do not invent unsupported modes.
