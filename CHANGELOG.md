# Changelog

## v2.3.0 - 2026-11-11

### Features

- add opt-in subscriptions and campaign management (542149ba)
- add full CMS component editing (922f52ca)

### Fixes

- restore unpublished edition editing and Voyager article saves (685c6b50)
- enforce session expiration across the app (fbabd07c)
- harden backend access and storage controls (ff63ffc6)

### Maintenance

- style(ui): refine collections page header layout (3c686799)

## v2.2.0 - 2026-11-03

### Features

- add self-hosted Kompakkt edition viewer (4e08e784)

## v2.1.2 - 2026-11-02

### Fixes

- unblock scene loading after failed audio (653b91ae)

## v2.1.1 - 2026-10-23

### Fixes

- keep Voyager hidden until a visible model loads (a70074d4)

## v2.1.0 - 2026-10-23

### Features

- add open-call covers and legacy URL redirects (7c33c8aa)

## v2.0.1 - 2026-10-22

### Fixes

- improve responsive partner logo grid (f0a8d475)

## v2.0.0 - 2026-10-22

### Maintenance

- chore: mark PURE3D 2.0 go-live milestone (c754e2b2)

## v0.24.1 - 2026-10-22

### Fixes

- move SSHOC-NL logo into supporters section (b38a379a)

## v0.24.0 - 2026-10-22

### Features

- add SSHOC-NL logo to the footer (30d3b934)

## v0.23.1 - 2026-10-22

### Maintenance

- docs: streamline README and clarify local development setup (64278411)

## v0.23.0 - 2026-10-22

### Features

- release and deploy automatically on main pushes (6a052ea4)

### Fixes

- show mobile hero text before the model (35e791b2)

## v0.22.0 - 2026-10-22

### Features

- improve mobile layout and add edition deletion (318c4c6d)

### Fixes

- format responsive hero and search components (45c2162c)
- prevent header search from overflowing (2fcb022b)
- improve mobile hero layout and source edition link (89e9b5f7)

## v0.21.1 - 2026-10-22

### Fixes

- migrate production domains to pure3d.eu (03e95e74)
- rebase derivative URLs to the app base path (cb985b35)

## v0.21.0 - 2026-10-21

### Features

- add private workspaces and editor transfer (b52a5eaa)

## v0.20.0 - 2026-10-21

### Features

- add proposal call selection and safeguards (26be7797)
- add CMS calls and proposal selection (d5b82773)

### Fixes

- enforce deadlines on first proposal submission (b60cdb1a)
- publish drafts by their returned release ID (cf34372c)

## v0.19.1 - 2026-10-21

### Fixes

- support explicit maintenance patch releases (74b2d12a)

### Maintenance

- test: focus suite on feature integrations (09e90400)

## v0.19.0 - 2026-10-21

### Features

- add particle forms for more editions (5ff7dab7)

### Fixes

- find draft releases during publication recovery (0f029289)

## v0.18.0 - 2026-10-21

### Features

- update particle models and provenance files; remove Baby Yoda (382ce5a4)
- refresh admin sidebar styling (04b6628a)
- manage learning materials and stabilize edition cards (29ceee4a)
- improve navigation, themes, and editorial pages (bb6bf063)

### Fixes

- repair validation and outdated gate expectations (9f2c108d)

## v0.17.1 - 2026-10-17

### Fixes

- resolve release verification blockers (d6cd933c)
- enable admin unpublishing and complete metadata (08e5dc3a)
- improve My Work cards and edition covers (aaac0d93)
- streamline proposal approval and edition setup (68aa4252)
- streamline admin review and proposal details (cd74f943)
- move My Work to profile and redirect reviews (323af7eb)
- improve proposal form and model preview (12a6bf14)
- clarify proposal approval and restrict edition access (43b2391c)
- guide concept submissions to proposal form (25bde5a4)
- ignore unused submenu destinations in direct menus (f7ff1f33)
- allow sampling particles without a scene document (5634eb72)
- refine homepage hierarchy and mobile hero controls (b13a78ff)

## v0.17.0 - 2026-10-01

### Features

- reveal progressive model loading (d042ee6c)

## v0.16.1 - 2026-10-01

### Fixes

- refine landing reveals and model navigation spacing (9bce6c29)

## v0.16.0 - 2026-10-01

### Features

- add model navigation and landing reveals (60292c7c)
- make particle hover organic (f432fe96)
- refresh landing and model transitions (fb329adf)

### Fixes

- clarify documentation sidebar heading (d048ff36)
- show correct Docker frontend URL (c341cf08)
- clarify component insertion options (eb32549c)

## v0.15.0 - 2026-09-28

### Features

- support versioned content updates (e8d10783)
- add editable content blocks (4222d6d4)
- add scholarly edition and homepage prototypes (bd12e4f8)
- guard production backend alignment (f79432bc)
- add guarded workflow interventions (f3de4775)
- add guarded local production migration (5c557b0e)
- align permissions and review handling (e600967a)
- complete review and publication (5edb5703)
- add proposal and alpha review (26ab3801)
- add scene authoring and reading (268a6f81)
- add sortable users table (5f0c7bb8)
- add editable footer navigation (b587980f)
- add rich content components (40915b12)
- clarify action colour roles (81af4aed)
- add edition content tabs to viewer (dc729bf1)
- improve viewer controls and interface styling (947f02f9)
- add publishing guide and contextual menu editing (0848aa97)
- new login with orcid and new login dialog (8e3aa6b4)
- update release workflow and documentation for automated deployments (3da4ed6c)
- overhaul author identity with ORCID (a7c00eb1)
- add storage dashboard (0427b780)
- remove redundant sections (2f097954)
- improve collection and edition page layouts (c5f996ed)
- enhance layout and styling for improved usability and visual consistency (ec529e88)
- update layout and styling for improved readability and consistency (57cbd15f)
- enhance card styles and layout for improved visual hierarchy and responsiveness (f89e8a4e)
- adjust padding and enhance title styling for discovery cards (bea9c4df)
- add image motion effects (a1ecf063)
- add profile matching utilities and integrate into various components. (0dc63e47)
- implement feedback email notifications and manage recipients in admin panel (d8a757eb)
- enhance hero section and add publish call-to-action with updated content (225eb532)
- update Pocketbase setup command and enhance documentation management (21983f91)
- scrub capture animation on scroll (d0be32f1)
- streamline author edition links and remove unused creator profiles fetching (e34b818e)
- update partner logos to WEBP format for improved performance (21f50839)
- replace PNG images with WEBP format for improved performance (3ebec94e)
- enhance input fields with background color for better visibility (bf396eae)
- refresh PURE3D migration copy (f2d077b4)
- refactor data loading logic in onMount for improved clarity and error handling (d0f00042)
- add images to story steps for enhanced visual context (c240e91c)
- update story steps and section titles for clarity and engagement (62087129)
- add interactive story steps to enhance user engagement (22ff35be)
- enhance user profile loading and display with detailed information (917a8464)
- update avatar handling in login button and improve fallback display (2ac22fb7)
- enhance profile picture handling and cleanup logic (688574cd)
- update profile section with improved bio and social links management (87722585)
- enhance profile page with editions and reviews management (a5941ef7)
- enhance user profile with additional fields and update UI components (6b91c835)
- add user profile page with editions and collections display (3aadeb62)
- enhance keyboard navigation and result selection logic (90b740d4)
- enhance search functionality with normalization and improved matching logic (33de7438)
- update dropdown positioning strategy to fixed for improved visibility (4af01167)
- add toggle to show hidden collections and editions for admin users (4b8a6282)
- simplify reactive data handling by removing authentication check (88aa3864)
- move "My Work" menu item to a new position for improved accessibility (7aff0edc)
- update terminology from "Full Feedback" to "Send Feedback" for consistency (e51fae67)
- rename workshopFeedback to feedback and update related references (a70698f4)
- Implement feedback feature with submission form and admin review interface (672b0d12)
- add bun-dev command for running native Bun frontend (fe7afbd0)
- update workflow stages and status handling for improved clarity (be275ea6)
- update VoyagerViewer to use dynamic resource root and versioning (622fdbc5)
- update demo edition with new content and API integration (ae197b2b)
- enhance hero section with recent editions display and improved layout (e19cc8fa)
- add camera animation options for smoother transitions (e42bb522)
- add visibility indicators for hidden collections and editions (de5da760)
- enable demo accounts visibility based on environment variable (0bcea2b6)
- add participant instructions and sample files for Voyager workshop (dbeccaef)
- streamline workflow stages and enhance next action visibility (aece0fa7)
- enhance concept proposal workflow with editor visibility and submission logic (e714b939)
- add fallback cover image support and improve edit form layout (e8e848e3)
- integrate WorkflowTimeline component with dynamic href generation for status navigation (72b14bfe)
- enhance edition management with modal and author links (c955a56d)
- restrict edition creation to Admin role only (bac7c5e9)
- roles audit, edition versioning, legacy redirects, and brand tokens (#45) (b2bdbe3a)
- edit and add collections in place (80b77fec)
- add cover image to collections (dff28b97)
- gate demo-account buttons behind PUBLIC_SHOW_DEMO_ACCOUNTS (3ef098a1)
- multi-file 3D uploads, viewer fixes, draft delete (6b72b7bf)
- tighten manage visibility, new edition entry point, draft UX polish (4b4e87b1)
- surface edition/collection CRUD on their own pages (9183be9b)
- prefer uploaded coverImage in edition thumbnail resolution (6f37e0fe)
- wire EditionAssetsPanel into edition workflow page (dca8a2ba)
- reduce new-edition route to title + create-draft + redirect (18589b54)
- add EditionAssetsPanel composing all edition uploads + preview (ce53540f)
- add VoyagerPreview with scene/model/legacy fallback (9c271fa9)
- add cover/model/scene upload wrapper components (9bcc2407)
- add generic FileUploadField component (6d09aa77)
- add pure SVX scene URI rewriter with tests (5217df77)
- configure PocketBase S3 + upload size from env on startup (87d935dc)
- add coverImage, modelFile, sceneDocument file fields to editions (050eebd4)
- unify edition creation and workflow concept form (83123729)
- add Save Draft and Submit for Review to new edition form (061e673d)
- show edition thumbnails on My Work page (8c714e92)
- add disabled file upload placeholders to new edition form (cea78285)
- add new edition page and fix a11y warnings on collection edit (583b8487)
- add collection edit page with Dublin Core metadata form (278af836)
- add documentation collection migration and seed script (b7f7d8ab)
- link homepage CTA and about page to documentation routes (ee25ff8e)
- add admin documentation CRUD page with rich text editor (49c5b37b)
- add public documentation routes with sidebar layout (2a396700)
- add Documentation to public and admin navigation (3b83e288)
- add reusable Tiptap rich text editor component (d1e8bb3a)
- add Documentation type and audit actions (d42fd196)
- add Tiptap rich text editor dependencies (5d899260)
- enhance imagine modal and viewer capture (698ffe25)
- add Imagine AI image generation modal for editions (337a4a8b)
- include Voyager runtime in repo for GitHub Pages deployment (c42dab2e)
- add PocketBase migration for reviewFeedback collection and notification types (37665cf0)
- implement supporting features for collaboration, review dashboard and feedback (7435f59d)
- implement workflow stage UIs for concept, editorial, alpha, final review and publication (30e39b06)
- implement workflow foundation layer with multi-stage review pipeline (3c6638f4)
- add demo accounts for testing to the login page when in development mode (6b251117)
- update user seeding script with new user roles and improved error handling (b429799c)
- implement user management features with create, edit, and delete functionality (0048b96f)
- implement UserSearchSelect component for user selection in admin collections and editions (0eb23301)
- enhance admin collections and editions UI with improved accordion functionality and active state styling (f698b4fd)
- User migration script and Admin control panel for users, collections and editions. (414540c5)
- implement audit logging functionality (34646285)
- enhance login experience with tabbed interface and marketing panel (b4f55a10)
- implement automatic versioning and changelog generation in release workflow (5db99285)

### Fixes

- clarify review choices and status contrast (5b5f0d54)
- validate external URLs in PocketBase (cf99a0ef)
- journal production alignment (e5dfd62a)
- filter categories after loading posts (b3b83efe)
- scope runtime resources to viewers (23b0fb00)
- support verified beta Pages deploys (45ad0b41)
- hide tokens in scene metadata (ac8f1837)
- preserve existing field identities (b870106d)
- harden local dev and metadata handling (aedd6339)
- complete OVH ORCID cutover (780ed869)
- only use asset thumbnails when available (96900568)
- normalize theme color tokens (3fc4915e)
- apply base background globally (78c6527b)
- adjust section classes for consistency in layout (ad3f186c)
- enlarge story illustrations (614f47c8)
- keep story cards compact (21e305c7)
- remove section markers (587411d6)
- remove .claude directory from ignored files (a3691552)
- add wheel scrolling support for dropdown results (2b88f035)
- improve private edition controls (172f666e)
- correct typo in design system description and improve layout in editions page (aaf9eed4)
- two-step update for relation-target retargets (46a2ad1f)
- drop userProfiles after relations are retargeted (763700ff)
- drop stale GlobalRole.SuperAdmin references after roles merge (c1e881e7)
- race-safe preview with fallback warning and completer SVX (5eb15c3d)
- bind record, reset input, abort XHR on unmount in FileUploadField (a05ef11a)
- guard all formatDate functions against missing timestamps (af84a69f)
- set all relation fields when creating edition author link (ac401183)
- add autodate fields to review and edition user collections (95a4f753)
- assign creator as author and redirect to My Work after edition creation (6636313b)
- align institutions field with rest of form layout (43b399f3)
- guard against undefined items in collections store (b467a289)
- use correct thumbnail field name for collections and editions (a13814a7)
- handle missing timestamps and improve audit log responsive layout (077874b3)
- add autodate fields to auditLog and notifications collections (1b65933e)
- use open API rules for documentation collection (4d103a0e)
- add documentation to auditLog targetType in migration (87cb08e9)
- sanitize slug parameter and sync editor content on prop changes (40cefc5b)
- serve Voyager resources from GitHub Pages, not R2 (913c8d12)
- use custom domain for R2 assets to resolve CORS issues (f155fc5f)
- use base path for login panel image on GitHub Pages (26d85176)
- set APP_BASE_PATH for GitHub Pages deployment (305f3415)
- standardize ports to 8080/8090, auto-fetch latest Voyager release (96b28c24)
- use R2 asset URLs and run dev mode in Docker (ba640d0b)
- startup on first clone (f4411138)
- remove duplicate transitions declaration in admin editions page (9a284160)

### Performance

- accelerate catalogue and viewer loading (a10a3e0c)
- optimize homepage data loading (bfc750b3)
