<script lang="ts">
	import { getEditionRoot } from '$lib/utils/asset-urls';
	import {
		loadKompakktScene,
		resolveKompakktResource,
		type KompakktModel
	} from '$lib/components/kompakkt/kompakkt-resource';
	import PlayCanvasViewer from './PlayCanvasViewer.svelte';

	const samples = [
		{ id: '13', title: 'The Baby Doll', credit: 'Nina Steuermann and Lena Reichel' },
		{
			id: '1',
			title: 'The Battle at 25 Northumberland Road',
			credit:
				'Susan Schreibman, Kelly Gillikin Schoueri, John Kaulakis, Luca Moine and Sandra Martinez Bohme'
		},
		{
			id: 'splat',
			title: 'Ancient Pillar (SuperSplat)',
			credit: 'Kirill Mitsurov (don_siamese)',
			splatId: '623a62c9'
		},
		{
			id: 'tower',
			title: "Tour d'observation du Mont St. Jean (SuperSplat)",
			credit: 'Kirill Mitsurov (don_siamese)',
			splatId: '43c2a7fa'
		}
	];
	let sampleId = $state('splat');
	const sample = $derived(samples.find((entry) => entry.id === sampleId) ?? samples[0]);
	let scene = $state.raw<{ directory: string; models: KompakktModel[] } | null>(null);
	let modelId = $state(0);
	const model = $derived(scene?.models.find((entry) => entry.id === modelId) ?? scene?.models[0]);
	let resource = $state('');
	let sceneLoading = $state(false);
	let checking = $state(false);
	let sceneError = $state('');
	let resourceError = $state('');
	let attempt = $state(0);
	let embedLoaded = $state(false);
	let embedSlow = $state(false);
	let embedError = $state(false);

	$effect(() => {
		void attempt;
		const id = sampleId;
		scene = null;
		modelId = 0;
		sceneError = '';
		embedLoaded = false;
		embedSlow = false;
		embedError = false;
		if (sample.splatId) {
			sceneLoading = false;
			const timeout = setTimeout(() => (embedSlow = true), 30_000);
			return () => clearTimeout(timeout);
		}
		const controller = new AbortController();
		sceneLoading = true;
		const timeout = setTimeout(() => {
			controller.abort();
			sceneLoading = false;
			sceneError = 'The scene took too long to respond. Please try again.';
		}, 30_000);
		// Reuse the existing public scene resolver and companion asset validation.
		loadKompakktScene(getEditionRoot(Number(id), 1), 'scene.svx.json', {}, controller.signal)
			.then((value) => {
				if (!controller.signal.aborted) scene = value;
			})
			.catch((reason: unknown) => {
				if (!controller.signal.aborted)
					sceneError =
						reason instanceof Error ? reason.message : 'The public scene could not load.';
			})
			.finally(() => {
				clearTimeout(timeout);
				if (!controller.signal.aborted) sceneLoading = false;
			});
		return () => {
			clearTimeout(timeout);
			controller.abort();
		};
	});

	$effect(() => {
		const selected = model;
		const current = scene;
		resource = '';
		resourceError = '';
		checking = false;
		if (!selected || !current) return;
		const controller = new AbortController();
		checking = true;
		const timeout = setTimeout(() => {
			controller.abort();
			checking = false;
			resourceError = 'The model assets took too long to respond. Please try again.';
		}, 30_000);
		resolveKompakktResource(selected, current.directory, {}, controller.signal)
			.then((url) => {
				if (!controller.signal.aborted) resource = url;
			})
			.catch((reason: unknown) => {
				if (!controller.signal.aborted)
					resourceError =
						reason instanceof Error ? reason.message : 'The public model could not load.';
			})
			.finally(() => {
				clearTimeout(timeout);
				if (!controller.signal.aborted) checking = false;
			});
		return () => {
			clearTimeout(timeout);
			controller.abort();
		};
	});
</script>

<div id="play-canvas-lab" class="space-y-4">
	<div class="space-y-4 rounded-lg bg-base-200 p-4">
		{#each [true, false] as splats}
			<fieldset class="min-w-0 space-y-2">
				<legend class="text-sm font-medium">
					{splats ? 'SuperSplat examples' : 'PURE3D infrastructure · mesh models'}
				</legend>
				<div class="flex flex-wrap gap-2">
					{#each samples.filter((entry) => !!entry.splatId === splats) as entry (entry.id)}
						<button
							type="button"
							class="btn h-auto min-h-10 text-left whitespace-normal btn-sm"
							class:btn-accent={sampleId === entry.id}
							class:btn-outline={sampleId !== entry.id}
							aria-pressed={sampleId === entry.id}
							onclick={() => (sampleId = entry.id)}
						>
							{entry.title}
						</button>
					{/each}
				</div>
			</fieldset>
		{/each}
		{#if scene && scene.models.length > 1}
			<fieldset class="min-w-0 space-y-2">
				<legend class="text-sm font-medium">Model in scene</legend>
				<div class="flex flex-wrap gap-2">
					{#each scene.models as entry (entry.id)}
						<button
							type="button"
							class="btn h-auto min-h-10 text-left whitespace-normal btn-sm"
							class:btn-accent={model?.id === entry.id}
							class:btn-outline={model?.id !== entry.id}
							aria-pressed={model?.id === entry.id}
							onclick={() => (modelId = entry.id)}
						>
							{entry.label}
						</button>
					{/each}
				</div>
			</fieldset>
		{/if}
	</div>
	<div class="space-y-1">
		<h2 class="text-xl font-semibold">{sample.title}</h2>
		<p class="text-sm text-base-content/70">By {sample.credit}</p>
	</div>
	{#if sample.splatId}
		<div class="relative overflow-hidden rounded-lg bg-neutral">
			{#key `${sample.id}-${attempt}`}
				<iframe
					src={`https://superspl.at/s?id=${sample.splatId}`}
					title={`PlayCanvas SuperSplat viewer: ${sample.title} by ${sample.credit}`}
					class="block h-[495px] w-full border-0"
					allow="fullscreen; xr-spatial-tracking"
					referrerpolicy="no-referrer"
					onload={() => (embedLoaded = true)}
					onerror={() => (embedError = true)}
				></iframe>
			{/key}
			{#if !embedLoaded || embedError}
				<div
					class="absolute inset-x-3 bottom-3 space-y-2 rounded-lg bg-base-100/95 p-3 text-sm text-base-content"
				>
					<p role="status">
						{embedError
							? 'The embedded viewer could not open.'
							: embedSlow
								? 'The embedded viewer is taking longer than expected.'
								: 'Opening the SuperSplat viewer…'}
					</p>
					{#if embedError || embedSlow}
						<button type="button" class="btn btn-outline btn-sm" onclick={() => (attempt += 1)}
							>Try again</button
						>
					{/if}
				</div>
			{/if}
		</div>
		<p class="text-sm text-base-content/70">
			External PlayCanvas reference hosted by SuperSplat ·
			<a
				class="link"
				href={`https://superspl.at/scene/${sample.splatId}`}
				target="_blank"
				rel="noopener noreferrer">Open original</a
			>
			·
			<a
				class="link"
				href="https://superspl.at/user/don_siamese"
				target="_blank"
				rel="noopener noreferrer">Creator</a
			>
			·
			<a
				class="link"
				href="https://creativecommons.org/licenses/by/4.0/"
				target="_blank"
				rel="noopener noreferrer">CC BY 4.0</a
			>
		</p>
	{:else if sceneError || resourceError}
		<div class="space-y-3 rounded-lg bg-base-200 p-4">
			<p role="alert">{sceneError || resourceError}</p>
			<button type="button" class="btn btn-outline btn-sm" onclick={() => (attempt += 1)}
				>Try again</button
			>
		</div>
	{:else if sceneLoading || checking || !resource}
		<div class="flex h-[495px] items-center justify-center rounded-lg bg-base-200 p-4">
			<p role="status">
				{sceneLoading ? 'Loading the PURE3D scene…' : 'Checking public model assets…'}
			</p>
		</div>
	{:else}
		{#key resource}
			<PlayCanvasViewer url={resource} title={model?.label || sample.title} />
		{/key}
		<p class="text-sm text-base-content/70">
			Loaded directly into our own PlayCanvas renderer from PURE3D infrastructure. Mesh and
			materials only; Voyager annotations, tours, lighting and scene placement are not transferred.
		</p>
		<p class="text-xs break-all text-base-content/60">Asset: {resource}</p>
	{/if}
</div>
