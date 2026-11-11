const MAX_BYTES = 50 * 1024 * 1024;
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const allowedExtension = /\.(html?|png|jpe?g|webp|gif|avif|mp3|wav|ogg|mp4|webm|vtt)$/i;
const staleMessage =
	'The edition files changed while Voyager was open. Your changes have not been saved; keep this editor open to avoid losing them.';

function parse(value, message) {
	try {
		return JSON.parse(value);
	} catch {
		throw new BadRequestError(message);
	}
}

// Runs before the ordinary edition update handler, so the same permissions, workflow locks,
// sandbox limits, file validation and audit hooks apply to scene and companion changes together.
function prepare(e) {
	const value = e.requestInfo().body.voyagerSave;
	if (value === undefined) return e.next();
	if (!e.auth) throw new ForbiddenError();
	const app = e.app;
	try {
		return app.runInTransaction((tx) => {
			const latest = tx.findRecordById('editions', e.record.id);
			if (latest.getString('updated') !== e.record.original().getString('updated'))
				throw new BadRequestError(staleMessage);
			e.app = tx;
			return prepareSave(e, value);
		});
	} finally {
		e.app = app;
	}
}

function prepareSave(e, value) {
	if (typeof value !== 'string' || value.length > 32768)
		throw new BadRequestError('Invalid Voyager save manifest.');
	const manifest = parse(value, 'Invalid Voyager save manifest.');
	if (!manifest || !Array.isArray(manifest.assets) || manifest.assets.length > 100)
		throw new BadRequestError('Save up to 100 article and media files at a time.');
	const before = e.record.original();
	const expected = manifest.expectedFiles;
	const current = {
		sceneDocument: before.getString('sceneDocument'),
		modelFile: before.getString('modelFile'),
		modelAssets: before.get('modelAssets') || []
	};
	if (
		!expected ||
		expected.sceneDocument !== current.sceneDocument ||
		expected.modelFile !== current.modelFile ||
		JSON.stringify(expected.modelAssets) !== JSON.stringify(current.modelAssets)
	)
		throw new BadRequestError(staleMessage);
	const scenes = e.findUploadedFiles('sceneDocument');
	const uploads = manifest.assets.length ? e.findUploadedFiles('modelAssets+') : [];
	if (scenes.length !== 1 || uploads.length !== manifest.assets.length)
		throw new BadRequestError('The Voyager save is missing its scene or companion files.');
	const maxFiles = e.record.collection().fields.getByName('modelAssets').maxSelect;
	if (maxFiles > 0 && current.modelAssets.length + uploads.length > maxFiles)
		throw new BadRequestError(
			'This edition has reached its companion-file limit. Remove unused older companion files before saving new article revisions.'
		);
	if (scenes[0].size > MAX_BYTES || uploads.reduce((sum, file) => sum + file.size, 0) > MAX_BYTES)
		throw new BadRequestError(
			'A Voyager save supports up to 50 MB of scene data and 50 MB of changed media.'
		);
	const read = (file, limit) => {
		const reader = file.reader.open();
		try {
			return toString(reader, limit);
		} finally {
			reader.close();
		}
	};
	const document = parse(read(scenes[0], MAX_BYTES), 'Voyager returned an invalid scene.');
	if (
		!document ||
		typeof document !== 'object' ||
		!document.asset ||
		!Array.isArray(document.scenes)
	)
		throw new BadRequestError('Voyager returned an invalid scene.');
	const replacements = new Map();
	const names = new Set();
	for (let index = 0; index < uploads.length; index++) {
		const entry = manifest.assets[index];
		const file = uploads[index];
		if (
			!entry ||
			typeof entry.path !== 'string' ||
			entry.path.length > 500 ||
			!/^[-\w./ ]+$/.test(entry.path) ||
			entry.path.startsWith('/') ||
			entry.path.split('/').some((part) => !part || part === '.' || part === '..') ||
			!allowedExtension.test(entry.path)
		)
			throw new BadRequestError('Unsupported Voyager article or media filename.');
		const name = entry.path.split('/').pop();
		if (names.has(name.toLowerCase()) || file.originalName !== name)
			throw new BadRequestError('Use unique article and media filenames across folders.');
		names.add(name.toLowerCase());
		if (entry.original && !current.modelAssets.includes(entry.original))
			throw new BadRequestError('The original companion file does not belong to this edition.');
		if (/\.html?$/i.test(name) && file.size > MAX_HTML_BYTES)
			throw new BadRequestError('Each Voyager article must be 5 MB or smaller.');
		replacements.set(entry.path, file.name);
		replacements.set(name, file.name);
		if (entry.original) replacements.set(entry.original, file.name);
	}
	const rewriteUri = (value) => {
		if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) return value;
		const path = value.split(/[?#]/, 1)[0];
		const mapped = replacements.get(path) || replacements.get(path.split('/').pop());
		return mapped ? mapped + value.slice(path.length) : value;
	};
	const rewrite = (value, key = '', depth = 0) => {
		if (depth > 64) throw new BadRequestError('Voyager scene data is nested too deeply.');
		if (typeof value === 'string')
			return key === 'uri' || key === 'uris' ? rewriteUri(value) : value;
		if (Array.isArray(value)) return value.map((item) => rewrite(item, key, depth + 1));
		if (value && typeof value === 'object')
			return Object.fromEntries(
				Object.entries(value).map(([field, item]) => [
					field,
					rewrite(item, key === 'uris' ? 'uris' : field, depth + 1)
				])
			);
		return value;
	};
	for (let index = 0; index < uploads.length; index++) {
		const file = uploads[index];
		if (!/\.html?$/i.test(file.originalName)) continue;
		const html = read(file, MAX_HTML_BYTES).replace(
			/\b(src|href|poster)\s*=\s*(["'])(.*?)\2/gi,
			(match, attribute, quote, uri) => {
				const rewritten = rewriteUri(uri);
				return rewritten === uri ? match : `${attribute}=${quote}${rewritten}${quote}`;
			}
		);
		const rewritten = $filesystem.fileFromBytes(html, file.originalName);
		rewritten.name = file.name;
		uploads[index] = rewritten;
	}
	// Keep prior companions: links from unchanged articles may still reference them. The normal
	// modelAssets limit bounds retained revisions; failed saves leave the existing scene intact.
	e.record.set('modelAssets', current.modelAssets.concat(uploads));
	e.record.set(
		'sceneDocument',
		$filesystem.fileFromBytes(JSON.stringify(rewrite(document)), 'scene.svx.json')
	);
	return e.next();
}

module.exports = { prepare };
