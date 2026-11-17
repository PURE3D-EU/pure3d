const PROTOCOL = 'viewing-copy-v1';
const MAX_MODEL_BYTES = 256 * 1024 * 1024;
const MAX_SCENE_BYTES = 5 * 1024 * 1024;
const staleMessage =
	'The edition files changed. Reload the edition before applying or restoring a viewing copy.';

function bad(message) {
	throw new BadRequestError(message);
}

function parse(value) {
	try {
		return JSON.parse(value);
	} catch {
		bad('Invalid model optimisation data.');
	}
}

function prepare(e) {
	const value = e.requestInfo().body.modelOptimisation;
	if (value === undefined) return e.next();
	if (!e.auth) throw new ForbiddenError();
	const app = e.app;
	try {
		return app.runInTransaction((tx) => {
			const latest = tx.findRecordById('editions', e.record.id);
			if (latest.getString('updated') !== e.record.original().getString('updated'))
				bad(staleMessage);
			e.app = tx;
			return prepareChange(e, value);
		});
	} finally {
		e.app = app;
	}
}

function readScene(filesystem, before, filename) {
	const reader = filesystem.getReader(before.baseFilesPath() + '/' + filename);
	try {
		// Read one extra byte so oversized scenes cannot be silently truncated.
		const text = toString(reader, MAX_SCENE_BYTES + 1);
		if (toBytes(text).length > MAX_SCENE_BYTES) bad('Voyager scenes must be 5 MB or smaller.');
		const scene = parse(text);
		if (
			!scene ||
			typeof scene !== 'object' ||
			!scene.asset ||
			typeof scene.asset !== 'object' ||
			Array.isArray(scene.asset) ||
			!Array.isArray(scene.scenes)
		)
			bad('The stored Voyager scene is invalid.');
		return scene;
	} finally {
		reader.close();
	}
}

// Bind restore provenance to this edition and these exact stored filenames. The
// existing private server token secret avoids a new setting or schema field.
function signature(app, metadata) {
	const secret = app.findCollectionByNameOrId('_superusers').fileToken.secret;
	if (!secret) throw new InternalServerError('Model optimisation signing is unavailable.');
	return $security.hs256(
		JSON.stringify([
			PROTOCOL,
			metadata.editionId,
			metadata.sourceModel,
			metadata.viewingModel,
			metadata.previousScene,
			metadata.createdAt
		]),
		secret
	);
}

function storedMetadata(e, before, scene, assets) {
	const metadata = scene.asset.extras && scene.asset.extras.pure3dViewingCopy;
	if (metadata === undefined) return null;
	if (
		!metadata ||
		metadata.protocol !== PROTOCOL ||
		metadata.editionId !== before.id ||
		metadata.sourceModel !== before.getString('modelFile') ||
		typeof metadata.viewingModel !== 'string' ||
		!/\.glb$/i.test(metadata.viewingModel) ||
		!assets.includes(metadata.viewingModel) ||
		typeof metadata.previousScene !== 'string' ||
		(metadata.previousScene !== '' &&
			(!assets.includes(metadata.previousScene) || !/\.json$/i.test(metadata.previousScene))) ||
		typeof metadata.createdAt !== 'string' ||
		typeof metadata.signature !== 'string' ||
		metadata.signature !== signature(e.app, metadata)
	)
		bad('The viewing-copy history is invalid or its source model has changed.');
	return metadata;
}

function validateGlb(file) {
	if (!/\.glb$/i.test(file.originalName) || file.size < 20 || file.size > MAX_MODEL_BYTES)
		bad('Upload one GLB viewing copy, no larger than 256 MB.');
	const reader = file.reader.open();
	let bytes;
	try {
		bytes = toBytes(reader, 12);
	} finally {
		reader.close();
	}
	const uint32 = (offset) =>
		bytes[offset] +
		bytes[offset + 1] * 256 +
		bytes[offset + 2] * 65536 +
		bytes[offset + 3] * 16777216;
	if (
		bytes.length !== 12 ||
		uint32(0) !== 0x46546c67 ||
		uint32(4) !== 2 ||
		uint32(8) !== file.size ||
		file.size % 4 !== 0
	)
		bad('The viewing copy has an invalid GLB header, version or length.');
}

// Keep the same repeated PocketBase suffix stripping as VoyagerPreview.originalBasename.
function originalBasename(stored) {
	let name = stored;
	let previous;
	do {
		previous = name;
		name = name.replace(/_[a-z0-9]{10}(\.[^.]+)$/i, '$1');
	} while (name !== previous);
	return name.toLowerCase();
}

function rewriteModel(scene, source, viewing, replacement, assets, allowSourceAlias = true) {
	if (
		!Array.isArray(scene.models) ||
		scene.models.length !== 1 ||
		!scene.models[0] ||
		!Array.isArray(scene.models[0].derivatives)
	)
		bad('Only single-model Voyager scenes can use a viewing copy.');
	let mappings = 0;
	for (const derivative of scene.models[0].derivatives) {
		if (!derivative || !Array.isArray(derivative.assets))
			bad('The Voyager model derivatives are invalid.');
		for (const asset of derivative.assets) {
			if (!asset || typeof asset !== 'object') bad('The Voyager model assets are invalid.');
			if (
				!['geometry', 'model'].includes(String(asset.type).toLowerCase()) &&
				!(typeof asset.uri === 'string' && /\.(glb|gltf|obj|ply|stl)(?:[?#]|$)/i.test(asset.uri))
			)
				continue;
			if (typeof asset.uri !== 'string') bad('The Voyager geometry reference is unsupported.');
			const uri = asset.uri;
			const path = uri.split(/[?#]/, 1)[0];
			const filename = path.startsWith('./') ? path.slice(2) : path;
			const sourceAlias = originalBasename(source);
			const aliasMatches = allowSourceAlias && filename.toLowerCase() === sourceAlias;
			const aliasCollides = assets.some(
				(name) => name !== source && originalBasename(name) === sourceAlias
			);
			if (
				/[\\/]/.test(filename) ||
				!/\.glb$/i.test(filename) ||
				(filename !== source && filename !== viewing && (!aliasMatches || aliasCollides))
			)
				bad('The scene contains geometry that cannot be safely mapped to the current model.');
			asset.uri = replacement + uri.slice(path.length);
			mappings++;
		}
	}
	if (!mappings) bad('The scene has no GLB reference to the current model.');
}

// Camera/light defaults follow VoyagerPreview; GLB uses Voyager's Model asset,
// not the Geometry asset used by its OBJ/PLY wrapper. Existing scenes are not rebuilt.
function defaultScene(filename, title) {
	return {
		asset: { type: 'application/si-dpo-3d.document+json', version: '1.0' },
		scene: 0,
		scenes: [{ name: 'Scene', units: 'cm', nodes: [0, 1, 6], setup: 0, meta: 0 }],
		nodes: [
			{ name: 'Camera', camera: 0 },
			{ name: 'Lights', children: [2, 3, 4, 5] },
			{ name: 'Ambient', light: 0 },
			{ name: 'Key', light: 1, translation: [1, 1, 1] },
			{ name: 'Fill', light: 2, translation: [-1, 0.5, 1] },
			{ name: 'Back', light: 3, translation: [0, 1, -1] },
			{ name: 'Model', model: 0 }
		],
		cameras: [
			{
				type: 'perspective',
				perspective: { yfov: 52, znear: 0.1, zfar: 100000 },
				autoNearFar: true
			}
		],
		lights: [
			{ type: 'ambient', color: [1, 1, 1], intensity: 0.8 },
			{ type: 'directional', color: [1, 0.95, 0.9], intensity: 1 },
			{ type: 'directional', color: [0.9, 0.95, 1], intensity: 0.7 },
			{ type: 'directional', color: [0.85, 0.9, 1], intensity: 0.5 }
		],
		models: [
			{
				units: 'cm',
				derivatives: [
					{
						usage: 'Web3D',
						quality: 'High',
						assets: [{ uri: filename, type: 'Model', mimeType: 'model/gltf-binary' }]
					}
				]
			}
		],
		setups: [{}],
		metas: [{ collection: { titles: { EN: title } } }]
	};
}

function prepareChange(e, value) {
	if (typeof value !== 'string' || value.length > 32768)
		bad('Invalid model optimisation manifest.');
	const manifest = parse(value);
	if (
		!manifest ||
		!['apply', 'restore'].includes(manifest.action) ||
		Object.keys(manifest).some((key) => !['action', 'expectedFiles'].includes(key))
	)
		bad('Invalid model optimisation manifest.');
	const allowed =
		manifest.action === 'apply' ? ['modelOptimisation', 'modelAssets+'] : ['modelOptimisation'];
	if (Object.keys(e.requestInfo().body).some((key) => !allowed.includes(key)))
		bad('Model optimisation cannot be combined with other edition changes.');
	for (const field of e.record.collection().fields) {
		for (const key of [field.name, field.name + '+', field.name + '-']) {
			if (
				!(manifest.action === 'apply' && key === 'modelAssets+') &&
				e.findUploadedFiles(key).length
			)
				bad('Only a viewing-copy upload is allowed.');
		}
	}
	const before = e.record.original();
	const source = before.getString('modelFile');
	const sceneName = before.getString('sceneDocument');
	const assets = before.get('modelAssets') || [];
	const expected = manifest.expectedFiles;
	if (
		!expected ||
		expected.modelFile !== source ||
		expected.sceneDocument !== sceneName ||
		JSON.stringify(expected.modelAssets) !== JSON.stringify(assets)
	)
		bad(staleMessage);
	if (!/\.glb$/i.test(source)) bad('Viewing copies currently support GLB source models only.');
	const uploads = e.findUploadedFiles('modelAssets+');
	if (uploads.length !== (manifest.action === 'apply' ? 1 : 0))
		bad('Apply requires exactly one GLB; restore does not accept uploads.');
	const filesystem = e.app.newFilesystem();
	try {
		const scene = sceneName
			? readScene(filesystem, before, sceneName)
			: defaultScene(source, before.getString('title'));
		const metadata = storedMetadata(e, before, scene, assets);
		if (manifest.action === 'restore') {
			if (!metadata) bad('This edition has no viewing-copy history to restore.');
			// Validate the current geometry before accepting history from an edited scene.
			rewriteModel(
				scene,
				metadata.viewingModel,
				metadata.viewingModel,
				metadata.viewingModel,
				assets,
				false
			);
			if (metadata.previousScene) {
				readScene(filesystem, before, metadata.previousScene);
				e.record.set(
					'sceneDocument',
					filesystem.getReuploadableFile(
						before.baseFilesPath() + '/' + metadata.previousScene,
						false
					)
				);
			} else e.record.set('sceneDocument', null);
			e.record.set('modelAssets', assets);
		} else {
			const copy = uploads[0];
			validateGlb(copy);
			copy.name = $filesystem.fileFromBytes('', 'viewing-copy.glb').name;
			rewriteModel(scene, source, metadata ? metadata.viewingModel : source, copy.name, assets);
			const maxFiles = e.record.collection().fields.getByName('modelAssets').maxSelect;
			if (maxFiles > 0 && assets.length + 1 + (sceneName ? 1 : 0) > maxFiles)
				bad(
					'This edition has reached its companion-file limit. Retained viewing copies and scene snapshots also count towards this limit.'
				);
			let backup = null;
			if (sceneName) {
				backup = filesystem.getReuploadableFile(before.baseFilesPath() + '/' + sceneName, false);
				backup.name = $filesystem.fileFromBytes('', 'viewing-copy-previous.svx.json').name;
			}
			const nextMetadata = {
				protocol: PROTOCOL,
				editionId: before.id,
				sourceModel: source,
				viewingModel: copy.name,
				previousScene: backup ? backup.name : '',
				createdAt: new Date().toISOString()
			};
			nextMetadata.signature = signature(e.app, nextMetadata);
			if (!scene.asset.extras) scene.asset.extras = {};
			if (typeof scene.asset.extras !== 'object' || Array.isArray(scene.asset.extras))
				bad('The Voyager asset extras are invalid.');
			scene.asset.extras.pure3dViewingCopy = nextMetadata;
			const json = JSON.stringify(scene);
			if (toBytes(json).length > MAX_SCENE_BYTES) bad('The resulting Voyager scene exceeds 5 MB.');
			e.record.set('sceneDocument', $filesystem.fileFromBytes(json, 'scene.svx.json'));
			e.record.set('modelAssets', assets.concat(backup ? [copy, backup] : [copy]));
		}
		// Explicitly retain the source; the ordinary update/rule chain still owns the save.
		e.record.set('modelFile', source);
		return e.next();
	} finally {
		filesystem.close();
	}
}

// Voyager deflates asset.extras. Only carry server-validated history forward;
// never accept the reserved metadata from the client scene. Invalid old history
// is discarded so a normal scene save can still repair an edition.
function preserveViewingCopy(e, document) {
	if (document.asset.extras && typeof document.asset.extras === 'object')
		delete document.asset.extras.pure3dViewingCopy;
	const before = e.record.original();
	const sceneName = before.getString('sceneDocument');
	if (!sceneName) return document;
	let metadata = null;
	const filesystem = e.app.newFilesystem();
	try {
		const reader = filesystem.getReader(before.baseFilesPath() + '/' + sceneName);
		let text;
		try {
			text = toString(reader, 50 * 1024 * 1024 + 1);
		} finally {
			reader.close();
		}
		if (toBytes(text).length <= 50 * 1024 * 1024) {
			const stored = JSON.parse(text);
			if (stored && stored.asset && stored.asset.extras && stored.asset.extras.pure3dViewingCopy)
				metadata = storedMetadata(e, before, stored, before.get('modelAssets') || []);
		}
	} catch {
		// Missing, unreadable or invalid prior metadata cannot authorise history.
		// Dropping it is safe; refusing all scene saves would prevent source repair.
		metadata = null;
	} finally {
		filesystem.close();
	}
	if (!metadata) return document;
	if (!document.asset.extras) document.asset.extras = {};
	if (typeof document.asset.extras !== 'object' || Array.isArray(document.asset.extras))
		bad('The Voyager asset extras are invalid.');
	document.asset.extras.pure3dViewingCopy = metadata;
	if (toBytes(JSON.stringify(document)).length > MAX_SCENE_BYTES)
		bad('Scenes with viewing-copy history must be 5 MB or smaller.');
	return document;
}

module.exports = { prepare, preserveViewingCopy };
