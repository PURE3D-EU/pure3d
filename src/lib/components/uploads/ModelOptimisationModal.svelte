<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { base } from '$app/paths';
	import type { RecordModel } from 'pocketbase';
	import { pb } from '$lib/database/client';
	import VoyagerViewer from '$lib/components/voyager/VoyagerViewer.svelte';
	import type { ModelAnalysis, ModelOptimisationResult } from '$lib/utils/model-optimisation';

	let {
		edition,
		disabled = false,
		onupdated,
		onbusychange
	}: {
		edition: RecordModel;
		disabled?: boolean;
		onupdated: (record: RecordModel) => void;
		onbusychange: (busy: boolean) => void;
	} = $props();

	let modal: HTMLDialogElement;
	let opened = $state(false);
	let busy = $state('');
	let saving = $state(false);
	let error = $state('');
	let message = $state('');
	let analysis = $state<ModelAnalysis | null>(null);
	let result = $state<ModelOptimisationResult | null>(null);
	let mode = $state<'lossless' | 'textures'>('lossless');
	let textureQuality = $state(85);
	let maxTextureSize = $state(4096);
	let capable = $state(false);
	let canRestore = $state(false);
	let reviewed = $state(false);
	let preview = $state<'original' | 'copy'>('copy');
	let originalLoaded = $state(false);
	let copyLoaded = $state(false);
	let copyUrl = $state('');
	let previewRoot = $state('');
	let previewFile = $state('');
	let previewSource = $state('');
	let source = $state<File | null>(null);
	let snapshot: RecordModel;
	let controller: AbortController | null = null;
	const MAX_BYTES = 256 * 1024 * 1024;
	beforeNavigate((navigation) => {
		if (saving) navigation.cancel();
	});
	onMount(() => {
		const unload = (event: BeforeUnloadEvent) => {
			if (!saving) return;
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener('beforeunload', unload);
		return () => window.removeEventListener('beforeunload', unload);
	});

	function size(bytes: number) {
		return (
			new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(bytes / 1048576) + ' MB'
		);
	}
	function count(value: number) {
		return new Intl.NumberFormat('en-GB').format(value);
	}
	async function readFile(url: string, limit: number, signal: AbortSignal): Promise<Blob> {
		const response = await fetch(url, { signal, cache: 'no-store' });
		if (!response.ok) throw new Error(`Could not download the model (${response.status}).`);
		if (Number(response.headers.get('content-length')) > limit)
			throw new Error(`This file exceeds the ${size(limit)} browser processing limit.`);
		if (!response.body) throw new Error('Your browser could not read this file.');
		const reader = response.body.getReader();
		const chunks: Uint8Array<ArrayBuffer>[] = [];
		let bytes = 0;
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				bytes += value.byteLength;
				if (bytes > limit)
					throw new Error(`This file exceeds the ${size(limit)} browser processing limit.`);
				chunks.push(value as Uint8Array<ArrayBuffer>);
			}
		} finally {
			await reader.cancel();
			reader.releaseLock();
		}
		return new Blob(chunks);
	}

	async function open() {
		if (disabled || opened) return;
		opened = true;
		onbusychange(true);
		busy = 'Downloading and checking the source model…';
		error = '';
		message = '';
		analysis = null;
		result = null;
		mode = 'lossless';
		capable = false;
		canRestore = false;
		const request = new AbortController();
		controller = request;
		await tick();
		modal.showModal();
		previewRoot = `${location.origin}${base}/__model-preview/${crypto.randomUUID()}/`;
		previewSource = previewRoot + 'original.glb';
		try {
			const current = await pb
				.collection('editions')
				.getOne(edition.id, { signal: request.signal });
			if (request.signal.aborted) return;
			snapshot = current;
			const filename = String(snapshot.modelFile || '');
			const capability = await pb
				.send<{ protocol: string }>('/api/pure3d/model-optimisation/capability', {
					method: 'GET',
					signal: request.signal
				})
				.catch(() => null);
			if (request.signal.aborted) return;
			capable = capability?.protocol === 'viewing-copy-v1';
			const token = snapshot.isPublished ? '' : await pb.files.getToken();
			if (request.signal.aborted) return;
			if (snapshot.sceneDocument) {
				try {
					const blob = await readFile(
						pb.files.getURL(snapshot, snapshot.sceneDocument, { token }),
						5 * 1048576,
						request.signal
					);
					const scene = JSON.parse(await blob.text());
					if (request.signal.aborted) return;
					const history = scene?.asset?.extras?.pure3dViewingCopy;
					canRestore =
						history?.sourceModel === filename && typeof history?.previousScene === 'string';
				} catch {
					// A scene may remain editable even when a source model cannot be analysed.
				}
			}
			if (!filename)
				throw new Error(
					'Upload a self-contained GLB model first. Legacy scene-only editions are not supported by this tool.'
				);
			if (!filename.toLowerCase().endsWith('.glb'))
				throw new Error(
					'Optimisation currently supports self-contained GLB models. GLTF, OBJ and PLY files are not changed.'
				);
			const blob = await readFile(
				pb.files.getURL(snapshot, filename, { token }),
				MAX_BYTES,
				request.signal
			);
			if (request.signal.aborted) return;
			source = new File([blob], filename, { type: 'model/gltf-binary' });
			const engine = await import('$lib/utils/model-optimisation');
			if (request.signal.aborted) return;
			const report = await engine.analyseModel(source, request.signal);
			if (!request.signal.aborted) analysis = report;
		} catch (cause) {
			if (!request.signal.aborted)
				error = cause instanceof Error ? cause.message : 'Could not analyse the model.';
		} finally {
			if (controller === request) busy = '';
		}
	}
	function clearCopy() {
		if (copyUrl) URL.revokeObjectURL(copyUrl);
		copyUrl = '';
		previewFile = '';
		result = null;
		reviewed = false;
		copyLoaded = false;
		originalLoaded = false;
	}
	function close() {
		if (saving) return;
		controller?.abort();
		controller = null;
		clearCopy();
		source = null;
		busy = '';
		opened = false;
		modal.close();
		onbusychange(false);
	}
	onDestroy(() => {
		controller?.abort();
		if (copyUrl) URL.revokeObjectURL(copyUrl);
	});
	async function optimise() {
		if (!source || busy || !analysis?.canOptimise) return;
		clearCopy();
		error = '';
		message = '';
		busy = 'Creating and checking the viewing copy…';
		const request = new AbortController();
		controller = request;
		try {
			const engine = await import('$lib/utils/model-optimisation');
			if (request.signal.aborted) return;
			const output = await engine.optimiseModel(
				source,
				{ mode, textureQuality: textureQuality / 100, maxTextureSize },
				request.signal
			);
			if (request.signal.aborted) return;
			result = output;
			copyUrl = URL.createObjectURL(output.file);
			previewFile = previewRoot + 'optimised.glb';
			preview = 'copy';
		} catch (cause) {
			if (!request.signal.aborted)
				error = cause instanceof Error ? cause.message : 'Could not optimise the model.';
		} finally {
			if (controller === request) busy = '';
		}
	}
	async function save(action: 'apply' | 'restore') {
		if (
			saving ||
			busy ||
			!capable ||
			(action === 'apply' && (!result || !reviewed || !copyLoaded || !originalLoaded))
		)
			return;
		saving = true;
		error = '';
		try {
			const capability = await pb.send<{ protocol: string }>(
				'/api/pure3d/model-optimisation/capability',
				{ method: 'GET' }
			);
			if (capability?.protocol !== 'viewing-copy-v1') {
				capable = false;
				throw new Error(
					'The model optimisation backend is unavailable. Your preview can still be downloaded.'
				);
			}
			const form = new FormData();
			form.append(
				'modelOptimisation',
				JSON.stringify({
					action,
					expectedFiles: {
						modelFile: snapshot.modelFile || '',
						sceneDocument: snapshot.sceneDocument || '',
						modelAssets: snapshot.modelAssets || []
					}
				})
			);
			if (action === 'apply' && result) form.append('modelAssets+', result.file);
			const updated = await pb.collection('editions').update(edition.id, form);
			onupdated(updated);
			if (
				updated.modelFile !== snapshot.modelFile ||
				(updated.sceneDocument || '') === (snapshot.sceneDocument || '') ||
				(snapshot.modelAssets || []).some(
					(filename: string) => !updated.modelAssets?.includes(filename)
				)
			) {
				throw new Error(
					'The backend did not confirm the viewing-version change. Reload the edition before retrying.'
				);
			}
			snapshot = updated;
			canRestore = action === 'apply';
			message =
				action === 'apply'
					? 'Viewing copy applied. Your original model is unchanged.'
					: 'Previous viewing version restored. All model files have been retained.';
			clearCopy();
		} catch (cause) {
			error =
				cause instanceof Error
					? cause.message
					: 'Could not save the viewing copy. Your existing edition is unchanged.';
		} finally {
			saving = false;
		}
	}
</script>

<div id="model-optimisation-modal">
	<button type="button" class="btn btn-outline" {disabled} onclick={open}
		>Check &amp; optimise model</button
	>
	<dialog
		bind:this={modal}
		class="modal"
		aria-labelledby="model-optimisation-title"
		oncancel={(event) => {
			event.preventDefault();
			close();
		}}
	>
		<div class="modal-box w-[calc(100vw-1rem)] max-w-3xl p-0">
			<header class="flex items-start justify-between gap-4 px-5 pt-5">
				<div>
					<p class="mb-2 text-xs tracking-widest text-base-content/60 uppercase">Model tools</p>
					<h2 id="model-optimisation-title" class="font-serif text-3xl">Check &amp; optimise</h2>
					<p class="mt-2 text-sm text-base-content/70">
						A lighter viewing copy. Your original stays intact.
					</p>
				</div>
				<button
					type="button"
					class="btn btn-ghost btn-sm"
					disabled={saving}
					aria-label="Close model tools"
					onclick={close}>✕</button
				>
			</header>
			<div class="space-y-4 p-5" aria-busy={!!busy || saving}>
				{#if busy}
					<div role="status" class="space-y-3">
						<p class="text-sm">{busy}</p>
						<div class="h-4 w-3/4 skeleton motion-reduce:animate-none"></div>
						<div class="h-16 w-full skeleton motion-reduce:animate-none"></div>
						<p class="text-xs text-base-content/60">
							Processed on your device. Close to cancel; no files are changed.
						</p>
					</div>
				{/if}
				{#if error}<p class="alert text-sm alert-error" role="alert">{error}</p>{/if}
				{#if message}<p class="alert text-sm alert-success" role="status">{message}</p>{/if}
				{#if analysis && !busy}
					<div class="rounded-lg bg-base-200 p-3">
						<p class="truncate text-sm font-semibold" title={source?.name}>{source?.name}</p>
						<p class="mt-1 text-xs text-base-content/70">
							Source model · {size(analysis.size)} · GLB
						</p>
					</div>
					{#if !result}
						<dl class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
							<div>
								<dt class="text-xs text-base-content/60">Vertices</dt>
								<dd class="mt-1 font-semibold">{count(analysis.vertices)}</dd>
							</div>
							<div>
								<dt class="text-xs text-base-content/60">Triangles</dt>
								<dd class="mt-1 font-semibold">{count(analysis.triangles)}</dd>
							</div>
							<div>
								<dt class="text-xs text-base-content/60">Materials</dt>
								<dd class="mt-1 font-semibold">{count(analysis.materials)}</dd>
							</div>
							<div>
								<dt class="text-xs text-base-content/60">Textures</dt>
								<dd class="mt-1 font-semibold">{count(analysis.textures)}</dd>
							</div>
						</dl>
						<ul class="space-y-3" aria-label="Model health findings">
							{#each analysis.findings as finding}<li class="flex gap-3 text-sm">
									<span
										class:text-warning={finding.tone === 'warning'}
										class:text-error={finding.tone === 'error'}
										class:text-success={finding.tone === 'success'}
										aria-hidden="true"
										>{finding.tone === 'success' ? '✓' : finding.tone === 'info' ? '·' : '!'}</span
									>
									<div>
										<strong class="font-medium">{finding.title}</strong>
										<p class="mt-1 text-xs text-base-content/70">{finding.detail}</p>
									</div>
								</li>{/each}
						</ul>
						<fieldset
							class="space-y-2 border-t border-base-300 pt-4"
							disabled={!analysis.canOptimise || saving}
						>
							<legend class="mb-2 text-sm font-semibold">How should we optimise?</legend>
							<label
								class="flex cursor-pointer gap-3 rounded-lg border p-3"
								class:border-primary={mode === 'lossless'}
								class:border-base-300={mode !== 'lossless'}
								class:bg-base-200={mode === 'lossless'}
								><input
									class="radio mt-1 radio-sm radio-primary"
									type="radio"
									name="model-optimisation-mode"
									value="lossless"
									bind:group={mode}
								/><span
									><strong class="text-sm font-semibold">Lossless only · Recommended</strong><span
										class="mt-1 block text-xs text-base-content/70"
										>Repack model data without changing geometry precision, texture pixels or
										metadata. No mesh simplification.</span
									></span
								></label
							>
							<label
								class="flex cursor-pointer gap-3 rounded-lg border p-3"
								class:border-primary={mode === 'textures'}
								class:border-base-300={mode !== 'textures'}
								class:bg-base-200={mode === 'textures'}
								><input
									class="radio mt-1 radio-sm radio-primary"
									type="radio"
									name="model-optimisation-mode"
									value="textures"
									bind:group={mode}
								/><span
									><strong class="text-sm font-semibold">Smaller viewing copy</strong><span
										class="mt-1 block text-xs text-base-content/70"
										>Allow eligible colour textures to lose detail. Geometry and measurement
										precision stay unchanged.</span
									></span
								></label
							>
							{#if mode === 'textures'}<div class="space-y-3 rounded-lg bg-base-200 p-3">
									<label class="block text-sm" for="model-texture-quality"
										>JPEG quality · {textureQuality}%</label
									><input
										id="model-texture-quality"
										class="range w-full range-primary range-xs"
										type="range"
										min="50"
										max="95"
										step="5"
										bind:value={textureQuality}
									/><label for="model-texture-size" class="block text-sm"
										>Maximum texture dimension</label
									><select
										id="model-texture-size"
										class="select-bordered select w-full"
										bind:value={maxTextureSize}
										><option value={8192}>8192 px</option><option value={4096}>4096 px</option
										><option value={2048}>2048 px</option><option value={1024}>1024 px</option
										></select
									>
									<p class="text-xs text-base-content/70">
										Only eligible JPEG colour textures are changed. Transparency, normal maps and
										data textures are preserved. Scientific colour fidelity is not guaranteed.
									</p>
								</div>{/if}
						</fieldset>
					{:else}
						<div class="rounded-lg bg-base-200 p-3" role="status">
							<h3 class="text-sm font-semibold">
								{result.file.size < analysis.size
									? `${size(analysis.size - result.file.size)} smaller`
									: 'No reduction from these settings'}
							</h3>
							<p class="mt-1 text-sm">
								{size(analysis.size)} → {size(result.file.size)}{result.file.size < analysis.size
									? ` · ${((1 - result.file.size / analysis.size) * 100).toFixed(1)}% saved`
									: ''}
							</p>
							<ul class="mt-2 list-inside list-disc text-xs text-base-content/70">
								{#each result.changes as change}<li>{change}</li>{/each}
							</ul>
						</div>
						<div class="flex flex-wrap gap-2" role="group" aria-label="Preview model">
							<button
								type="button"
								class="btn btn-sm"
								class:btn-accent={preview === 'original'}
								aria-pressed={preview === 'original'}
								onclick={() => (preview = 'original')}>Original</button
							><button
								type="button"
								class="btn btn-sm"
								class:btn-accent={preview === 'copy'}
								aria-pressed={preview === 'copy'}
								onclick={() => (preview = 'copy')}>Optimised copy</button
							><a class="btn ml-auto btn-outline btn-sm" href={copyUrl} download={result.file.name}
								>Download GLB</a
							>
						</div>
						{#key preview + copyUrl}<VoyagerViewer
								url={previewRoot}
								model={preview === 'copy' ? previewFile : previewSource}
								fetchOverrides={[
									{ url: previewFile, content: result.file, contentType: 'model/gltf-binary' },
									...(source
										? [{ url: previewSource, content: source, contentType: 'model/gltf-binary' }]
										: [])
								]}
								title={preview === 'copy' ? 'Optimised model preview' : 'Original model preview'}
								direct={true}
								height="300px"
								showControls={true}
								showEditorSwitch={false}
								onModelLoaded={() => {
									if (preview === 'copy') copyLoaded = true;
									else originalLoaded = true;
								}}
							/>{/key}
						<p class="text-xs text-base-content/70">
							Rotate and zoom both versions to inspect fine detail. This preview shows the model
							alone; existing scene annotations are not changed.
						</p>
						<label class="flex gap-3 text-sm"
							><input
								type="checkbox"
								class="checkbox checkbox-sm checkbox-primary"
								bind:checked={reviewed}
								disabled={!copyLoaded || !originalLoaded || saving}
							/><span
								>I have reviewed both versions and approve this viewing copy.{#if !copyLoaded || !originalLoaded}<span
										class="mt-1 block text-xs text-base-content/60"
										>Open both previews and wait for them to load before approving.</span
									>{/if}</span
							></label
						>
					{/if}
					<p class="text-xs text-base-content/60">
						Technical health is not scientific accuracy or a full glTF validation. File savings do
						not guarantee faster rendering.
					</p>
				{/if}
				{#if !capable && !busy}<p class="rounded-lg bg-base-200 p-3 text-xs text-base-content/70">
						Preview and download work on this device. Applying or restoring a viewing copy requires
						the model optimisation backend update to be installed separately.
					</p>{/if}
				{#if capable && canRestore && !busy}<details class="rounded-lg border border-base-300 p-3">
						<summary class="cursor-pointer text-sm">Previous viewing version</summary>
						<p class="mt-2 text-xs text-base-content/70">
							Restore the scene saved immediately before the last optimisation. This also reverts
							subsequent scene edits; all model assets are kept.
						</p>
						<button
							type="button"
							class="btn mt-3 btn-outline btn-sm"
							disabled={saving}
							onclick={() => {
								if (
									confirm(
										'Restore the scene from before the last optimisation? Subsequent scene edits will be replaced. Model files will be retained.'
									)
								)
									void save('restore');
							}}>Restore previous version</button
						>
					</details>{/if}
			</div>
			<footer
				class="flex flex-wrap items-center justify-between gap-3 border-t border-base-300 p-5"
			>
				<span class="text-xs text-base-content/60">Original model preserved</span>
				<div class="flex gap-2">
					<button
						type="button"
						class="btn btn-outline"
						disabled={saving}
						onclick={() => {
							if (result) clearCopy();
							else close();
						}}>{result ? 'Back to settings' : busy ? 'Cancel' : 'Close'}</button
					>{#if result}<button
							type="button"
							class="btn btn-primary"
							disabled={!capable ||
								!reviewed ||
								!copyLoaded ||
								!originalLoaded ||
								saving ||
								result.file.size >= (analysis?.size ?? 0)}
							onclick={() => save('apply')}>{saving ? 'Saving…' : 'Use copy for viewing'}</button
						>{:else if analysis}<button
							type="button"
							class="btn btn-primary"
							disabled={!!busy || saving || !analysis.canOptimise}
							onclick={optimise}>Create preview</button
						>{/if}
				</div>
			</footer>
		</div>
	</dialog>
</div>
