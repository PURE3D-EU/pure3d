<script lang="ts">
	import { resolve } from '$app/paths';
	import VoyagerViewer from '$lib/components/voyager/VoyagerViewer.svelte';
	import KompakktViewer from '$lib/components/kompakkt/KompakktViewer.svelte';
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
	let embedLoaded = $state(false);
	let embedSlow = $state(false);
	let embedError = $state(false);
	let attempt = $state(0);
	const edition = {
		title: 'The Baby Doll',
		isPublished: true,
		voyagerRoot: getEditionRoot(13, 1),
		sceneFile: 'scene.svx.json'
	};
	const splatUrl = 'https://superspl.at/scene/623a62c9';

	$effect(() => {
		void attempt;
		if (activeTab !== 'playcanvas') return;
		embedLoaded = false;
		embedSlow = false;
		embedError = false;
		const timeout = setTimeout(() => (embedSlow = true), 30_000);
		return () => clearTimeout(timeout);
	});

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

<main id="3d-lab" class="mx-auto max-w-7xl space-y-6 px-4 pt-16 pb-12 sm:px-8">
	<header class="space-y-3">
		<a href={resolve('/')} class="link text-sm text-base-content/60">Back to PURE3D</a>
		<div class="flex flex-wrap items-center gap-3">
			<h1 class="text-4xl font-semibold">3D Lab</h1>
			<span class="badge badge-outline">Experimental</span>
		</div>
		<p class="max-w-2xl text-base-content/70">
			A space to explore our 3D viewers. Switch between mesh viewing in Voyager and Kompakkt, and
			Gaussian splatting in PlayCanvas.
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
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="space-y-1">
							<h2 class="text-xl font-semibold">Ancient Pillar</h2>
							<p class="text-sm text-base-content/70">
								By <a
									class="link"
									href="https://superspl.at/user/don_siamese"
									target="_blank"
									rel="noopener noreferrer">Kirill Mitsurov (don_siamese)</a
								>
								·
								<a
									class="link"
									href="https://creativecommons.org/licenses/by/4.0/"
									target="_blank"
									rel="noopener noreferrer">CC BY 4.0</a
								>
							</p>
						</div>
						<a
							class="btn btn-outline btn-sm"
							href={splatUrl}
							target="_blank"
							rel="noopener noreferrer">Open in SuperSplat</a
						>
					</div>
					<div class="relative overflow-hidden rounded-lg bg-neutral">
						{#key attempt}
							<iframe
								src="https://superspl.at/s?id=623a62c9"
								title="PlayCanvas SuperSplat viewer: Ancient Pillar by don_siamese"
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
										? 'The embedded viewer could not open. Try again or open it in SuperSplat.'
										: embedSlow
											? 'The embedded viewer is taking longer than expected. You can also open it in SuperSplat.'
											: 'Opening the SuperSplat viewer…'}
								</p>
								{#if embedError || embedSlow}
									<button
										class="btn btn-outline btn-sm"
										type="button"
										onclick={() => (attempt += 1)}>Try again</button
									>
								{/if}
							</div>
						{/if}
					</div>
					<p class="max-w-3xl text-sm text-base-content/70">
						PlayCanvas powers this externally hosted SuperSplat viewer. This sample is a Gaussian
						splat, not the mesh shown in the other tabs. Viewer controls and model loading are
						provided by SuperSplat; if the view stays blank, use the link above.
					</p>
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
