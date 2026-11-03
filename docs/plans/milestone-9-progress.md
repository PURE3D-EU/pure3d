# Milestone 9 implementation checkpoint

## 3 November 2026 reconciliation (current)

User requested all open milestone issues be checked, existing completed work closed, and missing
work implemented. Preserve pre-existing Kompakkt viewer, backup and package changes. No commits,
pushes or production writes authorised. GitHub bulk closure needs the required preview/confirmation.
Starting commit: `653b91a`; 14 open issues. Original notes below are historical.

- Already implemented: #87 workflow, #88 collections, #89 community, #91 supporters (including
  later requested SSHOC-NL), #93 learning CTA, #95 checklist. Verify public routes before closure.
- #100 shipped in v0.20.0; two production calls still exist but both are currently unpublished.
  Do not republish editorial content. Existing Calls guide remains published.
- #78 local handler/UI implemented, but read-only SSH confirms installed production route/handler
  absent. Deployment requires separate explicit authorisation and the repository backup/atomic
  replacement procedure. Worker `ses_e5ed88c21ffe6qPNvvcpvjDmHM` owns focused backend tests only.
- Local fixes now implemented: #83 visible Activities & Outputs heading/description; #85 missing
  Bolex cloud and Source Edition credit; #86 real Akua’ba edition walkthrough and supplied stage
  copy; #90 community typo and correct `/documentation/calls` destination; #92 a single control
  expanding the full CMS footer; #94 news moved directly below hero/open calls.
- Bolex record now exists: `a85366846edebc1`, collection 24/edition 1. Derived only the published
  camera mesh; provenance records creators/rights holder and absence of an explicit licence.
- User rejected the faint repeated wireframes and explicitly selected “Real edition walkthrough”
  in the direction form. Replaced the three cards with one large visual and three selectable
  stages: object close-up, actual public Voyager annotation/article, published edition page.
  Text remains as approved. At narrow widths the controls become a three-stage strip above the
  image and selected text. No new motion, runtime viewer or dependency. Removed the superseded
  generated wireframes and their generator. Sources/credit/licence are recorded in
  `static/images/landing/akua-walkthrough.provenance.txt` and the real edition is linked.
- Walkthrough preview checked on desktop and at 390px: all three images load; mouse and keyboard
  stage selection works; selected buttons expose aria-pressed; no horizontal overflow. Read actual
  desktop, annotation, publication and mobile screenshots. Full gates remain deferred.
- User requested larger NWO branding: removed embedded padding in a separate mark asset and
  rendered it at 60px height without distortion. Official NWO guidance supplies one upright logo,
  not a horizontal alternative. Other supporter branding remains unchanged.
- Existing native Bun preview is `http://127.0.0.1:60026/`; Docker frontend port 60020 initially
  returned an empty response. Public preview uses production reads; never mutate it for tests.
- Browser verified two real news items before narrative section, all three new images loaded,
  no desktop overflow. Found original Open calls link really returned 404 (guide layout excluded
  from resources route); corrected it to canonical documentation route. Recheck pending.
- Screenshot read and shown in chat: temporary `milestone9-narrative-studies.png` evidence,
  moved outside the repository after delivery. Full gates deferred until requested.
- Focused browser checks pass: all ten hero models and source links; Open calls CTA reaches the
  published guide; two news cards precede narrative; three new images load; keyboard footer
  expansion; visible resources heading; homepage/resources have no overflow at 390px.
- Live v2.1.2/`653b91a` verified for #87/#88/#89/#93/#95; all seven supporter logos load (#91).
- Backend verification using cached PocketBase 0.40.3/Bun 1.4.2 in isolated existing Docker images
  (`--pull=never --network none --read-only`): unpublish journey 1 pass/22 assertions;
  unpublish + proposal round-trip 2 pass/65 assertions; Open Calls 1 pass/19 assertions.
  Fixture now includes the existing sandbox-service dependency; tests changed only in
  `pocketbase/tests/orcid.integration.test.ts`. No production test content created.
- Changed-source ESLint and `git diff --check` pass. Full typecheck/build/suite not run.

User confirmed the exact seven-issue closure batch through the inline form. Closed #87, #88,
#89, #91, #93, #95 and #100 as completed; read back every ID/state/reason. Milestone now has
7 open / 16 closed. Pre-write recovery state saved privately outside the repository at
`/private/var/folders/78/t7tp8f_557d8qdc94shsqp0w0000gn/T/opencode/milestone9-preclosure.json`.

Next: #83/#85/#86/#90/#92/#94 are implemented locally, awaiting user acceptance/finalisation and
separately authorised release. #78 needs explicitly authorised scoped backend-hook deployment;
never install all current hooks blindly. No commits, pushes or production writes performed.

Latest user direction: work directly on `main` (including Kompakkt) and assign implemented
issues to Kelly for her to close; do not close further issues ourselves. Existing seven closures
remain unchanged. `kgschoueri` is the other assignable collaborator, original reporter and current
assignee on #92/#78. User confirmed the five-issue batch; added `kgschoueri` to
#83/#85/#86/#90/#94 and read back every target ID, assignee list and OPEN state. #92 remains
open and already assigned. #78 remains assigned but is blocked on backend deployment, not finished.
Local branch is `main`; remote is one release-only commit ahead (`dfede00`, v2.1.2). Preserve
all uncommitted work and do not pull/reset/stash or commit/push without the relevant authorisation.

Working on `main`; user will test and close issues. No commits, pushes, deployments or GitHub mutations authorised. Starting tree clean, main ahead of origin by one commit.

## Delegated ownership

- Landing #85–91, #94: sol session `ses_eab88433dffeciQkfAPxwiB9W4`; `src/routes/home3/**` and landing-only assets.
- Workflow #75, #78: terra session `ses_eab881abaffeFrC99BjQpUe7nW`; workflow UI/services/backend except CMS hooks.
- Navigation #76, #80, #92: sol session `ses_eab87f35affeah3SzRUcaCdenC`; navigation UI/model/store and CMS hooks menu logic.
- Editorial #81–83, #93, #95: sol session `ses_eab87c4d3ffe0cXKLGR0P470cF`; resources/documentation/new editorial routes, lib/content.ts and dedicated content update scripts/components.
- Metadata #79: original terra session `ses_eab879860ffeS8N00creOw1hwx` cancelled without a result. Replacement sol session `ses_eab416c1effe98NFNJkLWizASA` completed; edition metadata heading contrast and temporary removal of Versions/Printables tabs per latest issue comment.
- Logo options #84: sol session `ses_eab876ee9ffepwPGx27UhOnPOH`; docs/prototypes/milestone-9-logo-options only. User selection needed before live replacement.
- British English #96: luna session `ses_eab875362ffeZ2ms7A376HAlWQ`; initial read-only inventory, apply sweep after concurrent writers finish.

## Open decisions

- #86 explicitly leaves replacement object and new descriptive sentences TBD. Ask user before inventing assets/copy.
- #82 contact recipient/delivery mechanism must be established; never show fake delivery success.
- #79 inspect attached field list and determine any undefined controlled vocabularies before asking user.
- #84 present actual logo options for selection.

## Requirement reconciliation (implementation, not verified completion)

- #75 implemented guarded legacy admin workflow transitions; user/runtime testing pending.
- #76 implemented inactive-draft target validation parity; production hooks not deployed.
- #78 existing unpublish feature/backend reviewed; focused existing backend suite passed. User testing pending.
- #79 latest feedback implemented: stronger metadata headings/labels, removed Versions/Printables from desktop/compact navigation. Requested metadata schema/editor fields already existed from prior implementation (confirmed live issue comment and code mapping). Existing vocabulary selectors retained; no authoritative missing vocabulary seeds invented. Coordinator reviewed diff and actual feedback image. User/runtime testing pending.
- #80 implemented explicit clickable submenu headings and prominent publishing callout.
- #81 implemented published learning-material cards at `/learning-materials`.
- #82 implemented CMS-backed contact design at `/resources/contact`; user decision on mail-client fallback pending.
- #83 implemented Activities & Outputs heading/description.
- #84 three rendered SVG options delivered; awaiting choice, no replacement of selected design.
- #85 partial (20 October follow-up): OrbStack assets now accessible. Nine requested editions rotate: existing lamp/Rembrandt plus whale-bottle-shoe, otoscopy head, Akua’ba, Muffin’s eleven actual bone meshes, Düwelsteene, Mexican doll and Diaconie Weeshuis. Derived clouds and provenance added; unused Baby Yoda assets removed. Browser-cycled all nine, confirmed source titles/links and captured actual artwork. Bolex absent from public local/production edition records and local asset filenames; need its edition link/assets for the tenth. Routine quality gates deferred during live iteration. Get Started CTA and accent-colour discussion remain outside this model-only follow-up.
- #86 partial: supplied heading/description/stage labels done; replacement object and new descriptive sentences explicitly TBD, user answer pending.
- #87 implemented workflow heading/copy/five-stage graphic.
- #88 implemented collection description.
- #89 implemented community heading/copy/audience cards.
- #90 implemented proposal CTA text and links.
- #91 implemented all six institutions with official public logos. Coordinator read all actual assets; user visual acceptance pending.
- #92 footer heading links/rendering updated; configured footer remains curated/independent. Full header replication vs curated footer decision pending, no remote CMS edits.
- #93 implemented PURE3D and Access Learning Resources CTA.
- #94 implemented two latest real published posts, no fabricated news.
- #95 implemented checklist/heading and removed identity-review section, preserving backend identity rules.
- #96 initial and final shared-file copy sweeps done/reviewed. Metadata UI uses existing British-English labels; no technical field identifiers renamed.

## Next steps

All delegated sessions returned (original metadata worker cancelled, replacement completed). Remaining work genuinely needs user input/access: logo 1/2/3; #86 replacement object/descriptive copy or permission to draft; #82 accept email-client fallback or configure real delivery; #85 start OrbStack/local assets plus Bolex edition mapping; #92 full-header mirror vs curated footer structure. Seven requested hero edition mappings are recorded in landing worker result; anonymous production scenes all 403, Docker socket unavailable. No deployment or production data changes made. Full final integrated verification has NOT run; known navigation syntax errors were fixed and affected components compiled. Continue once user answers rather than claim milestone complete.

Navigation follow-up completed and reviewed: explicit optional group landing links round-trip through editor, frontend/backend validation, directory resolution, publishable filtering and header/footer. Corrected contact route to `/resources/contact`. Worker caught/fixed introduced `const_tag_invalid_placement`; narrow compiler invocation passed Header and SiteFooter. Earlier workflow worker's full check failed on these then-current concurrent edits (not established pre-existing failures); no full integrated check yet. Workflow UI adds reason-required admin legacy override via existing guarded audited endpoint. Existing #78 unpublish implementation reviewed in backend; worker ran focused existing suite (5 passed). Worker also ran formatting/lint checks despite requested active cadence; no full verification claim.

Logo comparison delivered in chat as actual rendered PNG `/var/folders/78/t7tp8f_557d8qdc94shsqp0w0000gn/T/opencode/milestone-9-logo-comparison.png`; awaiting user choice 1/2/3. Inline choice-page call timed out; PNG is successful delivery. Task-owned docs preview runs at http://127.0.0.1:60026/prototypes/milestone-9-logo-options/index.html via shell sh_1547e054c001oNFE1WE3suX3sj. Playwright task context uses this URL; screenshot path outside tool allowed roots was rejected, so PNG was generated with existing sharp and read directly instead.

Landing first batch reviewed: #87–90, #94 implemented; #85 only mining lamp/Rembrandt so far; #86 images/copy pending user; #91 four supporter logos still text. Landing worker resumed to locate remaining public assets, official logos, fix conceptual fallback and exact Get Started link. Logo options delivered, coordinator read actual SVGs and requested optical fixes (clipped numeral and narrow D); user selection still pending. Editorial worker resumed to preserve contact CMS body/edit controls/draft notice, finish title branding and explicit learning publication filtering.

Editorial worker completed #81–83, #93, #95: new `/learning-materials`, existing `/resources/contact` redesigned with honest mailto composition using the existing published address. User decision pending whether email-app fallback is sufficient. Coordinator read changed files; no runtime verification yet. Navigation worker follow-up owns `src/lib/cms.ts` to add explicit group landing links (replace naming heuristic) and learning route support. Contact route is `/resources/contact`, not `/contact`; reconcile route allowlist before completion.

#96 initial copy-only batch applied and reviewed in demo/design/alternative-home routes, feedback, site settings, admin content title and documentation seed. No checks run (live implementation). Remaining copy sweep in files owned by active workers deferred until their changes settle.

Receive worker results, surface concrete questions, review affected files/evidence, coordinate shared-file follow-ups, apply British English sweep after writes settle. Reconcile all 21 issues with implementation. User testing remains pending; routine final quality gates deferred until requested.
