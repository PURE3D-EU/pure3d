# Newsletter deployment checkpoint

## Current local iteration (not deployed)

- Newsletter editor is now a native modal opened from a list with All, Drafts,
  Sending/paused and Sent filters. Subscriber list has an Add subscriber modal.
- Protected direct-add route requires consent checkbox/note, administrator/date/source provenance
  and suppression protection. No email is sent; previous unsubscribes cannot be overridden.
- Four optional subscriber consent fields added. Local backend upgraded only. A new backed-up
  production schema migration AND hook deployment require fresh approval.
- Both modals opened in an isolated local preview at `http://127.0.0.1:60026/admin/newsletter`.
  The user's production-backed preview on port 60020 was preserved. No subscriber was added.
- Signup hang investigated without retrying or sending emails. Production saved the user's signup
  as pending; its SMTP send failed after about 133 seconds (503). TLS connectivity-only probes
  from the VPS to configured `smtp.mail.ovh.net` ports 465 and 587 both timed out after 8 seconds.
  SMTP is enabled but connectivity is failing; specific firewall/provider cause is not proven.
- Signup UI now has a 20-second abort, clear timeout/service errors and no automatic retry.
  Production email delivery remains blocked; no SMTP settings or network rules changed.
- A local browser probe held the outbound signup request (no backend request or email), then
  observed the timeout message and editable/re-enabled form after 21 seconds. Both configured
  SMTP ports and alternative `ssl0.ovh.net:465` time out from the VPS; UFW is inactive.
  Provider/routing/egress cause is not established. Working outbound SMTP remains the blocker.
- Further authorised read-only network diagnosis: the same OVH SMTP endpoints connect from the
  local machine in 0.06–0.09 seconds, while both OVH and Gmail SMTP endpoints time out from the VPS.
  HTTPS to OVH API connects from the VPS in 0.01 seconds. Host INPUT/OUTPUT policies accept traffic;
  inspected nftables has no SMTP-blocking rules. A bounded tcpdump of a connection-only probe
  captured outbound SYN retransmissions on ens3 with no replies. No credentials or mail payloads
  were sent/captured. This points upstream of the host firewall, but does not prove which provider
  or network component drops traffic. OVH documentation recommends ports 465/587; do not claim
  this is the ordinary port-25 restriction. Available OVH connector exposes no VPS/firewall reads,
  and no infrastructure API credentials are configured locally. Account-side inspection/support
  is the remaining access blocker. No firewall, mail or production application changes made.
- New iteration's integration/quality checks are deferred until finalisation. Results below apply
  to the earlier deployed snapshot, not these newer changes.

## Previous production deployment

- User explicitly approved the three production newsletter collections (after verified backup)
  and deployment of the two newsletter hook files. No emails or production content writes for
  testing; no frontend release, commit or push authorised.
- Read-only API preflight: all three newsletter collections are absent.
- Rediscovered production: `pure3d-archive-pocketbase-1`, PocketBase 0.40.3, host hooks at
  `/opt/pure3d-archive/platform/pocketbase/pb_hooks`, mounted at `/pb/pb_hooks`.
  Local health on VPS is healthy. SSH host verification passed.
- Intended hook files are new, absent remotely. Other installed hooks differ from local checkout;
  preserve every unrelated installed file and compare its checksum after deployment.
- Full installed hooks backup: `/var/backups/pure3d-newsletter-hooks-20261105.kdP6Gl`
  on the approved VPS; root-owned, mode 0700; includes baseline SHA-256 manifest.
- Production mail settings were read without exposing credentials: SMTP enabled, sender configured,
  application URL `https://pure3d.eu`. Do not send email or change mail settings.
- Isolated feature verification delegated to `ses_e542704c9ffe1To9CyNR5LL8yU` (Sol medium),
  test file ownership only. Worker must not contact production or send real email.
- Completed: verified database backup `newsletter-before-1793884814532.zip`, then created and
  read back the three collections, permissions and indexes. Private downloaded archive retained
  under the approved temporary directory (not in Git).
- Completed: staged and SHA-256 verified only `newsletter-service.cjs` and `newsletter.pb.js`,
  rechecked the installed baseline, atomically installed the two new files (ubuntu:ubuntu, 0644),
  and restarted only `pure3d-archive-pocketbase-1`.
- Post-deployment verification passed: installed checksums; every original hook unchanged;
  VPS local health, approved public health and `api.pure3d.eu` health; superuser authentication;
  schema read-back; read access to existing content/editions; anonymous newsletter routes protected.
  All three new collections contain zero records. No existing users were subscribed or modified.
- Isolated PocketBase 0.40.3 feature suite: 8 pass, 0 fail, 79 assertions. Only external mail
  transport was replaced; no real emails were sent. Worker source hashes match installed files.
- Production deployment is complete. Public frontend release is NOT authorised or performed:
  confirmation/unsubscribe frontend routes must be released before using newsletter emails.
- Production SMTP delivery and save/send journeys must not be claimed verified by read-only checks.
- Focused newsletter ESLint and diff whitespace checks pass. The introduced nullable-draft error
  and unresolved newsletter navigation lint error were corrected. `bun run check` now reports
  one unrelated existing `pb.afterSend` signature error in unchanged `auth.svelte.ts` and 15 warnings.
  The same auth signature exists at HEAD; no full baseline runner was used.
