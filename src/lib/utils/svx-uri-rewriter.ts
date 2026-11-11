import { pbNormalize } from './pb-filename';

export type FileMap = Record<string, string>;

function basename(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash === -1 ? path : path.slice(slash + 1);
}

function mappedUri(uri: string, fileMap: FileMap): string {
	const path = uri.split(/[?#]/, 1)[0];
	const mapped = fileMap[basename(path)] ?? fileMap[pbNormalize(basename(path))];
	if (!mapped) return uri;
	const suffix = new URL(uri, 'https://pure3d.invalid/');
	suffix.searchParams.delete('token');
	for (const [key, value] of [...suffix.searchParams])
		if (/^\d+$/.test(key) && !value) suffix.searchParams.delete(key);
	return (
		mapped.split('#', 1)[0] +
		(suffix.search ? (mapped.includes('?') ? '&' : '?') + suffix.search.slice(1) : '') +
		suffix.hash
	);
}

function rewriteValue(value: unknown, fileMap: FileMap): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => rewriteValue(item, fileMap));
	}
	if (value && typeof value === 'object') {
		const result: Record<string, unknown> = {};
		for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
			if (key === 'uri' && typeof v === 'string') {
				result[key] = mappedUri(v, fileMap);
			} else if (key === 'uris' && v && typeof v === 'object' && !Array.isArray(v)) {
				result[key] = Object.fromEntries(
					Object.entries(v).map(([language, uri]) => [
						language,
						typeof uri === 'string' ? mappedUri(uri, fileMap) : uri
					])
				);
			} else {
				result[key] = rewriteValue(v, fileMap);
			}
		}
		return result;
	}
	return value;
}

export function rewriteSceneJson<T extends object>(scene: T, fileMap: FileMap): T {
	return rewriteValue(scene, fileMap) as T;
}

export function withSceneTitle<T extends object>(scene: T, title: string): T {
	const document = structuredClone(scene) as Record<string, unknown>;
	const scenes = Array.isArray(document.scenes) ? document.scenes : [];
	const sceneIndex = typeof document.scene === 'number' ? document.scene : 0;
	const activeScene = scenes[sceneIndex];
	if (!activeScene || typeof activeScene !== 'object') return document as T;

	const metas = Array.isArray(document.metas) ? [...document.metas] : [];
	const sceneRecord = { ...(activeScene as Record<string, unknown>) };
	let metaIndex = typeof sceneRecord.meta === 'number' ? sceneRecord.meta : -1;
	const currentMeta = metaIndex >= 0 && metas[metaIndex];
	if (!currentMeta || typeof currentMeta !== 'object') {
		metaIndex = metas.length;
		sceneRecord.meta = metaIndex;
	}

	const setupIndex = typeof sceneRecord.setup === 'number' ? sceneRecord.setup : -1;
	const setup = Array.isArray(document.setups) ? document.setups[setupIndex] : undefined;
	const language =
		setup && typeof setup === 'object'
			? (setup as { language?: { language?: unknown } }).language?.language
			: undefined;
	metas[metaIndex] ||= {};
	document.metas = metas.map((value, index) => {
		if (index !== metaIndex || !value || typeof value !== 'object') return value;
		const meta = { ...(value as Record<string, unknown>) };
		const collection = { ...((meta.collection as Record<string, unknown>) || {}) };
		const titles: Record<string, unknown> = {
			...((collection.titles as Record<string, unknown>) || {}),
			EN: title
		};
		if (typeof language === 'string' && language) titles[language.toUpperCase()] = title;
		collection.titles = titles;
		meta.collection = collection;
		return meta;
	});
	scenes[sceneIndex] = sceneRecord;
	document.scenes = scenes;
	return document as T;
}
