# Open calls

Open calls are records in `open_calls`, editable by administrators under **Admin → Open Calls**.
Each record has a title, optional short description, cover image and deadline, rich-text body,
publication flag and sort order. The short description is plain text, up to 300 characters, and
appears on homepage cards and embedded calls. If it is left blank, cards keep using an
excerpt from the body where available.
Upload square cover artwork under **Admin → Open Calls** (JPEG, PNG or WebP, up to 10 MB).
Cards show the complete artwork without cropping; calls without covers retain their text layout.
Existing production installations need the separately authorised additive schema migration before
deploying the updated editor. It adds only missing fields and preserves existing records and permissions:

```sh
bun --env-file=.env scripts/migrate-open-call-presentation.ts         # read-only preflight
bun --env-file=.env scripts/migrate-open-call-presentation.ts --apply # verified backup and field additions
```

Only published calls are publicly readable; administrators can also read drafts. All writes
require an administrator. Rich content references published editions rather than copying metadata.

The CMS **Insert component → Open calls** picker stores record IDs, not copies of their content:

```html
<div data-cms-open-calls="true" data-open-call-ids="record-id,another-record-id"></div>
```

Editing a record updates every placement. Unpublished or missing records do not appear publicly.
Do not embed open calls inside another open call.
Concurrent editor changes are protected by record-version checks. Calls referenced by pages or
proposals cannot be deleted; unpublish a call instead, or remove its references first.

The landing page automatically displays published calls immediately below the hero, in display
order, excluding calls whose deadline has passed (UTC calendar date). Calls without a deadline stay
visible. The homepage and embedded calls use the same cards and keyboard-accessible dialog for the
live rich-text body and example editions.
The section is hidden when there are no current calls or the backend is unavailable.

Proposals optionally reference a call through `editions.proposalOpenCall`; an empty relation means
**General submission**. New selections must be published and within their deadline. Submitted
proposals retain their selected call and submission metadata after a call closes.

The additive production relation migration is separate from the initial call extraction:

```sh
bun --env-file=.env scripts/migrate-proposal-open-call.ts
bun --env-file=.env scripts/migrate-proposal-open-call.ts --apply
```

It verifies a fresh ZIP and SQLite backup before writes, retains all existing field IDs and rules,
and reads the relation schema back without changing existing edition content.

## Production migration

Use production-specific credentials from the protected `.env`. The script validates the approved
backend origin and never falls back to local credentials.

```sh
bun --env-file=.env scripts/migrate-open-calls.ts          # read-only preflight
bun --env-file=.env scripts/migrate-open-calls.ts --apply  # back up, create schema, copy calls
```

The apply command creates a fresh PocketBase backup, downloads a private copy and checks its ZIP
integrity before changing the schema. It copies the two current thematic calls from the guide with
slug `calls`, including their edition references, and verifies record/schema/public-read readback.
It refuses to overwrite changed records. Historical call-for-projects articles are not modified.

The original page remains intact until the supporting frontend and PocketBase CMS hooks have been
deployed with separate explicit authorisation. After both deployments, replace the inline content
with live references:

```sh
bun --env-file=.env scripts/migrate-open-calls.ts --apply --link-page
```

This also creates and verifies a fresh backup and refuses to modify a source page changed during
the migration. It preserves the introduction and section heading. Do not run `--link-page` against
an old frontend: it cannot render the new component. Hook deployment is separate from schema
migration; follow `AGENTS.md` for backup, comparison, atomic installation and health verification.
