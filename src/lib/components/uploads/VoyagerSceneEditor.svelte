<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { base } from '$app/paths';
	import type { RecordModel } from 'pocketbase';
	import { pb } from '$lib/database/client';
	import {
		getVoyagerResourceRoot,
		DEFAULT_VOYAGER_VERSION,
		getEditionRoot
	} from '$lib/utils/asset-urls';
	let {
		edition,
		collectionPubNum,
		editionPubNum,
		title,
		disabled = false,
		onupdated,
		onbusychange
	}: {
		edition: RecordModel;
		collectionPubNum?: number | null;
		editionPubNum?: number | null;
		title: string;
		disabled?: boolean;
		onupdated: (record: RecordModel) => void;
		onbusychange: (busy: boolean) => void;
	} = $props();
	let modal: HTMLDialogElement;
	let frame = $state<HTMLIFrameElement>();
	let src = $state('');
	let ready = $state(false);
	let dirty = $state(false);
	let saving = $state(false);
	let error = $state('');
	let session = '';
	let config: Record<string, unknown>;
	type SceneExport = {
		document: object;
		files: { path: string; original: string | null; file: File }[];
	};
	let expectedFiles: { sceneDocument: string; modelFile: string; modelAssets: string[] };
	let pending:
		| { resolve: (value: SceneExport) => void; reject: (error: Error) => void }
		| undefined;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	function originalFilename(filename: string) {
		let name = filename;
		let previous: string;
		do {
			previous = name;
			name = name.replace(/_[a-z0-9]{10}(\.[^.]+)$/i, '$1');
		} while (name !== previous);
		return name;
	}
	beforeNavigate((navigation) => {
		if ((dirty || saving) && !confirm('Leave with unsaved Voyager scene changes?'))
			navigation.cancel();
	});
	onMount(() => {
		const receive = (event: MessageEvent) => {
			if (
				event.origin !== location.origin ||
				event.source !== frame?.contentWindow ||
				event.data?.session !== session
			)
				return;
			if (event.data.type === 'ready') ready = true;
			if (event.data.type === 'dirty') dirty = true;
			if (event.data.type === 'save-request') void save();
			if (event.data.type === 'error') {
				error = event.data.message || 'Scene editor failed.';
				clearTimeout(timeout);
				pending?.reject(new Error(error));
				pending = undefined;
			}
			if (event.data.type === 'document' && pending) {
				clearTimeout(timeout);
				pending.resolve({ document: event.data.document, files: event.data.files || [] });
				pending = undefined;
			}
		};
		const unload = (event: BeforeUnloadEvent) => {
			if (dirty || saving) {
				event.preventDefault();
				event.returnValue = '';
			}
		};
		window.addEventListener('message', receive);
		window.addEventListener('beforeunload', unload);
		return () => {
			clearTimeout(timeout);
			window.removeEventListener('message', receive);
			window.removeEventListener('beforeunload', unload);
		};
	});
	async function open() {
		if (disabled) return;
		onbusychange(true);
		error = '';
		ready = false;
		dirty = false;
		try {
			const capability = await pb
				.send<{ protocol: string }>('/api/pure3d/voyager/save-capability', {
					method: 'GET'
				})
				.catch(() => null);
			if (capability?.protocol !== 'scene-and-assets-v1')
				throw new Error(
					'The backend Voyager saving update must be installed before scene editing is available.'
				);
			const current = await pb.collection('editions').getOne(edition.id);
			expectedFiles = {
				sceneDocument: current.sceneDocument || '',
				modelFile: current.modelFile || '',
				modelAssets: current.modelAssets || []
			};
			const token = current.isPublished ? '' : await pb.files.getToken();
			const files = [
				current.modelFile,
				current.sceneDocument,
				...(current.modelAssets || [])
			].filter(Boolean) as string[];
			const assets: Record<string, string> = {};
			for (const filename of files) {
				const url = pb.files.getURL(current, filename, { token });
				assets[filename] = url;
				assets[originalFilename(filename)] = url;
			}
			const root = files.length
				? pb.files
						.getURL(current, files[0])
						.slice(0, pb.files.getURL(current, files[0]).lastIndexOf('/') + 1)
				: collectionPubNum && editionPubNum
					? getEditionRoot(collectionPubNum, editionPubNum)
					: '';
			config = {
				root,
				// Legacy editions may reference runtimes that are no longer bundled.
				resourceRoot: getVoyagerResourceRoot(DEFAULT_VOYAGER_VERSION),
				document: current.sceneDocument
					? assets[current.sceneDocument]
					: root && !current.modelFile
						? current.settingsSceneFile || 'scene.svx.json'
						: '',
				model: current.modelFile ? assets[current.modelFile] : '',
				title,
				assets,
				companionFiles: expectedFiles.modelAssets
			};
			session = crypto.randomUUID();
			src = `${base}/voyager/alpha-story.html?session=${session}`;
			await tick();
			modal.showModal();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not open the scene editor.';
			onbusychange(false);
		}
	}
	function close() {
		if (saving || (dirty && !confirm('Discard unsaved scene changes?'))) return;
		modal.close();
		src = '';
		dirty = false;
		onbusychange(false);
	}
	function persistentScene(document: object): object {
		const root = String(config.root || '');
		return JSON.parse(
			JSON.stringify(document, (key, value) => {
				if (typeof value === 'string' && root && value.startsWith(root)) {
					const url = new URL(value);
					url.searchParams.delete('token');
					for (const [name, value] of [...url.searchParams])
						if (/^\d+$/.test(name) && !value) url.searchParams.delete(name);
					return (
						decodeURIComponent(url.pathname.slice(new URL(root).pathname.length)) +
						url.search +
						url.hash
					);
				}
				return value;
			})
		);
	}
	async function save() {
		if (!ready || saving) return;
		saving = true;
		error = '';
		try {
			const { document, files } = await new Promise<SceneExport>((resolve, reject) => {
				pending = { resolve, reject };
				timeout = setTimeout(() => {
					pending = undefined;
					reject(new Error('Voyager did not return the scene. Your work is still open.'));
				}, 15000);
				frame?.contentWindow?.postMessage({ type: 'export', session }, location.origin);
			});
			if (
				!document ||
				typeof document !== 'object' ||
				!('asset' in document) ||
				!('scenes' in document)
			)
				throw new Error('Voyager returned an invalid scene.');
			if (
				!Array.isArray(files) ||
				files.length > 100 ||
				files.some((item) => !(item.file instanceof File))
			)
				throw new Error('Voyager returned invalid article or media files.');
			const form = new FormData();
			form.append(
				'voyagerSave',
				JSON.stringify({
					expectedFiles,
					assets: files.map(({ path, original }) => ({ path, original }))
				})
			);
			for (const item of files) form.append('modelAssets+', item.file);
			form.append(
				'sceneDocument',
				new File([JSON.stringify(persistentScene(document))], 'scene.svx.json', {
					type: 'application/json'
				})
			);
			const record = await pb.collection('editions').update(edition.id, form);
			onupdated(record);
			dirty = false;
			modal.close();
			src = '';
			onbusychange(false);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not save. Your scene is still open.';
		} finally {
			saving = false;
		}
	}
</script>

<div id="voyager-scene-editor" class="space-y-2">
	<button type="button" class="btn btn-accent" {disabled} onclick={open}>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			class="size-5"
			aria-hidden="true"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 9 9-4M12 12 3 8m9 4v9"
			/>
		</svg>
		{edition.sceneDocument || edition.settingsSceneFile
			? 'Edit scene in Voyager Story'
			: 'Create Voyager scene'}</button
	>
	{#if error && !src}<p role="alert" class="text-sm text-error">{error}</p>{/if}
	<dialog
		bind:this={modal}
		class="modal"
		aria-labelledby="voyager-scene-editor-title"
		oncancel={(event) => {
			event.preventDefault();
			close();
		}}
	>
		<div class="modal-box flex h-[90dvh] w-[96vw] max-w-none flex-col p-3">
			<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
				<h2 id="voyager-scene-editor-title" class="font-semibold">
					Voyager Story · {title}
				</h2>
				<div class="flex gap-2">
					<button type="button" class="btn btn-outline btn-sm" disabled={saving} onclick={close}
						>Close</button
					><button
						type="button"
						class="btn btn-sm btn-primary"
						disabled={!ready || saving}
						onclick={save}>{saving ? 'Saving scene…' : 'Save scene & close'}</button
					>
				</div>
			</div>
			<p class="mb-2 text-sm text-base-content/70">
				Article and media changes are kept in this editor until you choose Save scene &amp; close.
			</p>
			{#if error}<p role="alert" class="mb-2 rounded-box bg-error/10 p-2 text-sm text-base-content">
					{error}
				</p>{/if}{#if src}<iframe
					bind:this={frame}
					{src}
					title="Voyager Story scene editor"
					class="min-h-0 w-full flex-1 border-0"
					allow="fullscreen"
					onload={() =>
						frame?.contentWindow?.postMessage(
							{ type: 'init', session, ...config },
							location.origin
						)}
				></iframe>{/if}
		</div>
	</dialog>
</div>
