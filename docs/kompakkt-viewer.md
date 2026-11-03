# Self-hosted Kompakkt viewer

Signed-in global administrators can select **Original**, **Experimental**, or **Kompakkt** in
the edition page's existing viewer selector. The choice is remembered for that administrator in
that browser. Visitors and other roles always receive Original. No environment feature flag is
required, and changing viewer does not change the edition or its published configuration.

Kompakkt runs as a separate static application at `/kompakkt/index.html`, served by Pure3D inside
the edition's viewer panel. It does not load the hosted kompakkt.de viewer or require a Kompakkt
account, server, MongoDB or other Kompakkt backend services. Selecting it starts the local viewer;
there is no external-service consent button. Models still come from Pure3D's configured assets.

## Installation and builds

Run `bun run setup:kompakkt` once before local development. Production `bun run build` also runs
this installer, so clean preview and release builds include the runtime automatically. Bun and
Git, plus network access to GitHub and the package registry, are required at build time only.
The generated `static/kompakkt/` directory is ignored by Git and reused while its pinned revision,
packaging recipe and configured asset origin match.

The installer pins Kompakkt Viewer commit `aefc60962643e030e1a12385fd83db1f0c71e400`.
It preserves the upstream dependency lock, adds the matching Babylon 9.32.1 KTX2 decoder,
disables the account-token interceptor, removes hosted-backend configuration and replaces default
remote environment textures. Fonts, Draco/Basis/KTX2/meshopt decoders and environment textures
are served locally. The viewer's content security policy permits resource requests only to its
own origin and the configured asset origin, preventing third-party backend/CDN fallbacks.
No additional kompakkt.de CORS permission is needed on the asset server.

## Licence and corresponding source

Kompakkt Viewer is AGPL-3.0, not Pure3D's Apache-2.0 application licence. Its separate runtime
retains its licence and attribution notices. The viewer panel links to `/kompakkt/LICENSE` and
`/kompakkt/source.tar.gz`. Each build packages the modified viewer source, dependency lock,
local decoder assets and build instructions alongside its runtime. Preserve these when deploying
or redistributing the viewer. This separation is not a legal opinion on licence compatibility.

## Supported editions

Only published editions with anonymously readable assets can use Kompakkt. The current adapter
lists GLB or glTF 2 Web3D models in the active Voyager scene. Scenes with multiple models provide
a model selector; Kompakkt displays the selected model independently, not the composed Voyager
scene. High-quality derivatives are preferred over thumbnails. Private or tokenised assets and
relocated companion files show an explanation rather than sending credentials or rewriting model
binaries. Both same-origin development routes, `/assets/` and `/asset-proxy/`, are supported;
localhost/127.0.0.1 asset URLs on the frontend port are normalised to the page's origin.

Voyager annotations, stories, tours, cameras and scene transforms are not converted. Kompakkt does
not save edits to Pure3D. The edition's descriptive content remains alongside the viewer. Switching
viewer unmounts the previous runtime and cancels pending asset checks. Changing the model inside
Kompakkt keeps the same iframe, document and WebGL canvas alive. The scene list is loaded once,
successful model checks are reused, and a same-origin, source-checked message bridge loads the
selected model. It serialises imports, retaining only the latest queued selection. The old model
remains visible while the replacement downloads; old meshes and materials are disposed afterwards.
Only the initial viewer startup needs to boot Angular and Babylon. Large new model downloads can
still take time.

## Local implementation receipt

The pinned runtime built successfully with Bun on 3 November 2026. Upstream emits bundle-budget
and CommonJS warnings (13.28 MB initial code, estimated 2.91 MB transferred); these are not build
failures. A managed headless browser rendered the Northumberland GLB as 104 meshes in the local
self-hosted viewer, with no console errors. The viewer frame's observed resources were same-origin;
no hosted Kompakkt or Babylon CDN request was required. Admin controls were exercised with a
synthetic local UI identity, not a production administrator session. Full application checks,
responsive coverage and production deployment have not been performed for this implementation.
