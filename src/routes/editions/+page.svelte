<script lang="ts">
	import { contentText } from '$lib/utils/content-html';
	import { onMount } from 'svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import EditionCard from '$lib/components/cards/EditionCard.svelte';
	import FilterSidebar from '$lib/components/filters/FilterSidebar.svelte';
	import FloatingDropdown from '$lib/components/ui/FloatingDropdown.svelte';
	import type { FilterState } from '$lib/types/collection';
	import { editionsStore, fetchEditions, isStale } from '$lib/stores/data.store';
	import { authStore } from '$lib/database/stores/auth.svelte';
	import { pb } from '$lib/database/client';
	import { EditionStatus, GlobalRole } from '$lib/types/roles';
	import toast from 'svelte-french-toast';
	import { editionMatchesQuery } from '$lib/utils/edition-search';
	import SearchIcon from '~icons/lucide/search';

	let showHiddenEditions = $state(false);
	let canShowHiddenEditions = $derived(authStore.globalRole === GlobalRole.Admin);
	let allEditions = $derived($editionsStore.items);
	let hiddenEditionCount = $derived(allEditions.filter((edition) => !edition.isPublished).length);

	// Account-scoped catalogue data remains in memory.
	let editions = $derived(
		canShowHiddenEditions && showHiddenEditions
			? allEditions
			: allEditions.filter((edition) => edition.isPublished)
	);
	let hasCachedData = $derived($editionsStore.items.length > 0);
	let isLoading = $state(true);

	async function loadEditions() {
		isLoading = true;
		// If we have fresh cached data, skip loading
		if (!authStore.isAuthenticated && hasCachedData && !isStale($editionsStore.lastFetched)) {
			isLoading = false;
			return;
		}

		try {
			await fetchEditions();
		} catch (error) {
			console.error('Error loading editions:', error);
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		void loadEditions();
		return pb.authStore.onChange(() => void loadEditions());
	});

	let searchQuery = $state('');
	let drawerOpen = $state(false);
	let headerHeight = $state(72);

	onMount(() => {
		const header = document.getElementById('header');
		if (!header) return;

		const updateHeaderHeight = () => {
			headerHeight = header.getBoundingClientRect().height;
		};
		updateHeaderHeight();
		const observer = new ResizeObserver(updateHeaderHeight);
		observer.observe(header);
		return () => observer.disconnect();
	});

	// Autocomplete state
	let showSuggestions = $state(false);
	let selectedIndex = $state(-1);
	let inputElement: HTMLInputElement | undefined = $state();
	let suggestionsElement: HTMLDivElement | undefined = $state();

	afterNavigate(() => {
		const query = new URLSearchParams(window.location.search).get('q') || '';
		if (query === searchQuery) return;

		searchQuery = query;
		showSuggestions = false;
		selectedIndex = -1;
	});

	// Initialize filter state
	let filters = $state<FilterState>({
		dcSubject: [],
		dcAudience: [],
		dcLanguage: [],
		dcCoverageCountry: [],
		dcCoveragePeriod: []
	});

	// Count active filters for mobile badge
	const activeFilterCount = $derived(
		Object.values(filters).reduce((sum, arr) => sum + arr.length, 0)
	);

	// Filter editions based on search and category filters
	const filteredEditions = $derived.by(() => {
		let result = editions;

		// Text search
		if (searchQuery.trim()) {
			result = result.filter((edition) => editionMatchesQuery(edition, searchQuery));
		}

		// Category filters (AND between categories, OR within category)
		for (const [key, selectedValues] of Object.entries(filters) as [
			keyof FilterState,
			string[]
		][]) {
			if (selectedValues.length > 0) {
				result = result.filter((edition) => {
					const editionValues = edition[key];
					if (!Array.isArray(editionValues)) return false;
					// OR logic: edition matches if it has ANY of the selected values
					return selectedValues.some((selected) => editionValues.includes(selected));
				});
			}
		}

		return result;
	});

	// Suggestions for autocomplete (max 6)
	const suggestions = $derived.by(() => {
		if (!searchQuery.trim()) return [];
		return filteredEditions.slice(0, 6);
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
					navigateToEdition(suggestions[selectedIndex]);
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

	function navigateToEdition(edition: (typeof editions)[0]) {
		showSuggestions = false;
		selectedIndex = -1;
		searchQuery = '';
		goto(resolve('/editions/[slug]', { slug: edition.id }));
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

	function handleFilterChange(newFilters: FilterState) {
		filters = newFilters;
	}

	function closeDrawer() {
		drawerOpen = false;
	}

	let isCreating = $state(false);

	async function createEdition() {
		if (!authStore.isAuthenticated || !authStore.appUserId) {
			toast.error('Please sign in to create an edition');
			return;
		}
		isCreating = true;
		try {
			const record = await pb.collection('editions').create({
				title: 'Untitled Edition',
				dcTitle: 'Untitled Edition',
				status: EditionStatus.Draft,
				isPublished: false
			});

			goto(resolve('/editions/[slug]/workflow', { slug: record.id }));
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : 'Failed to create edition';
			toast.error(message);
		} finally {
			isCreating = false;
		}
	}
</script>

<svelte:head>
	<title>All Editions | Pure 3D</title>
	<meta
		name="description"
		content="Browse all 3D editions in our digital humanities and heritage collection."
	/>
	<link rel="preconnect" href="https://3d-api.si.edu" crossorigin="anonymous" />
	<link rel="dns-prefetch" href="https://3d-api.si.edu" />
</svelte:head>

<!-- Drawer wrapper for mobile -->
<div id="editions" class="drawer lg:drawer-open">
	<input id="filter-drawer" type="checkbox" class="drawer-toggle" bind:checked={drawerOpen} />

	<!-- Main content -->
	<div class="drawer-content">
		<div class="container mx-auto max-w-7xl px-4 py-8">
			<!-- Header -->
			<div class="mb-8 flex items-start justify-between gap-4">
				<div>
					<h1 class="mb-2 text-3xl font-bold md:text-4xl">Editions</h1>
					<p class="text-base-content/70">Browse our collection of 3D scholarly editions</p>
				</div>
				{#if authStore.globalRole === GlobalRole.Admin}
					<div class="flex flex-none flex-wrap items-center justify-end gap-3">
						<label
							class="flex cursor-pointer items-center gap-2 rounded-full border border-base-300 bg-base-100 px-4 py-2 text-sm shadow-sm"
						>
							<input
								type="checkbox"
								class="toggle toggle-primary toggle-sm"
								bind:checked={showHiddenEditions}
							/>
							<span>Show non-public</span>
							{#if hiddenEditionCount > 0}
								<span class="badge badge-ghost badge-sm">{hiddenEditionCount}</span>
							{/if}
						</label>
						<button class="btn btn-sm btn-primary" onclick={createEdition} disabled={isCreating}>
							{#if isCreating}
								<span class="loading loading-xs loading-spinner"></span>
							{/if}
							+ New Edition
						</button>
					</div>
				{/if}
			</div>

			<!-- Search and Filter Button (mobile) -->
			<div class="mb-6 flex flex-wrap gap-2">
				<!-- Mobile filter button -->
				<label
					for="filter-drawer"
					class="btn flex-none border-base-300 bg-base-100 shadow-none lg:hidden"
					aria-label="Open filters"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
						/>
					</svg>
					Filters
					{#if activeFilterCount > 0}
						<span class="badge badge-sm badge-primary">{activeFilterCount}</span>
					{/if}
				</label>

				<!-- Search input with autocomplete -->
				<div class="search-container min-w-0 flex-1">
					<div class="relative">
						<SearchIcon
							class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-base-content/60"
							aria-hidden="true"
						/>
						<input
							type="text"
							bind:this={inputElement}
							bind:value={searchQuery}
							oninput={handleInput}
							onfocus={handleFocus}
							onkeydown={handleKeydown}
							placeholder="Search edition titles and metadata..."
							aria-label="Search edition metadata"
							class="input h-12 w-full rounded-lg border border-base-300 bg-base-100 pr-10 pl-10 shadow-none focus:border-base-content/40 focus:outline-none"
							role="combobox"
							aria-expanded={showSuggestions}
							aria-haspopup="listbox"
							aria-autocomplete="list"
							aria-controls="edition-suggestions"
						/>
						{#if searchQuery}
							<button
								type="button"
								onclick={clearSearch}
								class="btn absolute top-1/2 right-3 btn-circle -translate-y-1/2 btn-ghost btn-xs"
								aria-label="Clear edition search"
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
									onclick={() => navigateToEdition(suggestion)}
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
													d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
												/>
											</svg>
										</div>
									{/if}
									<div class="min-w-0 flex-1">
										<div class="truncate font-medium">{suggestion.title}</div>
										{#if suggestion.authors}
											<div class="truncate text-sm opacity-60">{suggestion.authors}</div>
										{:else if suggestion.description}
											{@const description = contentText(suggestion.description)}
											<div class="truncate text-sm opacity-60">
												{description.slice(0, 60)}{description.length > 60 ? '...' : ''}
											</div>
										{/if}
									</div>
									{#if suggestion.isPublished === false}
										<span class="badge border-red-800 bg-red-700 badge-sm text-white"
											>Not public</span
										>
									{/if}
									{#if suggestion.hasPeerReview}
										<span class="badge badge-sm badge-success">Peer reviewed</span>
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

				{#if !isLoading || hasCachedData}
					<div
						class="flex w-full items-center justify-between rounded-lg border border-base-300 bg-base-100 px-4 py-2.5 lg:w-auto lg:min-w-44"
						role="status"
						aria-live="polite"
					>
						<span class="font-mono text-[9px] tracking-[0.12em] text-base-content/45 uppercase">
							Results
						</span>
						<span class="text-sm font-semibold tabular-nums">
							{filteredEditions.length}
							<span class="font-normal text-base-content/45">/ {editions.length}</span>
						</span>
					</div>
				{/if}
			</div>

			<!-- Editions Grid -->
			{#if isLoading && !hasCachedData}
				<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each Array.from({ length: 15 }, (_, index) => index) as index (index)}
						<div class="h-64 skeleton rounded-xl"></div>
					{/each}
				</div>
			{:else if filteredEditions.length > 0}
				<div class="columns-1 gap-6 sm:columns-2 lg:columns-3 xl:columns-4">
					{#each filteredEditions as edition, index (edition.id)}
						<div class="mb-6 break-inside-avoid">
							<EditionCard
								{edition}
								discovery
								imageLoading={index < 4 ? 'eager' : 'lazy'}
								imageFetchPriority={index < 4 ? 'high' : 'auto'}
							/>
						</div>
					{/each}
				</div>
			{:else}
				<div class="flex flex-col items-center justify-center py-16 text-center">
					<svg
						xmlns="http://www.w3.org/2000/svg"
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
					<h3 class="mb-2 text-lg font-medium">No editions found</h3>
					<p class="max-w-md text-base-content/60">
						No editions match your current filters. Try adjusting your search or clearing some
						filters.
					</p>
					{#if activeFilterCount > 0}
						<button
							class="btn mt-4 btn-sm btn-primary"
							onclick={() => {
								filters = {
									dcSubject: [],
									dcAudience: [],
									dcLanguage: [],
									dcCoverageCountry: [],
									dcCoveragePeriod: []
								};
								searchQuery = '';
							}}
						>
							Clear all filters
						</button>
					{/if}
				</div>
			{/if}
		</div>
	</div>

	<!-- Sidebar drawer -->
	<div
		class="drawer-side z-40 self-start"
		style:top={`${headerHeight}px`}
		style:height={`calc(100dvh - ${headerHeight}px)`}
	>
		<label for="filter-drawer" aria-label="close sidebar" class="drawer-overlay"></label>
		<div class="min-h-full w-72 border-r border-base-300 bg-base-100 p-4">
			<!-- Close button for mobile -->
			<div class="mb-4 flex items-center justify-between lg:hidden">
				<span class="font-semibold">Filters</span>
				<button
					class="btn btn-circle btn-ghost btn-sm"
					onclick={closeDrawer}
					aria-label="Close filters"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>
			</div>

			<FilterSidebar {editions} {filters} onFilterChange={handleFilterChange} />
		</div>
	</div>
</div>
