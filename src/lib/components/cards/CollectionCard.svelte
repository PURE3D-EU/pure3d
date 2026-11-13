<script lang="ts">
	import { contentText } from '$lib/utils/content-html';
	import { resolve } from '$app/paths';
	import { getCardImageSources } from '$lib/utils/asset-image-sources';

	interface CollectionCardData {
		id: string;
		slug: string;
		title: string;
		description: string;
		thumbnail: string;
		editionIds?: string[];
		editionCount?: number;
		isVisible?: boolean;
	}

	interface Props {
		collection: CollectionCardData;
		showDescription?: boolean;
		imageLoading?: 'eager' | 'lazy';
		imageFetchPriority?: 'high' | 'low' | 'auto';
	}

	let {
		collection,
		showDescription = true,
		imageLoading = 'lazy',
		imageFetchPriority = 'auto'
	}: Props = $props();

	let imageError = $state(false);
	let imageLoaded = $state(false);
	let currentImageUrl = $state('');
	const imageSources = $derived(getCardImageSources(collection.thumbnail));

	$effect(() => {
		const thumbnail = collection.thumbnail;
		if (thumbnail !== currentImageUrl) {
			currentImageUrl = thumbnail;
			imageError = false;
			imageLoaded = false;
		}
	});

	function handleImageError() {
		imageError = true;
	}

	function handleImageLoad() {
		imageLoaded = true;
	}

	let plainDescription = $derived(contentText(collection.description || ''));
	let hasEditionCount = $derived(
		collection.editionCount !== undefined || collection.editionIds !== undefined
	);
	let editionCount = $derived(collection.editionCount ?? collection.editionIds?.length ?? 0);
</script>

<div id={`collection-card-${collection.id}`} class="collection-stack">
	{#if editionCount >= 3}
		<span class="collection-stack-layer collection-stack-layer-back" aria-hidden="true"></span>
	{/if}
	{#if editionCount >= 2}
		<span class="collection-stack-layer collection-stack-layer-middle" aria-hidden="true"></span>
	{/if}
	{#if editionCount >= 1}
		<span class="collection-stack-layer collection-stack-layer-front" aria-hidden="true"></span>
	{/if}
	<a
		href={resolve('/collections/[slug]', { slug: collection.slug })}
		data-sveltekit-preload-data="hover"
		class="catalogue-card group ds-card relative flex h-full flex-col p-3"
	>
		<figure
			class="relative aspect-square min-h-0 w-full shrink-0 overflow-clip rounded-lg bg-base-200"
		>
			{#if collection.isVisible === false}
				<div
					class="absolute top-2 right-2 z-10 rounded-md border border-red-800 bg-red-700 px-2 py-1 text-[11px] font-semibold tracking-wide text-white uppercase shadow-sm"
					style="color: white;"
					title="This collection is hidden and not visible to public visitors"
				>
					Not public
				</div>
			{/if}
			<!-- Placeholder: show on error -->
			<div
				class="absolute inset-0 flex items-center justify-center text-base-content/30"
				class:hidden={imageLoaded && !imageError}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-16 w-16"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="1.5"
						d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
					/>
				</svg>
			</div>
			<!-- Actual image -->
			{#if collection.thumbnail && !imageError}
				<div class="h-full w-full">
					<img
						src={imageSources.src}
						srcset={imageSources.srcset}
						sizes="(min-width: 1024px) 360px, (min-width: 640px) 45vw, 90vw"
						alt={collection.title}
						class="card-cover-image h-full w-full object-cover"
						loading={imageLoading}
						fetchpriority={imageFetchPriority}
						decoding="async"
						onload={handleImageLoad}
						onerror={handleImageError}
					/>
				</div>
			{/if}
		</figure>
		<div class="flex flex-1 flex-col pt-3">
			<div class="flex flex-1 flex-col rounded-md bg-base-200 px-3 py-3">
				<h3 class="card-title line-clamp-2 text-base leading-tight font-semibold transition-colors">
					{collection.title}
				</h3>
				{#if showDescription && plainDescription}
					<p class="mt-2 line-clamp-2 text-sm leading-snug text-base-content/60">
						{plainDescription}
					</p>
				{/if}
				<div class="mt-auto pt-3 text-xs font-medium tracking-wide text-base-content/75 uppercase">
					{#if hasEditionCount}
						{editionCount} {editionCount === 1 ? 'Edition' : 'Editions'}
					{:else}
						Explore collection
					{/if}
				</div>
			</div>
		</div>
	</a>
</div>

<style>
	.collection-stack {
		position: relative;
		height: 100%;
		isolation: isolate;
	}

	.collection-stack-layer {
		position: absolute;
		inset: 0;
		z-index: 0;
		border: 1px solid var(--color-base-300);
		border-radius: var(--radius-box);
		background: var(--color-surface);
		box-shadow: 0 2px 5px oklch(0% 0 0 / 0.04);
		pointer-events: none;
		transition: transform 220ms ease-out;
	}

	.collection-stack-layer-back {
		transform: translate(12px, -12px);
	}

	.collection-stack-layer-middle {
		z-index: 1;
		transform: translate(8px, -8px);
	}

	.collection-stack-layer-front {
		z-index: 2;
		transform: translate(4px, -4px);
	}

	.collection-stack > .catalogue-card {
		position: relative;
		z-index: 3;
	}

	.collection-stack:hover .collection-stack-layer-back {
		transform: translate(15px, -15px);
	}

	.collection-stack:hover .collection-stack-layer-middle {
		transform: translate(10px, -10px);
	}

	.collection-stack:hover .collection-stack-layer-front {
		transform: translate(5px, -5px);
	}

	@media (prefers-reduced-motion: reduce) {
		.collection-stack-layer {
			transition: none;
		}

		.collection-stack-layer-back,
		.collection-stack:hover .collection-stack-layer-back {
			transform: translate(12px, -12px);
		}

		.collection-stack-layer-middle,
		.collection-stack:hover .collection-stack-layer-middle {
			transform: translate(8px, -8px);
		}

		.collection-stack-layer-front,
		.collection-stack:hover .collection-stack-layer-front {
			transform: translate(4px, -4px);
		}
	}
</style>
