<script lang="ts">
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import InfoIcon from '~icons/lucide/info';
	import type { EditionViewData } from '$lib/components/editions/edition-view';
	import {
		kompakktViewerUrl,
		loadKompakktScene,
		resolveKompakktResource,
		type KompakktModel
	} from './kompakkt-resource';

	let { edition }: { edition: EditionViewData['edition'] } = $props();
	let attempt = $state(0);
	let sceneLoading = $state(false);
	let checking = $state(false);
	let modelLoading = $state(false);
	const loading = $derived(sceneLoading || checking || modelLoading);
	let error = $state('');
	let viewerUrl = $state('');
	let frameLoaded = $state(false);
	let frameSlow = $state(false);
	let scene = $state.raw<{ directory: string; models: KompakktModel[] } | null>(null);
	const models = $derived(scene?.models ?? []);
	let selectedModelId = $state<number | undefined>();
	const loadedModelId = $derived(selectedModelId ?? models[0]?.id);
	let sceneAttempt = $state(0);
	let requestedResource = $state('');
	let viewerFrame = $state<HTMLIFrameElement>();
	let initialResource = '';
	let sentResource = '';
	let requestId = 0;
	const checkedResources = new Set<string>();
	const viewerBase = `${base}/kompakkt`;

	onMount(() => {
		const receive = (event: MessageEvent) => {
			if (event.origin !== window.location.origin || event.source !== viewerFrame?.contentWindow) return;
			const message = event.data;
			if (!message || typeof message !== 'object') return;
			if (message.type === 'pure3d:kompakkt:initial-error' && message.resource === initialResource && !frameLoaded) {
				modelLoading = false;
				error = 'This model could not load. Try again or choose another model.';
			} else if (message.type === 'pure3d:kompakkt:ready' && message.resource === initialResource && !frameLoaded) {
				sentResource = initialResource;
				frameLoaded = true;
				modelLoading = requestedResource !== initialResource;
			} else if (message.type === 'pure3d:kompakkt:loaded' && message.requestId === requestId && message.resource === requestedResource) {
				modelLoading = false;
			} else if (message.type === 'pure3d:kompakkt:error' && message.requestId === requestId) {
				modelLoading = false;
				error = 'This model could not load. Try again or choose another model.';
			}
		};
		window.addEventListener('message', receive);
		return () => window.removeEventListener('message', receive);
	});

	$effect(() => {
		void sceneAttempt;
		if (!edition.isPublished) return;
		const controller = new AbortController();
		scene = null;
		selectedModelId = undefined;
		checkedResources.clear();
		sceneLoading = true;
		error = '';
		loadKompakktScene(
			edition.voyagerRoot,
			edition.sceneFile,
			edition.uploadedAssetMap ?? {},
			controller.signal
		)
			.then((loaded) => {
				if (!controller.signal.aborted) scene = loaded;
			})
			.catch(() => {
				if (!controller.signal.aborted) error = 'The edition scene could not load. Please try again.';
			})
			.finally(() => {
				if (!controller.signal.aborted) sceneLoading = false;
			});
		const timeout = setTimeout(() => {
			controller.abort();
			if (sceneLoading) {
				sceneLoading = false;
				error = 'The edition scene took too long to respond. Please try again.';
			}
		}, 30_000);
		return () => {
			controller.abort();
			clearTimeout(timeout);
		};
	});

	$effect(() => {
		void attempt;
		const current = scene;
		const selection = selectedModelId;
		if (!current) return;
		const model = current.models.find((candidate) => candidate.id === selection) ?? current.models[0];
		const controller = new AbortController();
		checking = true;
		error = '';
		requestedResource = '';
		const resource = checkedResources.has(model.url)
			? Promise.resolve(model.url)
			: resolveKompakktResource(model, current.directory, edition.uploadedAssetMap ?? {}, controller.signal);
		resource.then((url) => {
				if (controller.signal.aborted) return;
				checkedResources.add(url);
				requestedResource = url;
				if (!viewerUrl) {
					initialResource = url;
					modelLoading = true;
					viewerUrl = kompakktViewerUrl(url);
				}
			})
			.catch((reason: unknown) => {
				if (!controller.signal.aborted)
					error =
						reason instanceof TypeError
							? 'The model assets could not be reached. Please use Voyager or try again.'
							: reason instanceof Error
								? reason.message
								: 'The public model could not load. Please use Voyager or try again.';
			})
			.finally(() => {
				if (!controller.signal.aborted) checking = false;
			});
		const timeout = setTimeout(() => {
			if (checking) {
				controller.abort();
				checking = false;
				error = 'The public assets took too long to respond. Try again or return to Voyager.';
			}
		}, 30_000);
		return () => {
			controller.abort();
			clearTimeout(timeout);
		};
	});

	$effect(() => {
		const resource = requestedResource;
		if (!frameLoaded || !viewerFrame || !resource || resource === sentResource) return;
		sentResource = resource;
		modelLoading = true;
		viewerFrame.contentWindow?.postMessage(
			{ type: 'pure3d:kompakkt:load', resource, requestId: ++requestId },
			window.location.origin
		);
	});

	function retry() {
		sentResource = '';
		if (scene) attempt += 1;
		else sceneAttempt += 1;
	}

	$effect(() => {
		if (!viewerUrl || frameLoaded) return;
		frameSlow = false;
		const timeout = setTimeout(() => (frameSlow = true), 30_000);
		return () => clearTimeout(timeout);
	});
</script>

<div id="kompakkt-viewer" class="relative min-h-[495px] overflow-hidden rounded-lg bg-neutral">
	<div class="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-start gap-3 pr-12">
		{#if models.length > 1}
			<label class="pointer-events-auto min-w-0">
				<span class="sr-only">Model</span>
				<select
					class="select select-sm w-56 max-w-full border-base-300 bg-base-100/95 text-base-content shadow-sm"
					value={selectedModelId ?? loadedModelId}
					onchange={(event) => (selectedModelId = Number(event.currentTarget.value))}
				>
					{#each models as model (model.id)}
						<option value={model.id}>{model.label}</option>
					{/each}
				</select>
			</label>
		{:else}
			<span class="truncate rounded-lg bg-base-100/95 px-3 py-2 text-sm font-medium text-base-content shadow-sm">
				{models[0]?.label || edition.title}
			</span>
		{/if}
		<details
			class="pointer-events-auto shrink-0"
			onkeydown={(event) => {
				if (event.key === 'Escape') {
					event.currentTarget.open = false;
					event.currentTarget.querySelector('summary')?.focus();
				}
			}}
		>
			<summary
				class="btn btn-circle btn-sm list-none border-base-300 bg-base-100/95 text-base-content shadow-sm [&::-webkit-details-marker]:hidden"
				aria-label="About the Kompakkt viewer"
				title="About this viewer"
			>
				<InfoIcon class="h-4 w-4" aria-hidden="true" />
			</summary>
			<div class="absolute top-12 left-0 w-72 max-w-[calc(100vw-4rem)] space-y-3 rounded-lg border border-base-300 bg-base-100 p-4 text-sm text-base-content shadow-lg">
				<p class="font-medium">Kompakkt · hosted by Pure3D</p>
				<p class="text-base-content/70">
					Models are displayed individually. Voyager annotations, tours, camera settings and scene
					positioning are not transferred. Use Original for the complete edition experience.
				</p>
				<p class="flex flex-wrap gap-x-3 gap-y-1 text-xs">
					<a class="link" href={`${viewerBase}/LICENSE`} target="_blank" rel="noopener noreferrer">AGPL-3.0 licence</a>
					<a class="link" href={`${viewerBase}/source.tar.gz`} download>Viewer source</a>
				</p>
			</div>
		</details>
	</div>
	{#if !edition.isPublished || !edition.voyagerRoot || error || loading || (viewerUrl && !frameLoaded)}
		<div class="absolute inset-x-3 bottom-3 z-10 space-y-2 rounded-lg bg-base-100/95 p-3 text-sm text-base-content shadow-sm">
			{#if !edition.isPublished}
				<p role="status">Kompakkt is only available for published editions with public assets.</p>
			{:else if !edition.voyagerRoot}
				<p role="status">This edition has no directly accessible scene. Please use Original.</p>
			{:else if error}
				<p role="alert">{error}</p>
				<button type="button" class="btn btn-outline btn-sm" onclick={retry}>Try again</button>
			{:else}
				<p role="status">
					{sceneLoading || checking ? 'Checking model assets…' : frameLoaded ? 'Loading model…' : frameSlow ? 'The viewer is taking longer than expected to open.' : 'Opening viewer…'}
				</p>
			{/if}
		</div>
	{/if}
	{#if viewerUrl}
		<iframe
			bind:this={viewerFrame}
			src={viewerUrl}
			title={`Kompakkt 3D viewer: ${edition.title}`}
			class="block h-[495px] w-full border-0"
			sandbox="allow-scripts allow-same-origin"
			referrerpolicy="no-referrer"
			allow="fullscreen"
			onerror={() => {
				error = 'The self-hosted viewer could not load. Please return to Voyager.';
				modelLoading = false;
				frameLoaded = false;
				viewerUrl = '';
			}}
		></iframe>
	{/if}
</div>
