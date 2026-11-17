import type {
	ModelFinding,
	ModelAnalysis,
	ModelOptimisationOptions,
	ModelOptimisationResult,
	ModelWorkerJob
} from '../utils/model-optimisation';

const MAX_MODEL_BYTES = 256 * 1024 * 1024;
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const MAX_ITEMS = 100_000;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

// Untrusted JSON is narrowed at each field we use; untouched property values are retained.
type RecordValue = Record<string, unknown>;
type ModelDocument = RecordValue & {
	buffers: RecordValue[];
	bufferViews: RecordValue[];
	accessors: RecordValue[];
	meshes: RecordValue[];
	materials: RecordValue[];
	textures: RecordValue[];
	images: RecordValue[];
};
type ParsedModel = { document: ModelDocument; binary: Uint8Array; extensions: string[] };

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Invalid ${label}: expected an object.`);
	}
	return value as RecordValue;
}

function integer(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
		throw new Error(`Invalid ${label}.`);
	}
	return value;
}

function items(value: unknown, label: string): RecordValue[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > MAX_ITEMS) {
		throw new Error(`Invalid or oversized ${label} list.`);
	}
	return value.map((item) => record(item, label));
}

function reference(value: unknown, list: unknown[], label: string): number {
	const index = integer(value, label);
	if (index >= list.length) throw new Error(`Invalid ${label} reference.`);
	return index;
}

async function parse(file: File): Promise<ParsedModel> {
	if (file.size > MAX_MODEL_BYTES) throw new Error('Models larger than 256 MiB are not supported.');
	if (file.size < 20) throw new Error('This is not a binary glTF 2.0 (GLB) file.');
	const bytes = new Uint8Array(await file.arrayBuffer());
	const header = new DataView(bytes.buffer);
	if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2) {
		throw new Error('Only binary glTF 2.0 (GLB) files are supported.');
	}
	if (header.getUint32(8, true) !== bytes.length) throw new Error('The GLB length is invalid.');
	let json: Uint8Array | undefined;
	let binary: Uint8Array | undefined;
	for (let offset = 12; offset < bytes.length; ) {
		if (offset + 8 > bytes.length) throw new Error('The GLB chunk header is truncated.');
		const length = header.getUint32(offset, true);
		const kind = header.getUint32(offset + 4, true);
		const end = offset + 8 + length;
		if (length % 4 || end > bytes.length) throw new Error('The GLB chunk length is invalid.');
		if (kind === JSON_CHUNK && offset === 12 && !json && length <= MAX_JSON_BYTES) {
			json = bytes.subarray(offset + 8, end);
		} else if (kind === BIN_CHUNK && json && !binary) {
			binary = bytes.subarray(offset + 8, end);
		} else {
			throw new Error('Unsupported, duplicate or oversized GLB chunk.');
		}
		offset = end;
	}
	if (!json) throw new Error('The GLB JSON chunk is missing.');
	const root = record(
		JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json), (_key, value) => {
			if (
				typeof value === 'number' &&
				(!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
			) {
				throw new Error('The model contains numeric values that cannot be safely preserved.');
			}
			return value;
		}),
		'glTF'
	);
	const asset = record(root.asset, 'asset');
	if (asset.version !== '2.0' || (asset.minVersion !== undefined && asset.minVersion !== '2.0')) {
		throw new Error('Only glTF version 2.0 is supported.');
	}
	// Do not materialise absent arrays: even unused metadata should survive unchanged.
	const document = root as ModelDocument;
	const lists = Object.fromEntries(
		['buffers', 'bufferViews', 'accessors', 'meshes', 'materials', 'textures', 'images'].map(
			(key) => [key, items(root[key], key)]
		)
	) as Record<
		keyof Pick<
			ModelDocument,
			'buffers' | 'bufferViews' | 'accessors' | 'meshes' | 'materials' | 'textures' | 'images'
		>,
		RecordValue[]
	>;
	const bin = binary ?? new Uint8Array();
	if (lists.buffers.length !== 1 || lists.buffers[0].uri !== undefined) {
		throw new Error(
			'A single embedded GLB buffer is required; external resources are not supported.'
		);
	}
	const declaredLength = integer(lists.buffers[0].byteLength, 'buffer length', bin.length);
	if (bin.length - declaredLength > 3) throw new Error('The embedded buffer length is invalid.');
	let referencedBytes = 0;
	for (const view of lists.bufferViews) {
		if (view.buffer !== 0) throw new Error('Only the embedded buffer is supported.');
		const start = integer(view.byteOffset ?? 0, 'buffer view offset', declaredLength);
		const length = integer(view.byteLength, 'buffer view length', declaredLength);
		referencedBytes += length;
		if (referencedBytes > MAX_MODEL_BYTES * 2) {
			throw new Error('Overlapping buffer views exceed the 512 MiB processing budget.');
		}
		if (start + length > declaredLength)
			throw new Error('A buffer view exceeds the embedded buffer.');
	}
	let decodedTextureBytes = 0;
	for (const image of lists.images) {
		if (image.uri !== undefined) throw new Error('External or data-URI images are not supported.');
		reference(image.bufferView, lists.bufferViews, 'image buffer view');
		if (!['image/png', 'image/jpeg'].includes(String(image.mimeType))) {
			throw new Error('Only embedded PNG and JPEG images are supported.');
		}
		const view = lists.bufferViews[Number(image.bufferView)];
		const start = Number(view.byteOffset ?? 0);
		const data = bin.subarray(start, start + Number(view.byteLength));
		let dimensions = image.mimeType === 'image/jpeg' ? jpegDimensions(data) : null;
		if (image.mimeType === 'image/png' && data.length >= 24) {
			const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
			if (
				header.getUint32(0) === 0x89504e47 &&
				header.getUint32(4) === 0x0d0a1a0a &&
				header.getUint32(12) === 0x49484452
			)
				dimensions = { width: header.getUint32(16), height: header.getUint32(20) };
		}
		if (
			!dimensions ||
			!dimensions.width ||
			!dimensions.height ||
			Math.max(dimensions.width, dimensions.height) > 8192
		)
			throw new Error(
				'An image has an unsupported header or exceeds the 8192-pixel preview limit.'
			);
		decodedTextureBytes += dimensions.width * dimensions.height * 4;
		if (decodedTextureBytes > MAX_MODEL_BYTES)
			throw new Error('Decoded textures exceed the 256 MiB browser preview budget.');
	}
	for (const texture of lists.textures) {
		if (texture.source !== undefined) reference(texture.source, lists.images, 'texture image');
	}
	const components: Record<string, number> = {
		'5120': 1,
		'5121': 1,
		'5122': 2,
		'5123': 2,
		'5125': 4,
		'5126': 4
	};
	const dimensions: Record<string, number> = {
		SCALAR: 1,
		VEC2: 2,
		VEC3: 3,
		VEC4: 4,
		MAT2: 4,
		MAT3: 9,
		MAT4: 16
	};
	let decodedGeometryBytes = 0;
	for (const accessor of lists.accessors) {
		const count = integer(accessor.count, 'accessor count', 1_000_000_000);
		const component = Object.hasOwn(components, String(accessor.componentType))
			? components[String(accessor.componentType)]
			: 0;
		const dimension = Object.hasOwn(dimensions, String(accessor.type))
			? dimensions[String(accessor.type)]
			: 0;
		if (!component || !dimension) throw new Error('An accessor has an unsupported data type.');
		const matrixEdge =
			accessor.type === 'MAT2'
				? 2
				: accessor.type === 'MAT3'
					? 3
					: accessor.type === 'MAT4'
						? 4
						: 0;
		const elementBytes = matrixEdge
			? Math.ceil((matrixEdge * component) / 4) * 4 * matrixEdge
			: component * dimension;
		decodedGeometryBytes += count * elementBytes;
		if (decodedGeometryBytes > MAX_MODEL_BYTES * 2)
			throw new Error('Decoded geometry exceeds the 512 MiB browser preview budget.');
		const validateRange = (index: unknown, offset: unknown, size: number, stride?: number) => {
			const view = lists.bufferViews[reference(index, lists.bufferViews, 'accessor buffer view')];
			const start = integer(offset ?? 0, 'accessor offset');
			const step = stride ?? elementBytes;
			if (start + size > Number(view.byteLength) || step < elementBytes)
				throw new Error('Accessor data exceeds its buffer view.');
		};
		if (accessor.bufferView !== undefined) {
			const view =
				lists.bufferViews[
					reference(accessor.bufferView, lists.bufferViews, 'accessor buffer view')
				];
			const stride =
				view.byteStride === undefined
					? elementBytes
					: integer(view.byteStride, 'accessor stride', 252);
			validateRange(
				accessor.bufferView,
				accessor.byteOffset,
				count ? (count - 1) * stride + elementBytes : 0,
				stride
			);
		}
		if (accessor.sparse !== undefined) {
			const sparse = record(accessor.sparse, 'sparse accessor');
			const sparseCount = integer(sparse.count, 'sparse count', count);
			const indices = record(sparse.indices, 'sparse indices');
			const values = record(sparse.values, 'sparse values');
			const indexSize = components[String(indices.componentType)];
			if (![5121, 5123, 5125].includes(Number(indices.componentType)))
				throw new Error('Invalid sparse index type.');
			validateRange(indices.bufferView, indices.byteOffset, sparseCount * indexSize);
			validateRange(values.bufferView, values.byteOffset, sparseCount * elementBytes);
		}
	}
	// Find extension objects as well as declarations, including undeclared optional extensions.
	const extensions = new Set<string>();
	const stack: unknown[] = [root];
	let visited = 0;
	while (stack.length) {
		const value = stack.pop();
		if (!value || typeof value !== 'object') continue;
		if (++visited > 500_000) throw new Error('The GLB JSON structure is too complex.');
		for (const [key, child] of Object.entries(value)) {
			if (key === 'extras') continue;
			if (key === 'extensions')
				Object.keys(record(child, 'extensions')).forEach((name) => extensions.add(name));
			if (key === 'extensionsUsed' || key === 'extensionsRequired') {
				if (!Array.isArray(child) || child.some((name) => typeof name !== 'string'))
					throw new Error('Invalid extension declarations.');
				child.forEach((name) => extensions.add(name));
			}
			if (child && typeof child === 'object') stack.push(child);
		}
	}
	return { document, binary: bin.subarray(0, declaredLength), extensions: [...extensions] };
}

function list(document: ModelDocument, key: string): RecordValue[] {
	return (document[key] as RecordValue[] | undefined) ?? [];
}

function report(file: File, parsed: ParsedModel): ModelAnalysis {
	const { document, extensions } = parsed;
	const accessors = list(document, 'accessors');
	let vertices = 0;
	let triangles = 0;
	let otherPrimitives = 0;
	for (const mesh of list(document, 'meshes')) {
		for (const primitive of items(mesh.primitives, 'mesh primitives')) {
			const attributes = record(primitive.attributes, 'primitive attributes');
			for (const index of Object.values(attributes))
				reference(index, accessors, 'attribute accessor');
			const position =
				attributes.POSITION === undefined ? undefined : accessors[Number(attributes.POSITION)];
			vertices += Number(position?.count ?? 0);
			const count =
				primitive.indices === undefined
					? Number(position?.count ?? 0)
					: Number(accessors[reference(primitive.indices, accessors, 'index accessor')].count);
			if (primitive.material !== undefined)
				reference(primitive.material, list(document, 'materials'), 'primitive material');
			const mode = integer(primitive.mode ?? 4, 'primitive mode', 6);
			if (mode === 4) triangles += Math.floor(count / 3);
			else if (mode === 5 || mode === 6) triangles += Math.max(0, count - 2);
			else otherPrimitives++;
		}
	}
	const findings: ModelFinding[] = [
		{
			tone: 'success',
			title: 'Embedded GLB 2.0',
			detail:
				'Binary structure and referenced geometry ranges checked. This is not a full glTF conformance validation.'
		}
	];
	if (extensions.length)
		findings.push({
			tone: 'warning',
			title: 'Unsupported extensions',
			detail: `Optimisation is disabled to preserve extension data: ${extensions.join(', ')}.`
		});
	if (otherPrimitives)
		findings.push({
			tone: 'info',
			title: 'Non-triangle geometry',
			detail: 'Point and line primitives are preserved and excluded from the triangle total.'
		});
	findings.push({
		tone: 'info',
		title: 'Geometry counts',
		detail:
			'Counts sum mesh primitives, not scene instances; shared accessors may be counted more than once.'
	});
	findings.push({
		tone: 'info',
		title: 'Conservative optimisation',
		detail:
			'Lossless mode compacts JSON and deduplicates identical buffer view bytes. Geometry, names, materials, animations and metadata are retained; smaller output is not guaranteed.'
	});
	if (triangles > 1_000_000)
		findings.push({
			tone: 'warning',
			title: 'High triangle count',
			detail:
				'This model may be expensive to display on mobile devices. Geometry simplification is not performed.'
		});
	return {
		size: file.size,
		vertices,
		triangles,
		meshes: list(document, 'meshes').length,
		materials: list(document, 'materials').length,
		textures: list(document, 'textures').length,
		findings,
		canOptimise: extensions.length === 0
	};
}

async function analyseDirect(file: File): Promise<ModelAnalysis> {
	try {
		return report(file, await parse(file));
	} catch (error) {
		return {
			size: file.size,
			vertices: 0,
			triangles: 0,
			meshes: 0,
			materials: 0,
			textures: 0,
			canOptimise: false,
			findings: [
				{
					tone: 'error',
					title: 'Model cannot be optimised',
					detail: error instanceof Error ? error.message : 'Could not read the model.'
				}
			]
		};
	}
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
	for (let offset = 2; offset + 4 <= bytes.length; ) {
		if (bytes[offset++] !== 0xff) return null;
		while (bytes[offset] === 0xff) offset++;
		const marker = bytes[offset++];
		if (marker === 0xda || marker === 0xd9) return null;
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
		const length = (bytes[offset] << 8) | bytes[offset + 1];
		if (length < 2 || offset + length > bytes.length) return null;
		if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
			return {
				height: (bytes[offset + 3] << 8) | bytes[offset + 4],
				width: (bytes[offset + 5] << 8) | bytes[offset + 6]
			};
		}
		offset += length;
	}
	return null;
}

async function recompressTextures(
	parsed: ParsedModel,
	options: ModelOptimisationOptions,
	changes: string[]
): Promise<Map<number, Uint8Array>> {
	const replacements = new Map<number, Uint8Array>();
	const { document, binary } = parsed;
	if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
		changes.push(
			'JPEG recompression is unavailable in this browser; only lossless repacking was applied.'
		);
		return replacements;
	}
	const images = list(document, 'images');
	const textures = list(document, 'textures');
	const eligible = new Set<number>();
	const protectedImages = new Set<number>();
	const visit = (value: unknown, path: string[], material: RecordValue) => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return;
		for (const [key, child] of Object.entries(value)) {
			if (key === 'extras') continue;
			const location = [...path, key];
			if (key.endsWith('Texture') && child !== undefined) {
				const info = record(child, 'material texture');
				const texture = textures[reference(info.index, textures, 'material texture')];
				if (texture.source !== undefined) {
					const source = reference(texture.source, images, 'texture source');
					const colour =
						location.join('.') === 'pbrMetallicRoughness.baseColorTexture' ||
						location.join('.') === 'emissiveTexture';
					if (colour && material.alphaMode !== 'MASK') eligible.add(source);
					else protectedImages.add(source);
				}
			} else visit(child, location, material);
		}
	};
	for (const material of list(document, 'materials')) visit(material, [], material);
	const accessorViews = new Set<number>();
	for (const accessor of list(document, 'accessors')) {
		if (accessor.bufferView !== undefined) accessorViews.add(Number(accessor.bufferView));
		if (accessor.sparse !== undefined) {
			const sparse = record(accessor.sparse, 'sparse');
			accessorViews.add(Number(record(sparse.indices, 'sparse indices').bufferView));
			accessorViews.add(Number(record(sparse.values, 'sparse values').bufferView));
		}
	}
	const imageUsers = new Map<number, { image: RecordValue; i: number }[]>();
	images.forEach((image, i) => {
		const index = Number(image.bufferView);
		const users = imageUsers.get(index) ?? [];
		users.push({ image, i });
		imageUsers.set(index, users);
	});
	for (const [index, view] of list(document, 'bufferViews').entries()) {
		const users = imageUsers.get(index) ?? [];
		if (
			!users.length ||
			accessorViews.has(index) ||
			!users.every(
				({ image, i }) =>
					image.mimeType === 'image/jpeg' && eligible.has(i) && !protectedImages.has(i)
			)
		)
			continue;
		const offset = Number(view.byteOffset ?? 0);
		const original = binary.subarray(offset, offset + Number(view.byteLength));
		const dimensions = jpegDimensions(original);
		if (
			!dimensions ||
			!dimensions.width ||
			!dimensions.height ||
			dimensions.width * dimensions.height > 16_777_216 ||
			Math.max(dimensions.width, dimensions.height) > 8192
		) {
			changes.push(
				`Skipped JPEG buffer view ${index}: unsupported header or decoded image exceeds the 16-megapixel/8192-pixel safety limit.`
			);
			continue;
		}
		let bitmap: ImageBitmap | undefined;
		try {
			bitmap = await createImageBitmap(
				new Blob([original as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }),
				{ imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }
			);
			const scale = Math.min(1, options.maxTextureSize / Math.max(bitmap.width, bitmap.height));
			const canvas = new OffscreenCanvas(
				Math.max(1, Math.round(bitmap.width * scale)),
				Math.max(1, Math.round(bitmap.height * scale))
			);
			const context = canvas.getContext('2d');
			if (!context) throw new Error('A 2D image encoder is unavailable.');
			context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
			const blob = await canvas.convertToBlob({
				type: 'image/jpeg',
				quality: options.textureQuality
			});
			if (blob.type !== 'image/jpeg') throw new Error('JPEG encoding is unavailable.');
			if (blob.size < original.length) {
				replacements.set(index, new Uint8Array(await blob.arrayBuffer()));
				changes.push(
					`Recompressed colour JPEG buffer view ${index}${scale < 1 ? ` to ${canvas.width} × ${canvas.height}` : ''}; saved ${original.length - blob.size} bytes (lossy).`
				);
			}
		} catch {
			changes.push(`Kept JPEG buffer view ${index}: the browser could not safely re-encode it.`);
		} finally {
			bitmap?.close();
		}
	}
	return replacements;
}

async function optimiseDirect(
	file: File,
	options: ModelOptimisationOptions
): Promise<ModelOptimisationResult> {
	if (
		!options ||
		!['lossless', 'textures'].includes(options.mode) ||
		!Number.isFinite(options.textureQuality) ||
		options.textureQuality < 0.1 ||
		options.textureQuality > 1 ||
		!Number.isInteger(options.maxTextureSize) ||
		options.maxTextureSize < 256 ||
		options.maxTextureSize > 8192
	) {
		throw new Error(
			'Invalid optimisation settings: JPEG quality must be 0.1–1 and maximum texture size 256–8192.'
		);
	}
	const parsed = await parse(file);
	const before = report(file, parsed);
	if (!before.canOptimise)
		throw new Error(`Unsupported extensions: ${parsed.extensions.join(', ')}.`);
	const changes: string[] = [];
	const replacements =
		options.mode === 'textures'
			? await recompressTextures(parsed, options, changes)
			: new Map<number, Uint8Array>();
	if (replacements.size) {
		changes.push(
			'JPEG re-encoding is lossy and may change colour or remove embedded image metadata; glTF metadata is retained.'
		);
	}
	const blocks: { offset: number; bytes: Uint8Array }[] = [];
	const hashes = new Map<string, { offset: number; bytes: Uint8Array }[]>();
	let length = 0;
	let duplicates = 0;
	for (const [index, view] of list(parsed.document, 'bufferViews').entries()) {
		const start = Number(view.byteOffset ?? 0);
		const bytes =
			replacements.get(index) ?? parsed.binary.subarray(start, start + Number(view.byteLength));
		const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
		const key = `${start % 4}:${bytes.length}:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
		const bucket = hashes.get(key) ?? [];
		const duplicate = bucket.find((block) => block.bytes.every((byte, i) => byte === bytes[i]));
		if (duplicate) {
			view.byteOffset = duplicate.offset;
			duplicates++;
		} else {
			// Preserve the original modulo-four alignment for every accessor and sparse range.
			length = Math.ceil(length / 4) * 4 + (start % 4);
			if (length + bytes.length > MAX_MODEL_BYTES) {
				throw new Error('Repacked binary data exceeds the 256 MiB safety limit.');
			}
			const block = { offset: length, bytes };
			blocks.push(block);
			bucket.push(block);
			hashes.set(key, bucket);
			view.byteOffset = length;
			length += bytes.length;
		}
		view.byteLength = bytes.length;
	}
	list(parsed.document, 'buffers')[0].byteLength = length;
	const json = new TextEncoder().encode(JSON.stringify(parsed.document));
	const jsonLength = Math.ceil(json.length / 4) * 4;
	const binaryLength = Math.ceil(length / 4) * 4;
	const total = 12 + 8 + jsonLength + 8 + binaryLength;
	if (total > MAX_MODEL_BYTES) throw new Error('Repacked model exceeds the 256 MiB safety limit.');
	const output = new Uint8Array(total);
	const header = new DataView(output.buffer);
	header.setUint32(0, 0x46546c67, true);
	header.setUint32(4, 2, true);
	header.setUint32(8, total, true);
	header.setUint32(12, jsonLength, true);
	header.setUint32(16, JSON_CHUNK, true);
	output.fill(0x20, 20, 20 + jsonLength);
	output.set(json, 20);
	header.setUint32(20 + jsonLength, binaryLength, true);
	header.setUint32(24 + jsonLength, BIN_CHUNK, true);
	for (const block of blocks) output.set(block.bytes, 28 + jsonLength + block.offset);
	let result = new File([output], file.name.replace(/\.glb$/i, '') + '-optimised.glb', {
		type: 'model/gltf-binary',
		lastModified: file.lastModified
	});
	if (result.size >= file.size) {
		result = file;
		changes.length = 0;
		changes.push('No smaller output was produced; the original file was retained unchanged.');
	} else {
		changes.unshift(
			`Compacted JSON and repacked embedded binary data; deduplicated ${duplicates} identical buffer view${duplicates === 1 ? '' : 's'}.`
		);
		if (options.mode === 'textures' && !replacements.size)
			changes.push(
				'No eligible colour JPEG was made smaller; PNG, normal and data textures were not changed.'
			);
	}
	const after = result === file ? before : await analyseDirect(result);
	if (!after.canOptimise)
		throw new Error('The generated GLB could not be validated; the original file is unchanged.');
	return { file: result, before, after, changes, savedBytes: file.size - result.size };
}

self.onmessage = async (event: MessageEvent<ModelWorkerJob>) => {
	try {
		const job = event.data;
		const result =
			job.action === 'analyse'
				? await analyseDirect(job.file)
				: await optimiseDirect(job.file, job.options);
		self.postMessage({ result });
	} catch (error) {
		self.postMessage({
			error: error instanceof Error ? error.message : 'Could not optimise the model.'
		});
	}
};
