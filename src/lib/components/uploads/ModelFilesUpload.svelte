<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { pb } from '$lib/database/client';
	import type { RecordModel } from 'pocketbase';
	import toast from 'svelte-french-toast';
	import { addNormalsToPlyFile } from '$lib/utils/ply-normals';
	import { untrack } from 'svelte';
	import { fetchFileSize } from '$lib/utils/file-size';

	type Props = {
		record: RecordModel;
		disabled?: boolean;
		onuploaded?: (r: RecordModel) => void;
		onremoved?: (r: RecordModel) => void;
		onbusychange?: (busy: boolean) => void;
	};
	let {
		record = $bindable(),
		disabled = false,
		onuploaded,
		onremoved,
		onbusychange
	}: Props = $props();

	const MAIN_EXTS = ['.glb', '.gltf', '.obj', '.ply'];
	const SCENE_EXTS = ['.svx.json', '.svx'];
	const MAX_FILE_SIZE = 500 * 1024 * 1024;
	const ACCEPT =
		'.glb,.gltf,.obj,.ply,.bin,.mtl,.png,.jpg,.jpeg,.webp,.ktx2,.basis,.hdr,.exr,.svx,.svx.json,.json';

	let modelFilename = $derived((record.modelFile as string | undefined) ?? '');
	let assetFilenames = $derived(
		Array.isArray(record.modelAssets) ? (record.modelAssets as string[]) : []
	);
	let isObj = $derived(modelFilename.toLowerCase().endsWith('.obj'));
	let fileSizes = $state<Record<string, number | null>>({});

	$effect(() => {
		const currentRecord = record;
		const filenames = [modelFilename, ...assetFilenames].filter(Boolean);
		const controller = new AbortController();
		fileSizes = {};
		if (filenames.length === 0) return;
		void untrack(async () => {
			try {
				const token = currentRecord.isPublished ? '' : await pb.files.getToken();
				if (controller.signal.aborted) return;
				await Promise.all(
					filenames.map(async (filename) => {
						const size = await fetchFileSize(
							pb.files.getURL(currentRecord, filename, { token }),
							controller.signal
						);
						if (!controller.signal.aborted) fileSizes[filename] = size;
					})
				);
			} catch {
				// File metadata must not prevent editing the edition.
			}
		});
		return () => controller.abort();
	});

	let uploading = $state(false);
	$effect(() => {
		onbusychange?.(uploading);
	});
	let progress = $state(0);
	let errorMsg = $state('');
	let dragActive = $state(false);
	let inputEl: HTMLInputElement | undefined = $state();

	function humanSize(n: number): string {
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
		if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
		return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
	}

	function isMainFile(name: string): boolean {
		const lower = name.toLowerCase();
		return MAIN_EXTS.some((ext) => lower.endsWith(ext));
	}

	function basename(path: string): string {
		const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
		return slash === -1 ? path : path.slice(slash + 1);
	}

	type PickedFiles = { main: File; scene: File | null; companions: File[] };

	function isSceneFile(name: string): boolean {
		const lower = name.toLowerCase();
		return SCENE_EXTS.some((ext) => lower.endsWith(ext));
	}

	async function splitFiles(files: File[]): Promise<PickedFiles | string> {
		const mains = files.filter((f) => isMainFile(f.name));
		if (mains.length === 0) {
			return `No main model file found. Supported: ${MAIN_EXTS.join(', ')}`;
		}
		if (mains.length > 1) {
			return `Multiple main files picked (${mains.map((f) => f.name).join(', ')}). Drop only one.`;
		}
		const main = mains[0];

		const scenes = files.filter((f) => f !== main && isSceneFile(f.name));
		if (scenes.length > 1) {
			return `Multiple scene files picked (${scenes.map((f) => f.name).join(', ')}). Drop only one.`;
		}
		const scene = scenes[0] ?? null;

		const companions = files.filter((f) => f !== main && f !== scene);

		for (const f of files) {
			if (f.size > MAX_FILE_SIZE) {
				return `"${f.name}" is ${humanSize(f.size)}, max per file is ${humanSize(MAX_FILE_SIZE)}`;
			}
		}

		const seen = new SvelteSet<string>();
		for (const f of companions) {
			const key = basename(f.name).toLowerCase();
			if (seen.has(key)) {
				return `Duplicate companion filename "${basename(f.name)}". Use unique names across subdirectories.`;
			}
			seen.add(key);
		}

		const missing = await findMissingCompanions(main, companions);
		if (missing.length > 0) {
			const shown = missing.slice(0, 5).join(', ');
			const more = missing.length > 5 ? `, +${missing.length - 5} more` : '';
			return `${main.name} references missing files: ${shown}${more}. Drop all of them together.`;
		}

		return { main, scene, companions };
	}

	async function findMissingCompanions(main: File, companions: File[]): Promise<string[]> {
		const companionNames = new Set(companions.map((f) => basename(f.name).toLowerCase()));
		const refs = await extractExternalRefs(main);
		const missing: string[] = [];
		for (const ref of refs) {
			if (!companionNames.has(basename(ref).toLowerCase())) missing.push(ref);
		}
		return missing;
	}

	async function extractExternalRefs(main: File): Promise<string[]> {
		const lower = main.name.toLowerCase();
		if (lower.endsWith('.gltf')) return extractGltfRefs(main);
		if (lower.endsWith('.obj')) return extractObjRefs(main);
		return [];
	}

	async function extractGltfRefs(file: File): Promise<string[]> {
		try {
			const json = JSON.parse(await file.text()) as {
				buffers?: Array<{ uri?: string }>;
				images?: Array<{ uri?: string }>;
			};
			const refs: string[] = [];
			for (const list of [json.buffers, json.images]) {
				for (const item of list ?? []) {
					if (typeof item?.uri === 'string' && !item.uri.startsWith('data:')) {
						refs.push(item.uri);
					}
				}
			}
			return refs;
		} catch {
			return [];
		}
	}

	async function extractObjRefs(file: File): Promise<string[]> {
		try {
			const text = await file.text();
			const refs: string[] = [];
			for (const line of text.split(/\r?\n/)) {
				const m = line.match(/^\s*mtllib\s+(.+?)\s*$/i);
				if (m) refs.push(m[1]);
			}
			return refs;
		} catch {
			return [];
		}
	}

	export async function uploadFiles(files: File[]): Promise<void> {
		await upload(files);
	}

	async function upload(files: File[]) {
		if (disabled || uploading) return;
		uploading = true;
		errorMsg = '';
		progress = 0;

		try {
			const split = await splitFiles(files);
			if (typeof split === 'string') throw new Error(split);
			let { main } = split;
			const { scene, companions } = split;
			if (main.name.toLowerCase().endsWith('.ply')) {
				main = await addNormalsToPlyFile(main);
			}

			const form = new FormData();
			form.append('modelFile', main);
			if (scene) form.append('sceneDocument', scene);
			for (const existing of assetFilenames) form.append('modelAssets-', existing);
			for (const f of companions) form.append('modelAssets+', f);

			const updated = await patchWithProgress(form);
			record = updated;
			onuploaded?.(updated);
		} catch (err) {
			const msg = (err as Error).message || 'Upload failed';
			errorMsg = msg;
			toast.error(msg);
		} finally {
			uploading = false;
			progress = 0;
		}
	}

	function patchWithProgress(form: FormData): Promise<RecordModel> {
		return new Promise((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			const url = `${pb.baseUrl}/api/collections/editions/records/${record.id}`;
			xhr.open('PATCH', url);
			const token = pb.authStore.token;
			if (token) xhr.setRequestHeader('Authorization', token);

			xhr.upload.onprogress = (e) => {
				if (e.lengthComputable) progress = Math.round((e.loaded / e.total) * 100);
			};

			xhr.onload = async () => {
				if (xhr.status >= 200 && xhr.status < 300) {
					try {
						const fresh = await pb.collection('editions').getOne(record.id);
						resolve(fresh);
					} catch (err) {
						reject(err);
					}
				} else {
					let msg = `Upload failed (${xhr.status})`;
					try {
						const body = JSON.parse(xhr.responseText);
						msg = body?.message || msg;
					} catch {
						/* noop */
					}
					reject(new Error(msg));
				}
			};
			xhr.onerror = () => reject(new Error('Network error'));
			xhr.send(form);
		});
	}

	async function removeAll() {
		if (disabled || uploading || (!modelFilename && assetFilenames.length === 0)) return;
		uploading = true;
		try {
			const patch: Record<string, unknown> = {};
			if (modelFilename) patch.modelFile = null;
			if (assetFilenames.length > 0) patch.modelAssets = null;
			const updated = await pb.collection('editions').update(record.id, patch);
			record = updated;
			onremoved?.(updated);
		} catch (err) {
			console.error('Remove failed:', err);
			toast.error((err as Error).message || 'Failed to remove files');
		} finally {
			uploading = false;
		}
	}

	async function removeCompanion(filename: string) {
		if (disabled || uploading) return;
		uploading = true;
		try {
			const updated = await pb.collection('editions').update(record.id, {
				'modelAssets-': [filename]
			});
			record = updated;
			onremoved?.(updated);
		} catch (err) {
			console.error('Remove companion failed:', err);
			toast.error((err as Error).message || 'Failed to remove asset');
		} finally {
			uploading = false;
		}
	}

	function onPick(e: Event) {
		const target = e.target as HTMLInputElement;
		const files = Array.from(target.files ?? []);
		target.value = '';
		if (files.length > 0) void upload(files);
	}

	async function onDrop(e: DragEvent) {
		e.preventDefault();
		dragActive = false;
		if (disabled || uploading) return;
		const files = await collectDroppedFiles(e.dataTransfer);
		if (files.length > 0) void upload(files);
	}

	async function collectDroppedFiles(dt: DataTransfer | null): Promise<File[]> {
		if (!dt) return [];
		const entries: FileSystemEntry[] = [];
		if (dt.items && dt.items.length > 0) {
			for (let i = 0; i < dt.items.length; i++) {
				const entry = (
					dt.items[i] as DataTransferItem & {
						webkitGetAsEntry?: () => FileSystemEntry | null;
					}
				).webkitGetAsEntry?.();
				if (entry) entries.push(entry);
			}
		}
		if (entries.length === 0) return Array.from(dt.files ?? []);

		const out: File[] = [];
		for (const entry of entries) await walkEntry(entry, out);
		return out;
	}

	async function walkEntry(entry: FileSystemEntry, acc: File[]): Promise<void> {
		if (entry.isFile) {
			const file = await new Promise<File>((resolve, reject) =>
				(entry as FileSystemFileEntry).file(resolve, reject)
			);
			acc.push(file);
			return;
		}
		if (entry.isDirectory) {
			const reader = (entry as FileSystemDirectoryEntry).createReader();
			const children = await readAllEntries(reader);
			for (const child of children) await walkEntry(child, acc);
		}
	}

	function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
		return new Promise((resolve, reject) => {
			const all: FileSystemEntry[] = [];
			const pump = () => {
				reader.readEntries((batch) => {
					if (batch.length === 0) resolve(all);
					else {
						all.push(...batch);
						pump();
					}
				}, reject);
			};
			pump();
		});
	}

	function onDragOver(e: DragEvent) {
		e.preventDefault();
		if (disabled || uploading) return;
		dragActive = true;
	}

	function onDragLeave() {
		dragActive = false;
	}
</script>

<div
	id="model-files-upload"
	class="space-y-3 rounded-lg transition-all {dragActive
		? 'ring-2 ring-primary ring-offset-2 ring-offset-base-100'
		: ''}"
	ondragover={onDragOver}
	ondragenter={onDragOver}
	ondragleave={onDragLeave}
	ondrop={onDrop}
	role="presentation"
>
	<input
		bind:this={inputEl}
		type="file"
		accept={ACCEPT}
		multiple
		class="hidden"
		{disabled}
		onchange={onPick}
	/>

	{#if uploading}
		<div class="rounded-lg border border-base-300 bg-base-200 p-3">
			<div class="mb-1 text-xs text-base-content/60">Uploading…</div>
			<progress class="progress w-full progress-primary" value={progress} max="100"></progress>
			<div class="mt-1 text-xs text-base-content/40">{progress}%</div>
		</div>
	{:else if modelFilename}
		<div class="rounded-lg border border-base-300 bg-base-200 p-3">
			<div class="mb-2 flex items-center justify-between gap-2">
				<div class="min-w-0 flex-1">
					<div class="truncate text-sm font-medium" title={modelFilename}>{modelFilename}</div>
					<div class="text-xs text-base-content/50">
						Main model{assetFilenames.length > 0
							? ` + ${assetFilenames.length} companion${assetFilenames.length === 1 ? '' : 's'}`
							: ''}
						{#if fileSizes[modelFilename] != null}
							 · {humanSize(fileSizes[modelFilename]!)}
						{:else}
							 · Size unavailable
						{/if}
					</div>
				</div>
				<div class="flex shrink-0 gap-2">
					<button
						type="button"
						class="btn btn-outline btn-xs"
						onclick={() => inputEl?.click()}
						{disabled}>Replace</button
					>
					<button type="button" class="btn btn-ghost btn-xs" onclick={removeAll} {disabled}
						>Remove</button
					>
				</div>
			</div>

			{#if assetFilenames.length > 0}
				<ul
					class="mt-2 max-h-40 space-y-1 overflow-y-auto rounded border border-base-300 bg-base-100 p-2"
				>
					{#each assetFilenames as filename (filename)}
						<li class="flex items-center justify-between gap-2">
							<span class="truncate text-xs" title={filename}>{filename}</span>
							<span class="shrink-0 text-xs text-base-content/50">
								{fileSizes[filename] != null ? humanSize(fileSizes[filename]!) : 'Size unavailable'}
							</span>
							<button
								type="button"
								class="btn btn-ghost btn-xs"
								onclick={() => removeCompanion(filename)}
								{disabled}
								aria-label="Remove {filename}">×</button
							>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		{#if isObj}
			<div class="alert alert-warning">
				<div class="text-xs">
					<p class="font-semibold">OBJ has limited support in the viewer</p>
					<ul class="mt-1 ml-4 list-disc space-y-0.5">
						<li>Textures referenced by <code>.mtl</code> are not applied</li>
						<li>Mesh groups with transparent or texture-only materials may appear missing</li>
					</ul>
					<p class="mt-2">
						Export your model as <strong>GLB</strong> for full fidelity — Blender:
						<em>File → Export → glTF 2.0 (.glb/.gltf)</em>
						with format set to <em>glTF Binary</em>. Single file, embedded textures, proper
						lighting.
					</p>
				</div>
			</div>
		{/if}
	{:else}
		<div class="rounded-lg border border-dashed border-base-300 bg-base-200 p-3">
			<p class="text-xs text-base-content/60">
				No model file. Drop a GLB, GLTF, OBJ, or PLY file with any companion files here.
			</p>
			<button
				type="button"
				class="btn mt-3 w-full btn-outline btn-sm"
				onclick={() => inputEl?.click()}
				{disabled}
			>
				Choose files
			</button>
		</div>
	{/if}

	{#if dragActive}
		<div
			class="pointer-events-none rounded-lg bg-primary/10 p-2 text-center text-xs font-medium text-primary"
		>
			Drop to upload
		</div>
	{/if}

	{#if errorMsg}
		<div class="alert-sm alert alert-error">
			<span class="text-xs">{errorMsg}</span>
		</div>
	{/if}
</div>
