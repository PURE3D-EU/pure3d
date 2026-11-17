# Model optimisation: viewing copies

The editor can process, preview and download a GLB locally without the backend hook. Saving a
viewing copy or restoring a previous scene requires the authenticated backend capability below.
This is not a source replacement: `modelFile` is always retained unchanged. Existing companion
files, old viewing copies and scene snapshots are not deleted.

## Browser processing

The action lives beside Voyager Story in `EditionAssetsPanel.svelte`. Processing is lazy loaded
and runs in a dedicated Web Worker which is terminated on cancellation or completion. Downloads
are capped at 256 MiB before processing; JSON chunks are capped at 16 MiB and collection/reference
counts are bounded. Preview data stays in memory and is served to the existing Voyager component
through Blob fetch overrides at task-local synthetic URLs, not uploaded for preview.
Decoded accessor data is bounded at 512 MiB and combined image pixels at 256 MiB (RGBA), with an
8192-pixel image edge limit. These estimates reject obvious allocation risks, not every GPU limit.

The initial version accepts self-contained GLB 2.0 with one embedded binary buffer and embedded
PNG/JPEG images. External/data-URI resources, nonstandard chunks and all glTF extensions currently
disable optimisation. This is deliberately conservative, including Draco and meshopt: the tool
must not silently discard or rewrite extension data it does not understand. Structural findings
are not a Khronos glTF Validator result, a scientific assessment or a mobile performance benchmark.

Lossless mode compacts JSON and repacks buffer views, deduplicating only byte-identical data with
SHA-256-assisted matching and byte equality confirmation. Geometry precision, accessor alignment,
indices, names, animations, texture bytes and parsed glTF metadata are retained. Non-finite or
unsafe integer values are rejected rather than reserialised with changed numeric values. No mesh
simplification, quantisation, vertex welding or texture re-encoding happens in this mode.

The explicitly lossy option can recompress/downsize embedded JPEG images used exclusively as colour
or emissive textures. PNGs, masked materials, normal/data maps and image data shared with geometry
are preserved. JPEG decoding is limited to 16 megapixels and an 8192-pixel edge. Unsupported image
encoding falls back to lossless repacking with an explanation; there is no guaranteed saving.
If an output is not smaller, the unchanged original is returned and Apply remains disabled.

Both previews must load before the user can approve a copy. Approval plus backend capability is
required for Apply. The download remains available without backend support. Previewing a model
alone does not verify existing scene annotations or establish visual/scientific equivalence.

## Backend capability and request protocol

Call `GET /api/pure3d/model-optimisation/capability` with normal PocketBase authentication. Enable
Apply and Restore only when the response contains `protocol: 'viewing-copy-v1'`. The response also
advertises `maxModelBytes: 268435456` and `maxSceneBytes: 5242880`. Missing or incompatible hooks
must leave local preview and download available, not fall back to an ordinary file replacement.

Use the ordinary edition update endpoint so its existing access rules, workflow locks, sandbox
ownership/limits, file validators and audit hooks still run:

```js
const expectedFiles = {
	modelFile: edition.modelFile,
	sceneDocument: edition.sceneDocument,
	modelAssets: [...edition.modelAssets]
};
const form = new FormData();
form.set('modelOptimisation', JSON.stringify({ action: 'apply', expectedFiles }));
form.append('modelAssets+', viewingCopy, 'viewing-copy.glb');
const saved = await pb.collection('editions').update(edition.id, form);
```

Restore uses the same manifest with `action: 'restore'` and **no files**. Neither action accepts
other manifest keys, unrelated edition fields, Voyager save manifests, source uploads, client scene
uploads, companion replacement/deletion, or extra uploads. An apply contains exactly one GLB.
Use exact stored filenames and the existing companion array order in `expectedFiles`; refresh the
edition after each save. Do not invent an empty scene filename if the loaded record differs.

Both operations wrap the ordinary update handler in a transaction, checking the original `updated`
timestamp against the latest record and comparing all three expected file fields. A stale request
fails without switching the record to its new viewing copy. There is no separate privileged save
endpoint or permission bypass, including for superusers (the normal workflow/sandbox chain remains
in force).

## Apply and scene history

The backend validates the uploaded GLB magic, version 2, declared byte length, alignment and
256 MB limit, then assigns a new server-generated `.glb` filename in `modelAssets`. Ordinary
collection file validation still applies; sandbox companion uploads retain their lower 100 MB
limit. These checks do not assert complete glTF conformance, visual fidelity or scientific quality.

Existing scenes are read from edition storage and limited to 5 MB. Only a single-model Voyager
scene is supported. Both `Model` and `Geometry` assets are treated as model references, including
ones with missing or unknown extensions. References must identify the current source GLB or signed
current viewing copy by its exact stored filename. Apply also recognises the source's original
basename, case-insensitively, by repeatedly stripping PocketBase's ten-character random suffix
before the extension (the same rule as `VoyagerPreview.originalBasename`). That source alias is
rejected if another companion file has the same original basename; exact stored filenames remain
unambiguous. The viewing copy must use its exact signed stored filename, and Restore accepts only
that exact filename. An optional `./` and query/fragment are allowed, but other paths are not.
Unknown model/geometry references, external/legacy directory paths, unsupported formats, malformed derivatives,
multi-model scenes and scenes with no matching GLB reference are rejected rather than guessed.
Only those geometry URIs change. Existing nodes, names, transforms, annotation indices, articles,
lighting, cameras and other scene data remain intact.

With no existing scene, the backend creates a Voyager scene using `type: 'Model'` and
`mimeType: 'model/gltf-binary'` for the GLB, matching the runtime's `appendModel` path. Its camera,
lights and centimetre units follow `VoyagerPreview.setGeometryWrapperScene`; that preview helper's
OBJ/PLY `Geometry` asset type is deliberately not used for the generated GLB scene.

Before replacing a scene, its complete original bytes are retained as a JSON companion using
PocketBase's storage-aware `getReuploadableFile(key, false)`. No direct filesystem copy writes are
used, so the mechanism also works with configured object storage. Each apply consumes one
companion slot for the GLB and, when there was a scene, one for the snapshot. The existing
`modelAssets.maxSelect` limit bounds history; exceeding it rejects the apply. No automatic history
pruning is performed.

The generated scene contains the following server-owned metadata:

```json
{
	"asset": {
		"extras": {
			"pure3dViewingCopy": {
				"protocol": "viewing-copy-v1",
				"editionId": "the-edition-id",
				"sourceModel": "exact_modelFile.glb",
				"viewingModel": "server_generated_copy.glb",
				"previousScene": "server_generated_snapshot.svx.json",
				"createdAt": "2026-11-17T00:00:00.000Z",
				"signature": "server-generated HMAC"
			}
		}
	}
}
```

`previousScene` is `''` when there was no previous scene. The UI may read this metadata from the
current scene for Restore availability but must not send it as authority or edit it. The server
signs the protocol, edition, source, viewing filename, snapshot filename and timestamp with a
domain-separated HMAC using the existing private `_superusers` collection file-token secret.
It verifies that signature, exact source filename, edition identity and current companion
membership before using history. Copying metadata between editions or changing its filenames
therefore cannot authorise a restore. Rotating that server secret invalidates old signatures;
retained source files and snapshots remain available for authorised manual recovery.

Restore requires the current scene to reference the signed viewing model. It reuploads the
recorded snapshot into `sceneDocument`, or clears `sceneDocument` when `previousScene` is empty so
the viewer returns to the source directly. All companions remain. Restoring a snapshot of an older
viewing-copy scene restores its earlier metadata as well, allowing another restore through that
history. A changed source, missing snapshot, edited/unsigned metadata or unsupported current scene
fails safely rather than selecting an arbitrary file. Scene edits made after Apply are replaced by
the saved snapshot on Restore; the UI should make that consequence clear.

Voyager's scene export rebuilds the asset header and can omit its extras. The ordinary Voyager
save hook therefore carries forward only validated, signed viewing-copy metadata read from the
previous stored scene, never metadata supplied by the client. This does not change other exported
scene fields or require single-model mapping during an ordinary edit. A later Apply or Restore
still rejects an unsupported scene. Scenes retaining valid viewing-copy history remain limited
to 5 MB; unrelated Voyager saves retain their existing 50 MB scene limit. The history helper reads
the previous scene with that 50 MB bound. Missing, unreadable, unsigned, forged or source-mismatched
old history is dropped rather than blocking an ordinary repair save, and forged client metadata
is removed when there is no valid stored history to preserve.

## Deployment boundary

The implementation consists of `pocketbase/pb_hooks/model-optimisation.pb.js`,
`pocketbase/pb_hooks/model-optimisation-service.cjs` and the updated
`pocketbase/pb_hooks/voyager-save-service.cjs`. Install these hook files together: the Voyager save
service calls the optimisation helper to retain signed history. The registration loads before `orcid.pb.js`
and wraps the normal update chain. No database schema change is required. Hook deployment is
separate from a frontend release and requires explicit backend deployment approval and the backup,
checksum, restart and health procedures in `AGENTS.md`. Adding these files does not deploy them.
