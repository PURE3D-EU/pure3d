<script lang="ts">
	import { resolve } from '$app/paths';
	import VoyagerViewer from '$lib/components/voyager/VoyagerViewer.svelte';
	import KompakktViewer from '$lib/components/kompakkt/KompakktViewer.svelte';
	import PlayCanvasLab from '$lib/components/playcanvas/PlayCanvasLab.svelte';
	import {
		DEFAULT_VOYAGER_VERSION,
		getEditionRoot,
		getVoyagerResourceRoot
	} from '$lib/utils/asset-urls';

	const tabs = [
		{ id: 'voyager', label: 'Voyager' },
		{ id: 'kompakkt', label: 'Kompakkt' },
		{ id: 'playcanvas', label: 'PlayCanvas' }
	] as const;
	let activeTab = $state<(typeof tabs)[number]['id']>('playcanvas');
	const edition = {
		title: 'The Baby Doll',
		isPublished: true,
		voyagerRoot: getEditionRoot(13, 1),
		sceneFile: 'scene.svx.json'
	};

	function navigateTabs(event: KeyboardEvent, index: number) {
		let next = index;
		if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
		else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = tabs.length - 1;
		else return;
		event.preventDefault();
		activeTab = tabs[next].id;
		document.getElementById(`lab-tab-${activeTab}`)?.focus();
	}
</script>

<svelte:head>
	<title>3D Lab | PURE3D</title>
	<meta
		name="description"
		content="Explore Voyager, Kompakkt and PlayCanvas in PURE3D’s experimental 3D viewer lab."
	/>
	<meta name="robots" content="noindex" />
</svelte:head>

<main id="3d-lab" class="mx-auto max-w-7xl space-y-6 px-4 pt-24 pb-12 sm:px-8">
	<header class="space-y-3">
		<a href={resolve('/')} class="link text-sm text-base-content/60">Back to PURE3D</a>
		<div class="flex flex-wrap items-center gap-3">
			<h1 class="text-4xl font-semibold">3D Lab</h1>
			<span class="badge badge-outline">Experimental</span>
		</div>
		<p class="max-w-2xl text-base-content/70">
			A space to explore our 3D viewers. Compare PURE3D mesh assets in Voyager, Kompakkt and
			PlayCanvas, or open a Gaussian splat reference.
		</p>
	</header>

	<div role="tablist" aria-label="3D viewers" class="tabs-box tabs w-fit max-w-full bg-base-200">
		{#each tabs as tab, index (tab.id)}
			<button
				type="button"
				role="tab"
				id={`lab-tab-${tab.id}`}
				aria-controls={`lab-panel-${tab.id}`}
				aria-selected={activeTab === tab.id}
				tabindex={activeTab === tab.id ? 0 : -1}
				class="tab focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
				class:tab-active={activeTab === tab.id}
				onclick={() => (activeTab = tab.id)}
				onkeydown={(event) => navigateTabs(event, index)}
			>
				{tab.label}
			</button>
		{/each}
	</div>

	{#each tabs as tab (tab.id)}
		<section
			id={`lab-panel-${tab.id}`}
			role="tabpanel"
			aria-labelledby={`lab-tab-${tab.id}`}
			hidden={activeTab !== tab.id}
			tabindex="0"
			class="space-y-4 rounded-lg focus-visible:outline-2 focus-visible:outline-primary"
		>
			{#if activeTab === tab.id}
				{#if tab.id === 'playcanvas'}
					<PlayCanvasLab />
				{:else}
					<div class="space-y-1">
						<h2 class="text-xl font-semibold">{edition.title}</h2>
						<p class="text-sm text-base-content/70">
							By Nina Steuermann and Lena Reichel · The same public mesh in both viewers.
						</p>
					</div>
					{#if tab.id === 'voyager'}
						<VoyagerViewer
							url={edition.voyagerRoot}
							document={edition.sceneFile}
							title={edition.title}
							direct
							showControls
							height="495px"
							voyagerVersion={DEFAULT_VOYAGER_VERSION}
							resourceRoot={getVoyagerResourceRoot(DEFAULT_VOYAGER_VERSION)}
						/>
					{:else}
						<KompakktViewer {edition} />
					{/if}
					<p class="text-sm text-base-content/70">
						{tab.id === 'voyager'
							? 'Voyager includes the edition’s original scene, annotations and tours.'
							: 'Kompakkt displays the mesh only. Voyager annotations, tours and scene settings are not transferred.'}
					</p>
				{/if}
			{/if}
		</section>
	{/each}
</main>
