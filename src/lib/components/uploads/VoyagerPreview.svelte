<script lang="ts">
	import { untrack } from 'svelte';
	import { pb } from '$lib/database/client';
	import type { RecordModel } from 'pocketbase';
	import VoyagerViewer from '$lib/components/voyager/VoyagerViewer.svelte';
	import { rewriteSceneJson, withSceneTitle, type FileMap } from '$lib/utils/svx-uri-rewriter';
	import { getEditionRoot, DEFAULT_VOYAGER_VERSION } from '$lib/utils/asset-urls';

	type Props = {
		edition: RecordModel;
		collectionPubNum?: number | null;
		editionPubNum?: number | null;
		title?: string;
		fileToken?: string;
		height?: string;
		/** Called when the user drops files on the viewer. Parent wires this to the uploader. */
		onFiles?: (files: File[]) => void;
	};
	let {
		edition,
		collectionPubNum,
		editionPubNum,
		title = 'Edition preview',
		fileToken,
		height,
		onFiles
	}: Props = $props();

	let dragActive = $state(false);

	let modelFilename = $derived((edition.modelFile as string | undefined) ?? '');
	let sceneFilename = $derived((edition.sceneDocument as string | undefined) ?? '');
	let privateFileToken = $state('');
	let tokenKey = '';
	const resolvedFileToken = $derived(fileToken || privateFileToken);
	$effect(() => {
		if (edition.isPublished || fileToken) return;
		const key = `${edition.id}:${modelFilename}:${sceneFilename}`;
		if (key === tokenKey && privateFileToken) return;
		let active = true;
		void untrack(() => pb.files.getToken())
			.then((token) => {
				if (active) {
					tokenKey = key;
					privateFileToken = token;
				}
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	});

	let previewDocument = $state<string>('');
	let previewRoot = $state<string>('');
	let previewModel = $state<string>('');
	let previewGeometry = $state<string>('');
	let previewOverrides = $state<Array<{ url: string; content: string; contentType?: string }>>([]);
	let previewCompanions = $state<
		{ baseDir: string; byBasename: Record<string, string> } | undefined
	>(undefined);
	let mode = $state<'scene' | 'model' | 'legacy' | 'empty'>('empty');
	let warnMissingModel = $state(false);
	let sceneFallbackError = $state(false);

	let runId = 0;
	let activeAbort: AbortController | null = null;

	$effect(() => {
		// Voyager intercepts fetch and reads its reactive props. Those reads must not
		// become dependencies of the effect that writes this preview's props.
		void edition.id;
		void edition.isPublished;
		void edition.modelAssets;
		void modelFilename;
		void sceneFilename;
		void resolvedFileToken;
		void collectionPubNum;
		void editionPubNum;
		// Title edits update the viewer label, not the loaded scene or camera.
		const myRun = ++runId;
		warnMissingModel = false;
		sceneFallbackError = false;
		activeAbort?.abort();
		activeAbort = new AbortController();
		const signal = activeAbort.signal;

		untrack(() => {
			void resolvePreview(myRun, signal);
		});

		return () => {
			activeAbort?.abort();
			activeAbort = null;
		};
	});

	async function resolvePreview(myRun: number, signal: AbortSignal) {
		if (myRun !== runId) return;
		if (!edition.isPublished && !resolvedFileToken && (modelFilename || sceneFilename)) return;
		previewCompanions = buildCompanions();

		if (sceneFilename) {
			await buildSceneOverride(myRun, signal);
			return;
		}
		if (collectionPubNum && editionPubNum) {
			previewModel = '';
			previewGeometry = '';
			previewOverrides = [];
			previewRoot = getEditionRoot(collectionPubNum, editionPubNum);
			previewDocument = 'scene.svx.json';
			mode = 'legacy';
			return;
		}
		if (modelFilename) {
			setModelDirect();
			return;
		}
		mode = 'empty';
	}

	function companionBaseDir(): string {
		const reference = modelFilename || sceneFilename;
		if (!reference) return '';
		const full = pb.files.getURL(edition, reference, { token: resolvedFileToken });
		const lastSlash = full.lastIndexOf('/');
		return lastSlash >= 0 ? full.slice(0, lastSlash + 1) : '';
	}

	// Strip the 10-char random suffix PocketBase appends before the extension so we can
	// match a requested basename (e.g. "logo.png") back to the stored file ("logo_abc1234567.png").
	function originalBasename(stored: string): string {
		let name = stored;
		let previous: string;
		do {
			previous = name;
			name = name.replace(/_[a-z0-9]{10}(\.[^.]+)$/i, '$1');
		} while (name !== previous);
		return name.toLowerCase();
	}

	function buildCompanions(): { baseDir: string; byBasename: Record<string, string> } | undefined {
		const assets = [
			modelFilename,
			sceneFilename,
			...(Array.isArray(edition.modelAssets) ? (edition.modelAssets as string[]) : [])
		].filter(Boolean);
		if (assets.length === 0) return undefined;
		const baseDir = companionBaseDir();
		if (!baseDir) return undefined;
		const byBasename: Record<string, string> = {};
		for (const stored of assets) {
			byBasename[originalBasename(stored)] = pb.files.getURL(edition, stored, {
				token: resolvedFileToken
			});
			byBasename[stored.toLowerCase()] = pb.files.getURL(edition, stored, {
				token: resolvedFileToken
			});
		}
		return { baseDir, byBasename };
	}

	function buildFileMap(): FileMap {
		const map: FileMap = {};
		const register = (stored: string) => {
			const url = pb.files.getURL(edition, stored, { token: resolvedFileToken });
			map[stored] = url;
			map[originalBasename(stored)] = url;
		};
		if (modelFilename) register(modelFilename);
		if (sceneFilename) register(sceneFilename);
		const assets = Array.isArray(edition.modelAssets) ? (edition.modelAssets as string[]) : [];
		for (const a of assets) register(a);
		return map;
	}

	async function buildSceneOverride(myRun: number, signal: AbortSignal) {
		try {
			const sceneUrl = pb.files.getURL(edition, sceneFilename, { token: resolvedFileToken });
			const resp = await fetch(sceneUrl, { signal });
			if (myRun !== runId) return;
			if (!resp.ok) throw new Error(`Scene fetch failed (${resp.status})`);
			const sceneJson = await resp.json();
			if (myRun !== runId) return;
			const rewritten = withSceneTitle(rewriteSceneJson(sceneJson, buildFileMap()), title);
			warnMissingModel = sceneReferencesMissingModel(rewritten);
			const lastSlash = sceneUrl.lastIndexOf('/');
			previewRoot = lastSlash >= 0 ? sceneUrl.slice(0, lastSlash + 1) : '';
			previewDocument = sceneFilename;
			previewModel = '';
			previewGeometry = '';
			previewOverrides = [
				{ url: sceneUrl, content: JSON.stringify(rewritten), contentType: 'application/json' },
				{
					url: pb.files.getURL(edition, sceneFilename),
					content: JSON.stringify(rewritten),
					contentType: 'application/json'
				}
			];
			mode = 'scene';
		} catch (err) {
			if (signal.aborted || myRun !== runId) return;
			console.warn('Scene document load failed, falling back to model:', err);
			warnMissingModel = false;
			sceneFallbackError = true;
			setModelDirect();
		}
	}

	function setModelDirect() {
		if (!modelFilename) {
			mode = 'empty';
			return;
		}
		const url = pb.files.getURL(edition, modelFilename, { token: resolvedFileToken });
		const lower = modelFilename.toLowerCase();
		const isGeometry = lower.endsWith('.obj') || lower.endsWith('.ply');
		if (isGeometry) {
			setGeometryWrapperScene(url);
		} else {
			previewModel = url;
			previewGeometry = '';
			previewRoot = '';
			previewDocument = '';
			previewOverrides = [];
		}
		mode = 'model';
	}

	function setGeometryWrapperScene(modelUrl: string) {
		const lastSlash = modelUrl.lastIndexOf('/');
		const baseDir = lastSlash >= 0 ? modelUrl.slice(0, lastSlash + 1) : '';
		const storedFilename = lastSlash >= 0 ? modelUrl.slice(lastSlash + 1) : modelUrl;
		const syntheticDocName = '__preview_scene.svx.json';
		const syntheticUrl = baseDir + syntheticDocName;

		const sceneJson = {
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
							assets: [{ uri: storedFilename, type: 'Geometry' }]
						}
					]
				}
			],
			setups: [{}],
			metas: [{ collection: { titles: { EN: title } } }]
		};

		previewModel = '';
		previewGeometry = '';
		previewRoot = baseDir;
		previewDocument = syntheticDocName;
		previewOverrides = [
			{ url: syntheticUrl, content: JSON.stringify(sceneJson), contentType: 'application/json' }
		];
	}

	async function onDrop(e: DragEvent) {
		e.preventDefault();
		dragActive = false;
		if (!onFiles) return;
		const files = await collectDroppedFiles(e.dataTransfer);
		if (files.length > 0) onFiles(files);
	}

	function onDragOver(e: DragEvent) {
		if (!onFiles) return;
		if (!e.dataTransfer?.types.includes('Files')) return;
		e.preventDefault();
		dragActive = true;
	}

	function onDragLeave() {
		dragActive = false;
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

	function sceneReferencesMissingModel(scene: unknown): boolean {
		if (modelFilename) return false;
		let found = false;
		const walk = (v: unknown) => {
			if (found) return;
			if (Array.isArray(v)) v.forEach(walk);
			else if (v && typeof v === 'object') {
				for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
					if (k === 'uri' && typeof val === 'string' && /\.(glb|gltf|obj|ply)(\?|$)/i.test(val)) {
						found = true;
						return;
					}
					walk(val);
				}
			}
		};
		walk(scene);
		return found;
	}
</script>

{#if mode === 'empty'}
	<div
		class="relative flex aspect-video items-center justify-center rounded-lg border-2 border-dashed bg-base-200 transition-colors {dragActive
			? 'border-primary bg-primary/5'
			: 'border-base-300'}"
		ondragover={onDragOver}
		ondragenter={onDragOver}
		ondragleave={onDragLeave}
		ondrop={onDrop}
		role="presentation"
	>
		<div class="text-center text-base-content/50">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				fill="none"
				viewBox="0 0 24 24"
				stroke-width="1.5"
				stroke="currentColor"
				class="mx-auto mb-2 size-10"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z"
				/>
			</svg>
			<p class="text-sm font-medium">3D Model Preview</p>
			{#if modelFilename}
				<p class="mt-1 text-xs">Model uploaded. Upload an SVX scene file to preview it.</p>
			{:else}
				<p class="mt-1 text-xs">Drop a GLB, GLTF, OBJ, or PLY here, or choose a file below</p>
			{/if}
		</div>
	</div>
{:else}
	<div class="space-y-2">
		{#if warnMissingModel}
			<div class="alert alert-warning">
				<span class="text-xs">Scene references a missing model</span>
			</div>
		{/if}
		{#if sceneFallbackError}
			<div class="alert alert-warning">
				<span class="text-xs">Scene document failed to load — showing model only.</span>
			</div>
		{/if}
		<div
			class="card relative overflow-hidden bg-base-200 {height ? '' : 'shadow-xl'} transition-all {dragActive
				? 'ring-2 ring-primary ring-offset-2 ring-offset-base-100'
				: ''}"
			ondragover={onDragOver}
			ondragenter={onDragOver}
			ondragleave={onDragLeave}
			ondrop={onDrop}
			role="presentation"
		>
			<div class="card-body p-0">
				{#key `${mode}:${previewDocument}:${previewModel}:${previewGeometry}`}
					<VoyagerViewer
						url={previewRoot}
						document={previewDocument}
						model={previewModel}
						geometry={previewGeometry}
						fetchOverrides={previewOverrides}
						companionAssets={previewCompanions}
						{title}
						{height}
						direct={true}
						uiMode={edition.isSandbox ? 'menu|language' : 'menu|title|language'}
						showVoyagerMenu={true}
						voyagerVersion={DEFAULT_VOYAGER_VERSION}
					/>
				{/key}
			</div>
			{#if dragActive}
				<div
					class="pointer-events-none absolute inset-0 flex items-center justify-center bg-primary/20"
				>
					<span class="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-content">
						Drop to replace
					</span>
				</div>
			{/if}
		</div>
	</div>
{/if}
