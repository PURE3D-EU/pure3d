# Feedback email delivery

Visitors and members submit through `POST /api/pure3d/feedback`, not through the admin-only
collection API. The endpoint saves the note and any screenshots together, applies submission
limits, and never sends mail inline. Screenshot downloads require an admin file token.
Deploy `feedback-submission.pb.js` and `feedback-email-service.cjs` before releasing the matching
frontend. No collection rule change or schema migration is needed to accept feedback.

Feedback email is disabled unless `PURE3D_FEEDBACK_EMAIL_ENABLED=true`. A feedback submission is
queued only when that opt-in is already enabled, so enabling it later does not replay feedback
submitted while delivery was disabled. SMTP must also be enabled before the worker sends mail.

The worker runs every five minutes, processes at most 50 queued feedback records, and stops retrying
after five attempts. Recipient records are loaded once per run and sent as BCC recipients without an
extra copy to the configured sender address.

Delivery is **at least once**, not exactly once. The attempt is persisted before SMTP delivery and
the sent timestamp afterward. If SMTP accepts the message but saving the sent timestamp fails or the
process stops in that window, a later retry can send a duplicate. Feedback content and submission
state remain stored regardless of delivery failure.

Fresh local setup includes the queue fields and index through `scripts/create-pocketbase-collections.ts`.
For an existing database, review the dry run and then explicitly target the intended PocketBase:

```sh
bun scripts/add-feedback-email-queue-fields.ts
POCKETBASE_URL=https://explicit.example \
PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... \
bun scripts/add-feedback-email-queue-fields.ts --apply
```

The apply command has no default origin and refuses to run without all three explicit environment
variables.
