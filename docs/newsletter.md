# Newsletter

The global footer has a public signup form. PocketBase stores subscriptions and plain text
newsletter drafts; administrators manage them at `/admin/newsletter`. Drafts, sending newsletters
and sent newsletters appear in a filterable list. New newsletters and existing records open in
a modal; sent messages are read only. This works with the static
frontend: all privileged operations and email delivery run in PocketBase hooks, not SvelteKit
server endpoints.

## Setup

Local schema provisioning (`make install`) and CMS provisioning (`setupCms`) create the three newsletter collections. Existing collections
are verified, never silently overwritten. The upgrade adds only the four optional consent fields
to existing subscriber collections, with schema read-back. Restart the local PocketBase service after adding hooks.
Configure SMTP, sender name/address and **Application URL** in PocketBase settings. The application
URL must point to the public frontend, including its deployment base path, not the PocketBase API.
HTTPS is required except for local development. No provider credentials belong in frontend code.

Production setup requires separate explicit approval for the schema migration and hook deployment.
Follow `AGENTS.md`'s backup/deployment procedure. The migration's default is a read-only preview:

```sh
bun --env-file=.env scripts/migrate-newsletter.ts
# Only with explicit production migration approval:
bun --env-file=.env scripts/migrate-newsletter.ts --apply
```

The apply command downloads and verifies a fresh backup first, then creates and reads back schema,
permissions and indexes. Deploy `newsletter.pb.js` and `newsletter-service.cjs` separately. Deploy
the frontend before sending confirmation emails so `/newsletter` is available. No existing
accounts are automatically subscribed, and there is no public address list or direct record-write
API. Tokens are hidden from record responses. Confirmation tokens are stored as hashes.

## Subscription workflow

Signup records a pending address and sends a confirmation link, valid for 24 hours. The recipient
must open the link and explicitly confirm before receiving newsletters. Generic responses avoid
revealing membership. Requests are limited by client IP and globally in process memory; an
address can receive at most one confirmation every 15 minutes, persisted across restarts.
Restarting PocketBase resets the IP/global limits, not the address cooldown. At higher traffic,
add edge abuse protection rather than relying on these limits alone.

Every newsletter contains an unsubscribe link. Both confirmation and unsubscribe use private URL
fragments, removed from the address bar on load, and an explicit POST action so email link scanners
do not change subscriptions. Administrators can also unsubscribe an address. Unsubscribed records
are retained as suppression history, not deleted or automatically reactivated.

Administrators can choose **Add subscriber** for people who have already given permission.
An email address, consent note (where and when permission was given) and explicit consent checkbox
are required. The protected route stores the administrator ID, consent source, note and recorded
date. This is an administrator's consent record, not a claim that the address was verified by email;
`confirmedAt` remains reserved for email confirmation. No confirmation or welcome email is sent.
An already subscribed address is left unchanged. A previously unsubscribed address cannot be
reactivated by this route: its owner must use the public signup and confirmation flow again.

The signup form stops waiting after 20 seconds, leaves the address editable and explains that
delivery is uncertain. It never automatically retries: an aborted browser request may still be
processing on the backend, and the persisted address cooldown prevents duplicate confirmations.

## Sending

Save a subject and plain text message, send a test to your own administrator account, then explicitly
confirm sending. Only subscribed addresses are included (email confirmation or recorded admin consent).
Subject, body and audience freeze on the first send. The basic sender supports up to 1,000 subscribers and sends in batches of
five while the admin page remains open. Pause stops after the current batch. Reopen the newsletter
and choose **Continue sending** to process remaining pending deliveries. Unsubscribed addresses
are checked again immediately before delivery.

Each delivery is claimed transactionally before SMTP to prevent concurrent requests from sending
it twice. SMTP is not transactional: a failure or process interruption may leave delivery uncertain.
Failed and interrupted attempts are deliberately not automatically retried. The admin view reports
sent, pending, in progress, failed and skipped counts; “Finished” means no pending/active attempts,
not that every recipient received an email. Sent means accepted by the configured mail transport,
not delivery to an inbox. Investigate uncertain deliveries before creating another campaign.

There is no scheduling, HTML editor, automatic bounce handling, campaign analytics or background
queue in this first version. Configure sender authentication and suitable SMTP limits with your
mail provider. Review privacy/retention requirements before enabling public signups.

## Verification

Run the feature suite against a disposable PocketBase backend using a compatible executable:

```sh
PB_TEST_BINARY=/path/to/pocketbase bun --no-env-file test pocketbase/tests/newsletter.integration.test.ts
```

The suite uses real collections, routes and transactions, replacing only the external email
transport. It sends no real email and never connects to production. Without `PB_TEST_BINARY`,
these tests are explicitly skipped, not counted as verified.
