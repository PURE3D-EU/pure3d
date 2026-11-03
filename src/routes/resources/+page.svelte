<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- Internal paths use resolve; category links append a query string. */
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { kindLabels } from '$lib/content';
	import { getCardImageSources } from '$lib/utils/asset-image-sources';
	import { localContentAssetUrl } from '$lib/utils/local-content-asset';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	let query = $state('');
	let view = $state<'grid' | 'list'>('grid');
	onMount(() => {
		try {
			const savedView = localStorage.getItem('pure3d-resources-view');
			if (savedView === 'grid' || savedView === 'list') view = savedView;
		} catch {
			// Keep the default when browser storage is unavailable.
		}
	});

	function setView(nextView: 'grid' | 'list') {
		view = nextView;
		try {
			localStorage.setItem('pure3d-resources-view', nextView);
		} catch {
			// Switching views still works when browser storage is unavailable.
		}
	}
	let loadedImages = $state<Record<string, boolean>>({});
	let failedImages = $state<Record<string, boolean>>({});
	let latestId = $derived(data.items.find((item) => item.isPublished && item.publishedAt)?.id);
	let items = $derived(
		data.items.filter((item) =>
			`${item.title} ${item.summary}`.toLowerCase().includes(query.toLowerCase())
		)
	);
	let displayItems = $derived([
		...items.filter((item) => item.id === latestId),
		...items.filter((item) => item.id !== latestId)
	]);
</script>

<svelte:head
	><title>{data.categoryName || 'Activities & Outputs'} | PURE3D</title><meta
		name="description"
		content="Explore research, publications, tutorials and stories from the PURE3D community."
	/></svelte:head
>
<main id="resources-page" class="mx-auto max-w-7xl px-5 py-6 md:px-10">
	<header class="mb-8 max-w-3xl">
		<h1 class="text-4xl font-bold tracking-tight">{data.categoryName || 'Activities & Outputs'}</h1>
		<p class="mt-4 text-lg text-base-content/70">
			Learn from the research, explore new perspectives and get inspired by the community.
		</p>
	</header>
	<div class="resource-toolbar mb-9 border-y border-base-300">
		<nav class="resource-tabs" aria-label="Resource categories">
			<a
				class:active={!data.category}
				aria-current={!data.category ? 'page' : undefined}
				href={resolve('/resources')}>Activities &amp; Updates</a
			>{#each data.categories as category (category.id)}<a
					class:active={data.category === category.id}
					aria-current={data.category === category.id ? 'page' : undefined}
					href={`${resolve('/resources')}?category=${category.slug}`}>{category.name}</a
				>{/each}
		</nav>
		<div class="resource-controls">
			<label class="resource-search input"
				><span class="sr-only">Search resources</span><input
					type="search"
					placeholder="Search resources…"
					bind:value={query}
				/></label
			>
			<div class="join shrink-0" role="group" aria-label="Content view">
				<button
					type="button"
					class="btn join-item btn-sm"
					class:btn-active={view === 'grid'}
					aria-pressed={view === 'grid'}
					onclick={() => setView('grid')}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						aria-hidden="true"
					>
						<rect x="3" y="3" width="7" height="7" rx="1" />
						<rect x="14" y="3" width="7" height="7" rx="1" />
						<rect x="3" y="14" width="7" height="7" rx="1" />
						<rect x="14" y="14" width="7" height="7" rx="1" />
					</svg>
					Grid</button
				>
				<button
					type="button"
					class="btn join-item btn-sm"
					class:btn-active={view === 'list'}
					aria-pressed={view === 'list'}
					onclick={() => setView('list')}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						aria-hidden="true"
					>
						<path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1" />
					</svg>
					List</button
				>
			</div>
		</div>
	</div>
	<div
		class={view === 'grid'
			? 'grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
			: 'resource-list'}
	>
		{#each displayItems as item, index (item.id)}{@const imageSources = item.coverUrl
				? getCardImageSources(localContentAssetUrl(item.coverUrl))
				: null}<a
				class="group overflow-hidden"
				class:ds-card={view === 'grid' || item.id === latestId}
				class:resource-grid-card={view === 'grid' && item.id !== latestId}
				class:resource-row={view === 'list' && item.id !== latestId}
				class:resource-latest={item.id === latestId}
				href={resolve('/resources/[slug]', { slug: item.slug })}
				><div class="resource-image relative aspect-[16/10] overflow-hidden bg-base-200">
					{#if imageSources && !failedImages[item.id]}<div
							class="absolute inset-0 flex items-center justify-center text-3xl tracking-widest opacity-25"
							class:hidden={loadedImages[item.id]}
						>
							PURE3D
						</div>
						<img
							src={imageSources.src}
							srcset={imageSources.srcset}
							sizes={item.id === latestId
								? '(min-width: 768px) 40vw, 100vw'
								: view === 'list'
									? '(min-width: 640px) 160px, 88px'
									: '(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw'}
							alt=""
							loading={index < 3 ? 'eager' : 'lazy'}
							fetchpriority={index < 3 ? 'high' : 'auto'}
							decoding="async"
							onload={() => (loadedImages[item.id] = true)}
							onerror={() => (failedImages[item.id] = true)}
							class="h-full w-full object-cover"
							class:opacity-0={!loadedImages[item.id]}
						/>{:else}<div
							class="flex h-full items-center justify-center text-3xl tracking-widest opacity-25"
						>
							PURE3D
						</div>{/if}
					{#if !item.isPublished}
						<span
							class="absolute inset-x-0 top-0 bg-warning px-3 py-1 text-center text-xs font-semibold text-warning-content"
							>Draft</span
						>
					{/if}
				</div>
				<div class="resource-copy p-6">
					<p class="resource-meta mb-3 text-xs tracking-wider uppercase opacity-60">
						{data.categories
							.filter((c) => item.categoryIds?.includes(c.id))
							.map((c) => c.name)
							.join(' · ') || kindLabels[item.kind]}
					</p>
					<h2 class="resource-title text-xl leading-snug font-semibold group-hover:underline">
						{item.title}
					</h2>
					<p class="resource-summary mt-3 line-clamp-3 text-sm leading-relaxed opacity-65">
						{item.summary}
					</p>
					<p class="resource-date mt-6 text-xs opacity-50">
						{item.publishedAt
							? new Date(item.publishedAt).toLocaleDateString('en-GB', {
									year: 'numeric',
									month: 'long',
									day: 'numeric'
								})
							: ''}
					</p>
				</div></a
			>{/each}
	</div>
	{#if items.length === 0}<p class="py-20 text-center opacity-60">
			{query
				? 'No resources match your search.'
				: 'Resources are being prepared for publication. Please check back soon.'}
		</p>{/if}
</main>

<style>
	.resource-grid-card {
		display: flex;
		flex-direction: column;
		padding: 0.75rem;
	}

	.resource-grid-card .resource-image {
		border-radius: 0.5rem;
	}

	.resource-grid-card .resource-copy {
		display: flex;
		flex: 1;
		flex-direction: column;
		margin-top: 0.75rem;
		padding: 0.75rem;
		border-radius: 0.375rem;
		background: var(--color-base-200);
	}

	.resource-grid-card .resource-meta {
		margin-bottom: 0.5rem;
		font-size: 0.625rem;
	}

	.resource-grid-card .resource-title {
		font-size: 1rem;
	}

	.resource-grid-card .resource-summary {
		margin-top: 0.5rem;
		-webkit-line-clamp: 2;
	}

	.resource-grid-card .resource-date {
		margin-top: auto;
		padding-top: 1rem;
	}

	.resource-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 0;
	}

	.resource-tabs {
		display: flex;
		gap: 0.25rem;
		min-width: 0;
		overflow-x: auto;
	}

	.resource-tabs a {
		flex-shrink: 0;
		padding: 0.75rem 0.625rem;
		border-bottom: 3px solid transparent;
		font-size: 0.875rem;
		font-weight: 500;
		white-space: nowrap;
		border-radius: 0.375rem 0.375rem 0 0;
	}

	.resource-tabs a:hover {
		background: var(--color-base-200);
	}

	.resource-tabs a.active {
		border-bottom-color: var(--color-primary);
		background: var(--color-base-200);
		font-weight: 700;
	}

	.resource-controls {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-shrink: 0;
	}

	.resource-search {
		width: 13rem;
		min-width: 0;
	}

	.resource-search input {
		min-width: 0;
	}

	@media (min-width: 1100px) {
		.resource-toolbar {
			flex-wrap: nowrap;
		}
	}

	@media (max-width: 639px) {
		.resource-controls {
			width: 100%;
		}

		.resource-search {
			flex: 1;
		}
	}

	.resource-row {
		display: grid;
		grid-template-columns: 88px minmax(0, 1fr);
		gap: 1rem;
		padding: 1.5rem 0;
		border-width: 0 0 1px;
		border-radius: 0;
		background: transparent;
	}

	.resource-row .resource-image {
		aspect-ratio: 4 / 3;
		border-radius: 0.375rem;
	}

	.resource-row .resource-copy {
		padding: 0;
	}

	.resource-row .resource-meta {
		margin-bottom: 0.375rem;
	}

	.resource-row .resource-title {
		font-size: 1.125rem;
	}

	.resource-row .resource-summary {
		margin-top: 0.5rem;
		-webkit-line-clamp: 2;
	}

	.resource-row .resource-date {
		margin-top: 0.75rem;
	}

	.resource-latest {
		display: grid;
		grid-column: 1 / -1;
		gap: 0.75rem;
		padding: 0.75rem;
	}

	.resource-latest .resource-image {
		border-radius: 0.5rem;
	}

	.resource-latest .resource-copy {
		display: flex;
		flex-direction: column;
		justify-content: center;
		border-radius: 0.375rem;
		background: var(--color-base-200);
	}

	.resource-list > .resource-latest {
		margin-bottom: 1.5rem;
	}

	@media (min-width: 768px) {
		.resource-latest {
			grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
		}

		.resource-latest .resource-title {
			font-size: 1.75rem;
		}

		.resource-latest .resource-image {
			aspect-ratio: auto;
			min-height: 260px;
		}
	}

	@media (min-width: 640px) {
		.resource-row {
			grid-template-columns: 160px minmax(0, 1fr);
			gap: 1.5rem;
		}
	}
</style>
