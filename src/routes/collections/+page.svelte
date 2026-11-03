<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import CollectionCard from '$lib/components/cards/CollectionCard.svelte';
	import {
		collectionsStore,
		fetchCollections,
		isStale,
		refreshCollectionCounts
	} from '$lib/stores/data.store';
	import { authStore } from '$lib/database/stores/auth.svelte';
	import { pb } from '$lib/database/client';
	import FloatingDropdown from '$lib/components/ui/FloatingDropdown.svelte';
	import { GlobalRole } from '$lib/types/roles';
	import toast from 'svelte-french-toast';

	let showHiddenCollections = $state(false);
	let canShowHiddenCollections = $derived(authStore.globalRole === GlobalRole.Admin);
	let allCollections = $derived($collectionsStore.items ?? []);
	let hiddenCollectionCount = $derived(
		allCollections.filter((collection) => !isPublicCollection(collection)).length
	);

	function isPublicCollection(collection: (typeof allCollections)[number]) {
		return (
			collection.isVisible && (collection.editionCount === undefined || collection.editionCount > 0)
		);
	}

	// Account-scoped catalogue data remains in memory.
	let collections = $derived(
		canShowHiddenCollections && showHiddenCollections
			? allCollections
			: allCollections.filter(isPublicCollection)
	);
	let hasCachedData = $derived(($collectionsStore.items ?? []).length > 0);
	let isLoading = $state(true);

	async function loadCollections() {
		isLoading = true;
		// If we have fresh cached data, skip loading
		if (!authStore.isAuthenticated && hasCachedData && !isStale($collectionsStore.lastFetched)) {
			isLoading = false;
			if ($collectionsStore.countError || isStale($collectionsStore.countsLastFetched ?? null)) {
				void refreshCollectionCounts();
			}
			return;
		}

		try {
			await fetchCollections();
		} catch (error) {
			console.error('Error loading collections:', error);
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		void loadCollections();
		return pb.authStore.onChange(() => void loadCollections());
	});

	// Search state
	let searchQuery = $state('');
	let showSuggestions = $state(false);
	let selectedIndex = $state(-1);
	let inputElement: HTMLInputElement | undefined = $state();
	let suggestionsElement: HTMLDivElement | undefined = $state();

	function normalizeSearchValue(value: string) {
		return value
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase();
	}

	function getSearchValues(value: unknown): string[] {
		if (value === null || value === undefined) return [];
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
			return [normalizeSearchValue(String(value))];
		}
		if (Array.isArray(value)) return value.flatMap(getSearchValues);
		if (typeof value === 'object') {
			return Object.values(value as Record<string, unknown>).flatMap(getSearchValues);
		}
		return [];
	}

	function editDistanceWithinLimit(left: string, right: string, limit: number) {
		if (Math.abs(left.length - right.length) > limit) return false;

		let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
		for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
			const current = [leftIndex + 1];
			let rowMinimum = current[0];

			for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
				const cost = left[leftIndex] === right[rightIndex] ? 0 : 1;
				const distance = Math.min(
					previous[rightIndex + 1] + 1,
					current[rightIndex] + 1,
					previous[rightIndex] + cost
				);
				current.push(distance);
				rowMinimum = Math.min(rowMinimum, distance);
			}

			if (rowMinimum > limit) return false;
			previous = current;
		}

		return previous[right.length] <= limit;
	}

	function wordMatchesQuery(word: string, query: string) {
		if (word.includes(query)) return true;
		if (query.length < 4 || word.length < 4) return false;

		const limit = query.length >= 8 ? 2 : 1;
		return editDistanceWithinLimit(word, query, limit);
	}

	function matchesSearch(collection: (typeof collections)[number], query: string) {
		const values = getSearchValues(collection);
		const combined = values.join(' ');

		if (combined.includes(query)) return true;

		const words = combined.match(/[a-z0-9]+/g) ?? [];
		return query
			.split(/\s+/)
			.filter(Boolean)
			.every((queryPart) => words.some((word) => wordMatchesQuery(word, queryPart)));
	}

	// Filter collections based on search query
	const filteredCollections = $derived.by(() => {
		if (!searchQuery.trim()) return collections;
		const query = normalizeSearchValue(searchQuery.trim());
		return collections.filter((collection) => matchesSearch(collection, query));
	});

	// Suggestions for autocomplete (max 6)
	const suggestions = $derived.by(() => {
		if (!searchQuery.trim()) return [];
		return filteredCollections.slice(0, 6);
	});

	function handleInput() {
		showSuggestions = searchQuery.trim().length > 0 && suggestions.length > 0;
		selectedIndex = -1;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!showSuggestions || suggestions.length === 0) {
			if (event.key === 'Escape') {
				searchQuery = '';
				inputElement?.blur();
			}
			return;
		}

		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				selectedIndex = selectedIndex < suggestions.length - 1 ? selectedIndex + 1 : 0;
				scrollToSelected();
				break;
			case 'ArrowUp':
				event.preventDefault();
				selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : suggestions.length - 1;
				scrollToSelected();
				break;
			case 'Enter':
				event.preventDefault();
				if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
					navigateToCollection(suggestions[selectedIndex]);
				}
				break;
			case 'Escape':
				event.preventDefault();
				showSuggestions = false;
				selectedIndex = -1;
				break;
			case 'Tab':
				showSuggestions = false;
				selectedIndex = -1;
				break;
		}
	}

	function scrollToSelected() {
		requestAnimationFrame(() => {
			const selected = suggestionsElement?.querySelector(
				`[data-index="${selectedIndex}"]`
			) as HTMLElement | null;
			selected?.scrollIntoView({ block: 'nearest' });
		});
	}

	function navigateToCollection(collection: (typeof collections)[0]) {
		showSuggestions = false;
		selectedIndex = -1;
		searchQuery = '';
		goto(resolve('/collections/[slug]', { slug: collection.id }));
	}

	function handleFocus() {
		if (searchQuery.trim() && suggestions.length > 0) {
			showSuggestions = true;
		}
	}

	function clearSearch() {
		searchQuery = '';
		showSuggestions = false;
		selectedIndex = -1;
		inputElement?.focus();
	}

	let isCreating = $state(false);

	async function createCollection() {
		if (!authStore.isAuthenticated || !authStore.appUserId) {
			toast.error('Please sign in to create a collection');
			return;
		}
		isCreating = true;
		try {
			const record = await pb.collection('collections').create({
				title: 'Untitled Collection',
				dcTitle: 'Untitled Collection',
				isVisible: false
			});

			goto(resolve(`/collections/${record.id}/edit?new=1`));
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : 'Failed to create collection';
			toast.error(message);
		} finally {
			isCreating = false;
		}
	}
</script>

<svelte:head>
	<title>Explore Our Collections | Pure 3D</title>
	<meta
		name="description"
		content="Discover our curated 3D collections showcasing digital humanities and cultural heritage artefacts."
	/>
</svelte:head>

<div class="container mx-auto max-w-7xl px-4 py-8">
	<div class="mb-12 flex flex-col gap-6">
		<div class="order-2 text-center">
			<h1 class="mb-4 text-4xl font-bold md:text-5xl">Explore our Collections</h1>
			<p class="mx-auto max-w-2xl text-lg text-base-content/70">
				A Virtual Research Environment for 3D Digital Humanities And Heritage
			</p>
		</div>
		{#if authStore.globalRole === GlobalRole.Admin}
			<div class="order-1 ml-auto flex flex-none flex-wrap items-center justify-end gap-3">
				<label
					class="flex min-h-8 cursor-pointer items-center gap-2 text-xs text-base-content/60 hover:text-base-content"
				>
					<input
						type="checkbox"
						class="toggle toggle-primary toggle-xs"
						bind:checked={showHiddenCollections}
					/>
					<span>Show hidden and empty</span>
					{#if hiddenCollectionCount > 0}
						<span class="tabular-nums">({hiddenCollectionCount})</span>
					{/if}
				</label>
				<button class="btn btn-sm btn-primary" onclick={createCollection} disabled={isCreating}>
					{#if isCreating}
						<span class="loading loading-xs loading-spinner"></span>
					{/if}
					+ New Collection
				</button>
			</div>
		{/if}
	</div>

	<!-- Search Section -->
	<div class="mx-auto mb-8 max-w-xl">
		<div class="search-container">
			<div class="relative">
				<svg
					class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-base-content/50"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
					/>
				</svg>
				<input
					type="text"
					bind:this={inputElement}
					bind:value={searchQuery}
					oninput={handleInput}
					onfocus={handleFocus}
					onkeydown={handleKeydown}
					placeholder="Search collections..."
					class="input-bordered input w-full bg-base-100 pr-10 pl-10"
					role="combobox"
					aria-expanded={showSuggestions}
					aria-haspopup="listbox"
					aria-autocomplete="list"
					aria-controls="collection-suggestions"
				/>
				{#if searchQuery}
					<button
						type="button"
						onclick={clearSearch}
						class="btn absolute top-1/2 right-3 btn-circle -translate-y-1/2 btn-ghost btn-xs"
						aria-label="Clear search"
					>
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M6 18L18 6M6 6l12 12"
							/>
						</svg>
					</button>
				{/if}
			</div>

			<!-- Autocomplete Suggestions Dropdown -->
			<FloatingDropdown
				open={showSuggestions && suggestions.length > 0}
				referenceElement={inputElement}
				bind:element={suggestionsElement}
				role="listbox"
				maxHeight={320}
				class="shadow-xl"
				onclose={() => {
					showSuggestions = false;
					selectedIndex = -1;
				}}
			>
				{#each suggestions as suggestion, index (suggestion.id)}
					{@const isSelected = selectedIndex === index}
					<div role="option" aria-selected={isSelected}>
						<button
							type="button"
							data-index={index}
							class="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left text-base-content transition-colors hover:bg-base-200 hover:text-base-content"
							class:bg-base-200={isSelected}
							onclick={() => navigateToCollection(suggestion)}
							onmouseenter={() => (selectedIndex = index)}
						>
							{#if suggestion.thumbnail}
								<img
									src={suggestion.thumbnail}
									alt=""
									class="h-10 w-10 shrink-0 rounded object-cover"
								/>
							{:else}
								<div
									class="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-base-300"
								>
									<svg
										class="h-5 w-5 opacity-50"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
										/>
									</svg>
								</div>
							{/if}
							<div class="min-w-0 flex-1">
								<div class="truncate font-medium">{suggestion.title}</div>
								{#if suggestion.description}
									<div class="truncate text-sm opacity-60">
										{suggestion.description.slice(0, 60)}{suggestion.description.length > 60
											? '...'
											: ''}
									</div>
								{/if}
							</div>
							{#if suggestion.isVisible === false}
								<span class="badge border-red-800 bg-red-700 badge-sm text-white">Not public</span>
							{/if}
							{#if suggestion.editionCount !== undefined}
								<span class="badge badge-ghost badge-sm">
									{suggestion.editionCount}
									{suggestion.editionCount === 1 ? 'edition' : 'editions'}
								</span>
							{/if}
						</button>
					</div>
				{/each}
				<div
					class="flex items-center gap-4 border-t border-base-200 px-3 py-2 text-xs text-base-content/50"
				>
					<span><kbd class="kbd kbd-xs">↑</kbd><kbd class="kbd kbd-xs">↓</kbd> navigate</span>
					<span><kbd class="kbd kbd-xs">Enter</kbd> select</span>
					<span><kbd class="kbd kbd-xs">Esc</kbd> close</span>
				</div>
			</FloatingDropdown>
		</div>

		<!-- Results count when filtering -->
		{#if searchQuery.trim()}
			<div class="mt-2 text-center text-sm text-base-content/70">
				Showing {filteredCollections.length} of {collections.length} collections
			</div>
		{/if}
	</div>

	<!-- Collections Grid -->
	{#if isLoading && !hasCachedData}
		<div class="masonry-grid">
			{#each Array.from({ length: 8 }, (_, index) => index) as index (index)}
				<div class="masonry-item">
					<div class="h-64 skeleton rounded-xl"></div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="masonry-grid">
			{#each filteredCollections as collection, index (collection.id)}
				<div class="masonry-item">
					<CollectionCard
						{collection}
						imageLoading={index < 4 ? 'eager' : 'lazy'}
						imageFetchPriority={index < 4 ? 'high' : 'auto'}
					/>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Empty state -->
	{#if filteredCollections.length === 0 && searchQuery.trim()}
		<div class="flex flex-col items-center justify-center py-16 text-center">
			<svg
				class="mb-4 h-16 w-16 text-base-content/30"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="1.5"
					d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
				/>
			</svg>
			<h3 class="mb-2 text-lg font-medium">No collections found</h3>
			<p class="max-w-md text-base-content/60">
				No collections match "{searchQuery}". Try a different search term.
			</p>
			<button class="btn mt-4 btn-sm btn-primary" onclick={clearSearch}> Clear search </button>
		</div>
	{/if}
</div>

<style>
	.masonry-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.5rem;
	}

	@media (min-width: 640px) {
		.masonry-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (min-width: 1024px) {
		.masonry-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	@media (min-width: 1280px) {
		.masonry-grid {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}

	.masonry-item {
		min-width: 0;
	}
</style>
