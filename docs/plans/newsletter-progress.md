# Newsletter deployment checkpoint

## OVH support request submitted — 13 November

- User explicitly selected “Submit to OVH”. Clicked Confirm once and verified the resulting
  “Your ticket CS17150558 has been created” confirmation, New state and full submitted message.
  Automatic priority shown: 4–Low. No additional ticket/comment or configuration change made.
- Ticket: https://help.ovhcloud.com/csm?id=csm_ticket&table=sn_customerservice_case&sys_id=c48a229161a49b544a4e7ed514865394
  Browser tab `browser:browser:agent:1794581579952-2` remains open for the user.
- Submitted subject: “Public Cloud DE1: outbound SMTP to OVH MX Plan times out on ports 465/587”.
  Includes the correct Pure3D project/instance, source/destination IPs, SMTP failure evidence,
  successful independent TLS/authentication and explicit request to inspect unverified cloud
  security groups, SMTP restrictions and routing. No passwords/tokens or bulk email content.
- Temporary manager-inspection tab `browser:browser:agent:1794583605654-3` was task-owned and closed.
- Remaining blocker: OVH response/investigation. Do not claim SMTP delivery fixed, schedule
  monitoring, change networking/mail settings, send another test or post follow-ups without
  the appropriate authorisation. Re-read ticket state when the user asks to continue.

## Latest SMTP viability findings — 13 November

- Support draft is now filled but NOT submitted in tab `browser:browser:agent:1794581579952-2`,
  https://help.ovhcloud.com/csm?id=csm_get_help. User logged in; topic Incident, product Public Cloud
  (project), service not listed, Other request. Only unrelated Ctw Studio is in the service list,
  so it was not selected. Draft identifies the correct Pure3D project/instance explicitly.
- Important terminology correction: API IP type is `cloud`, not `vps`/`pci`. Located exact server
  `pure3d-pocketbase-prod`, instance `6c7f6d62-425f-40be-9b89-3c75b710fabc`, region DE1,
  project Pure3D `29e983b4f3cf4760a9997a941f61da1e`. It is a Public Cloud instance, despite
  earlier generic use of “VPS”. Instance-specific cloud security-group/port rules are not verified;
  don't claim those are clear. Available OVH MCP catalog exposes no security-group reads.
- Subject: “Public Cloud DE1: outbound SMTP to OVH MX Plan times out on ports 465/587”.
  Form fields: `#sp_formfield_vs_short_description`, instance `#sp_formfield_909-1`,
  additional information `#sp_formfield_909-2`. Final Confirm button from latest full snapshot:
  `#ovh-page-btn > div:nth-of-type(1) > button:nth-of-type(3)`. Obtain explicit approval before
  clicking it, then verify ticket confirmation/number before claiming submission. No attachments
  or credentials included; ticket asks to investigate, not disable broad security controls.
- Manager inspection tab `browser:browser:agent:1794583605654-3` was opened for read-only cloud
  networking inspection. Snapshot only reports Loading on the correct project page; inspection
  was inconclusive, not proof of a provider outage. Leave support draft available for user review.

- Next action: official OVH support portal opened at `https://help.ovhcloud.com/csm?id=csm_get_help`
  in browser panel tab `browser:browser:agent:1794581579952-2`. It redirected to the official
  OVH sign-in page. Wait for the user to log in manually; MCP authorisation does not provide
  the support portal's browser session. Then draft the scoped SMTP-connectivity request and
  obtain explicit approval immediately before any ticket submission. No ticket submitted yet.

- OVH authenticated API reports the MX Plan service active with valid SPF/MX and its mailbox
  not blocked. Production host, SMTP username and sender match the existing local configuration;
  no credentials or settings were changed.
- Verified local Mac connection to `smtp.mail.ovh.net:465` with certificate validation and TLSv1.2,
  EHLO 250 and PLAIN authentication 235 using the privately loaded SMTP credentials. No MAIL,
  RCPT or DATA command was issued; no message submitted. This proves the account/configured
  local credentials are usable, not that production delivery currently works.
- Local Mac STARTTLS/EHLO on port 587 succeeds for `smtp.mail.ovh.net` and `ssl0.ovh.net`.
  From the VPS, both endpoints time out on both 465 and 587. The PocketBase container also
  fails to connect to the configured host on both ports. HTTPS to OVH API works in both.
  Both SMTP names currently resolve only to IPv4, so there is no advertised IPv6 fallback.
- Official SMTP settings match production: MX Plan `smtp.mail.ovh.net`, implicit TLS 465 or
  STARTTLS 587, full mailbox username. Source read from
  https://docs.ovhcloud.com/en/guides/web-cloud/web-hosting/email-sending-best-practices
  (HTTP extraction saved/read in approved temp path `ovh-smtp-official-20261113.md`).
- OVH's guide quotes roughly 200 emails/hour per MX Plan mailbox and 300/hour per source IP;
  app audience cap does not override provider quotas. Avoid unthrottled large campaigns.
- Conclusion: OVH SMTP is viable for low-volume use, but this VPS cannot currently reach it.
  Changing host/465↔587/TLS settings is not supported as a fix by the observed results.
  Provider-side route/filtering investigation remains required unless another transport is chosen.
  No emails or production changes were made during these checks.

## Latest production deployment — 13 November

- User explicitly authorised the consent-field schema update and two newsletter hook replacements.
  Database backup `newsletter-before-1794577724679.zip` was downloaded and ZIP/SQLite integrity
  verified before adding the four optional fields; schema, indexes and permissions read back.
- Full root-owned installed-hooks backup retained at
  `/var/backups/pure3d-newsletter-consent-20261113.yq8psx` on the approved VPS. Private local
  receipt and pre-migration subscriber state retained in approved temp directory
  `newsletter-consent-deployment.X7lBA6` (not in Git).
- Only the two reviewed newsletter hooks were atomically replaced and the identified PocketBase
  container restarted. Service SHA-256: `2f40baf785975066687d949620c2425ae1c4943c859730fd17c9b19c17c38b5e`;
  routes SHA-256: `1f7209be87d23eb0696565b3bdb44530d26de31dbdc409dec789c550ffadbab0`.
- First attempt's immediate health request received an empty startup response and automatically
  restored both original newsletter files. Healthy restoration and the entire baseline manifest
  were verified, with no startup syntax error in logs. Retried with bounded retry-all-errors
  readiness handling; one startup reset was followed by healthy service and registered route.
- Final checks passed: VPS local and both public health URLs; installed hashes; every unrelated
  hook unchanged; production authentication and schema/permission read-back; private collection
  reads blocked anonymously; existing content/edition read access. The new endpoint now returns
  401 without authentication (rather than 404).
- Existing subscriber ID/status/confirmedAt/updated values are unchanged. Its status was already
  `unsubscribed` in the pre-migration snapshot; no account was subscribed or reactivated. An initial
  JSON-string comparison was order-sensitive; explicit field comparison confirmed preservation.
- No subscriber was added, no email sent, no SMTP setting changed. Actual admin save submission
  was not exercised, and application tests were not requested or run. Task-owned staging removed;
  backups retained. SMTP connectivity remains an independent unresolved blocker.

## Earlier iteration and diagnostic history

- Direct-add deployment now explicitly authorised on 13 November: fresh database backup, four
  optional consent fields and updated newsletter hooks only; no subscriber additions, emails,
  SMTP changes or frontend release authorised for verification. Confirmed before change:
  production direct-add route 404 and all four consent fields absent.
- Re-discovered PocketBase 0.40.3 and mounts. Compared installed newsletter files with local:
  only consent provenance updates and protected direct-add route differ. Node syntax checks pass;
  application tests not requested or run for this deployment.
- Full root-owned hooks backup: `/var/backups/pure3d-newsletter-consent-20261113.yq8psx`.
  Both changed files staged with verified SHA-256 in
  `/home/ubuntu/pure3d-newsletter-consent-stage.xcPKdp`, not installed yet.
- Database backup/consent-field migration is running as `sh_1d52a7ddd001XuU0OgwoPAGDBk`;
  await its completion notification without polling before installing hooks. Private local
  receipt/snapshot: approved temp directory `newsletter-consent-deployment.X7lBA6`.

- User explicitly authorised one test email on 13 November. The saved draft `hf88nxdlm72hh4h`
  was opened in the user's existing production-backed admin browser tab, and Send me a test was
  clicked exactly once after 13:36:57 UTC. No draft content or subscriber records changed.
  PocketBase container SMTP connections were observed in SYN_SENT to `193.70.18.147:465`.
  The actual UI displayed the 20-second timeout error and unlocked its controls.
  Bounded header-only network trace `sh_1d5204043001YDneiLR9JN9ZaO` completed. It captured
  outbound SYN retransmissions with no connection response. PocketBase logs show exactly one
  matching test request after the trace start, HTTP 503 at 13:39:30.164 UTC after 135,555 ms.
  Failure is before TLS, credential authentication and message submission, not evidence of a bad
  mailbox password. No retry was made. Do not send a subscriber campaign while SMTP is unresolved.

- Admin test-send hang: the frontend test-email request now aborts after 20 seconds, clears busy
  state and reports uncertain delivery without automatic retry. The test button shows Sending test
  rather than making Save draft look active. No real email was sent to check this change; only
  formatter parsing was performed. Already-running requests need a page refresh to clear old code.
  Production SMTP connectivity is still unresolved; this change does not claim to repair delivery.

- Latest 13 November update: OVH MCP authorisation now succeeds. The discovered IP block is
  `57.129.98.223/32`; authenticated API lists for spam flags, anti-hack flags, network firewalls
  and mitigations are all empty. MCP path parameters require an encoded slash (`%2F32`);
  unencoded CIDR produces a connector URL error, not an infrastructure failure.
  Fresh IPv4 TCP connections to the configured SMTP host on 465 and 587 still time out after
  5 seconds; OVH API HTTPS connects in 0.01 seconds. No exposed account block to remove.
  Connector exposes no support-ticket operation or VPS-specific egress control. Remaining action:
  provider investigation of routing/filtering, or separately approved alternative email transport.
  No production settings changes or emails sent.

- 13 November resumption: checkout was clean; rechecked OVH MCP authentication (still HTTP 401,
  login required) and VPS SMTP TLS connectivity (still times out), with PocketBase health normal.
  Next action requires signing into the OVH MCP connection. No emails or production settings changed.

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
