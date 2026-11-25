# Pure3D Features

## Functionality

### 3D Viewer

Powered by the Smithsonian Voyager Explorer, embedded directly or via iframe.

- [x] Interactive orbit camera with reset control
- [x] Annotations, guided tours, articles, and measurement tools
- [x] AR mode support
- [x] Multi-language support (8 languages)
- [x] Model loading progress bar with byte tracking
- [x] Full-window immersive viewing mode
- [x] Customizable background style and colors
- [x] Floating control buttons for viewer features
- [x] Configurable height, aspect ratio, and menu visibility
- [ ] Next/previous navigation between editions
- [ ] Edition comparison view (side-by-side)
- [ ] Keyboard shortcuts for viewer navigation

### Search

- [x] Global search across editions and collections
- [x] Real-time results with keyboard navigation
- [x] Grouped results by type with thumbnail previews

### Authentication

- [x] ORCID identity backend and ordered person/organization credit model
- [x] Manual attribution review without name-based account linking
- [ ] Production ORCID-only registration/sign-in cutover and deployment verification
- [x] Optional ORCIDs on creator and contributor credits, separate from account verification
- Production registration, hooks, credentials and rollout blockers: [ORCID operations](docs/orcid.md)

### Content

- [x] Edition and collection browsing with thumbnails
- [x] Featured editions carousel on home page
- [x] Tabbed detail panels (description, metadata, peer review, printables)
- [x] Dublin Core metadata support
- [x] Tags and peer review badges
- [x] View presets with deep-linkable descriptions (`[[view:name|text]]`)
- [ ] Blog/news section
- [ ] About page content
- [ ] Deep linking to specific scenes and annotations

### Data

- [x] PocketBase backend with local bootstrap tooling (not a production migration)
- [x] Read-only ORCID inventory and reviewed, backup-gated attribution migration
- [x] Private per-record apply audits with backup identity, committed readbacks and partial-failure results
- [x] Unapproved account candidates with source evidence and visible identity/name collisions
- [x] Optional bounded public ORCID candidate lookup, with separate manual identity approval
- [x] Legacy names, duplicate entries and ordering retained; unresolved identities stay in review
- [x] Local imports preserve pending author assignments in private onboarding reports without role downgrades
- [ ] Production attribution reconciliation and independently verified legacy-field cleanup
- [x] Persisted stores with stale-while-revalidate caching
- [x] CDN-ready asset URL configuration
- [x] Image preloading during browser idle time

### SEO & Analytics

- [x] Per-route meta tags and page titles
- [x] Analytics-ready (Plausible/Umami)

---

## UI

### Layout & Navigation

- [x] Responsive mobile and desktop layout
- [x] Sticky frosted glass header with mobile hamburger menu
- [x] Active route highlighting and breadcrumb navigation
- [x] Collapsible sidebar on edition detail pages
- [x] Link prefetching on hover

### Theming

- [x] Dark/light theme toggle
- [x] Consistent frosted glass effects

### UX Polish

- [x] Toast notifications
- [x] Loading skeletons
- [x] Smooth scroll carousel with arrow buttons
- [x] Help modal with video embed support
- [x] Escape key exits full-window mode
- [x] Gradient background during Voyager loading
- [ ] Feedback submission system
- [ ] Filter sidebar for editions and collections
- [ ] Social sharing
- [ ] Internationalization (Paraglide setup exists)

---

## Tech Stack

| Layer      | Technology                                 |
| ---------- | ------------------------------------------ |
| Framework  | SvelteKit 2 + Svelte 5 (runes)             |
| Styling    | TailwindCSS 4 + DaisyUI                    |
| 3D Viewer  | Smithsonian Voyager                        |
| Backend    | PocketBase                                 |
| Runtime    | Bun                                        |
| Language   | TypeScript (strict)                        |
| Deployment | Docker Compose                             |
| Versioning | Tag-triggered releases with auto changelog |

### Developer Tools

- [x] Dev environment banner and debug overlay
- [x] Voyager API demo page (dev only)
- [x] Environment variable configuration
- [ ] Unit tests
- [ ] E2E tests
