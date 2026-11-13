<script lang="ts">
	import { contentText } from '$lib/utils/content-html';
	import { creatorNames } from '$lib/utils/credits';
	import { base, resolve } from '$app/paths';
	import { contentPath } from '$lib/cms';
	import type { RecordModel } from 'pocketbase';
	import { pb } from '$lib/database';
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import { computePosition, flip, shift, offset, size, autoUpdate } from '@floating-ui/dom';

	import { getEditionThumbnailUrl, getCollectionThumbnailUrl } from '$lib/utils/asset-urls';
	import { SearchRequests } from './search-requests';

	type SearchResultType = 'edition' | 'collection' | 'content';

	interface SearchResult {
		type: SearchResultType;
		id: string;
		title: string;
		subtitle?: string;
		thumbnail?: string;
		url: string;
	}

	let { compactOnMobile = false }: { compactOnMobile?: boolean } = $props();
	let mobileOpen = $state(false);
	let searchQuery = $state('');
	let searching = $state(false);
	let results = $state<SearchResult[]>([]);
	let showResults = $state(false);
	let selectedIndex = $state(-1);
	let keyboardSelected = $state(false);

	let containerElement: HTMLDivElement | undefined = $state();
	let searchFieldElement: HTMLLabelElement | undefined = $state();
	let searchInputElement: HTMLInputElement | undefined = $state();
	let dropdownElement: HTMLDivElement | undefined = $state();
	let resultsListElement: HTMLElement | undefined = $state();
	let cleanupAutoUpdate: (() => void) | undefined;
	let searchRequest = 0;
	let suggestions: SearchResult[] | null = null;
	const searchRequests = new SearchRequests();

	function editionResults(items: RecordModel[]): SearchResult[] {
		return items.map((edition) => {
			const collectionPubNum = edition.expand?.collection?.pubNum || 0;
			const editionPubNum = edition.pubNum || 1;
			return {
				type: 'edition',
				id: edition.id,
				title: edition.dcTitle || edition.title || 'Untitled',
				subtitle:
					creatorNames(edition.credits) || contentText(edition.dcAbstract || '').slice(0, 80),
				thumbnail:
					edition.thumbnail && collectionPubNum > 0
						? getEditionThumbnailUrl(collectionPubNum, editionPubNum)
						: '',
				url: `${base}/editions/${edition.id}`
			};
		});
	}

	async function performSearch(query: string) {
		const trimmedQuery = query.trim();
		if (!showResults) return;
		const current = ++searchRequest;
		const signal = searchRequests.start();

		if (!trimmedQuery) {
			results = suggestions || [];
			selectedIndex = -1;
			if (suggestions) return;
			searching = true;
			try {
				const featured = await pb.collection('editions').getList(1, 4, {
					filter: 'isPublished = true && pubNum > 0',
					fields:
						'id,title,dcTitle,dcAbstract,credits,pubNum,thumbnail,collection,expand.collection.pubNum',
					expand: 'collection',
					skipTotal: true,
					signal
				});
				suggestions = editionResults(featured.items);
				if (current === searchRequest) results = suggestions;
			} catch (err) {
				if (signal.aborted) return;
				console.error('Edition suggestions error:', err);
			} finally {
				if (current === searchRequest) searching = false;
			}
			return;
		}

		searching = true;

		try {
			const [editions, collections, contentResult] = await Promise.all([
				pb.collection('editions').getList(1, 8, {
					filter: pb.filter(
						'isPublished = true && (title ~ {:query} || dcTitle ~ {:query} || dcAbstract ~ {:query} || dcKeyword ~ {:query} || credits ~ {:query})',
						{ query: trimmedQuery }
					),
					fields:
						'id,title,dcTitle,dcAbstract,credits,pubNum,thumbnail,collection,expand.collection.pubNum',
					expand: 'collection',
					skipTotal: true,
					signal
				}),
				pb.collection('collections').getList(1, 5, {
					filter: pb.filter(
						'isVisible = true && (title ~ {:query} || dcTitle ~ {:query} || dcAbstract ~ {:query} || credits ~ {:query})',
						{ query: trimmedQuery }
					),
					fields: 'id,title,dcTitle,dcAbstract,pubNum,thumbnail',
					skipTotal: true,
					signal
				}),
				pb.collection('content').getList(1, 8, {
					filter: pb.filter('isPublished = true && (title ~ {:query} || summary ~ {:query})', {
						query: trimmedQuery
					}),
					fields: 'id,title,slug,summary,coverUrl,layout',
					sort: '-publishedAt',
					skipTotal: true,
					signal
				})
			]);
			if (current !== searchRequest) return;

			// Build combined results using asset-urls helpers (respects R2 / PUBLIC_ASSET_BASE_URL)
			const collectionResults: SearchResult[] = collections.items.map((collection) => {
				const thumbnail =
					collection.thumbnail && collection.pubNum > 0
						? getCollectionThumbnailUrl(collection.pubNum)
						: '';

				return {
					type: 'collection' as const,
					id: collection.id,
					title: collection.dcTitle || collection.title || 'Untitled',
					subtitle: contentText(collection.dcAbstract || '').slice(0, 80),
					thumbnail,
					url: `${base}/collections/${collection.id}`
				};
			});

			// Prioritize editions, then collections
			results = [
				...editionResults(editions.items),
				...collectionResults,
				...contentResult.items.map((item) => ({
					type: 'content' as const,
					id: item.id,
					title: item.title,
					subtitle: item.summary,
					thumbnail: item.coverUrl,
					url: `${base}${contentPath(item)}`
				}))
			];
			selectedIndex = -1;
			keyboardSelected = false;
		} catch (err) {
			if (signal.aborted) return;
			if (current !== searchRequest) return;
			console.error('Search error:', err);
			results = [];
			keyboardSelected = false;
		} finally {
			if (current === searchRequest) searching = false;
		}
	}

	function openSearchResults() {
		showResults = true;
		searchRequests.cancelPending();
		void performSearch(searchQuery);
	}
	function cancelSearch() {
		++searchRequest;
		searchRequests.cancel();
	}
	function queryChanged() {
		cancelSearch();
		searching = false;
		results = [];
		selectedIndex = -1;
	}

	$effect(() => {
		searchRequests.schedule(() => void performSearch(searchQuery), 250);
	});

	// Position dropdown using floating-ui
	function updatePosition() {
		if (containerElement && dropdownElement) {
			// Set width immediately to prevent jump
			const containerWidth = containerElement.getBoundingClientRect().width;
			dropdownElement.style.width = `${Math.min(window.innerWidth - 24, Math.max(containerWidth, 400))}px`;

			computePosition(searchFieldElement || containerElement, dropdownElement, {
				placement: 'bottom-start',
				strategy: 'fixed',
				middleware: [
					offset(8),
					flip({ fallbackPlacements: ['top-start'] }),
					shift({ padding: 8 }),
					size({
						apply({ availableHeight }) {
							if (dropdownElement) {
								dropdownElement.style.maxHeight = `${Math.min(availableHeight - 16, 384)}px`;
							}
						},
						padding: 8
					})
				]
			}).then(({ x, y }) => {
				if (dropdownElement) {
					Object.assign(dropdownElement.style, {
						left: `${x}px`,
						top: `${y}px`,
						visibility: 'visible'
					});
				}
			});
		}
	}

	$effect(() => {
		if (showResults && containerElement && dropdownElement) {
			cleanupAutoUpdate?.();
			cleanupAutoUpdate = autoUpdate(
				searchFieldElement || containerElement,
				dropdownElement,
				updatePosition,
				{
					ancestorScroll: true,
					ancestorResize: true,
					elementResize: true,
					layoutShift: true
				}
			);
		} else {
			cleanupAutoUpdate?.();
			cleanupAutoUpdate = undefined;
		}
	});

	onMount(() => {
		window.addEventListener('keydown', handleKeyDown);
		return () => {
			cancelSearch();
			window.removeEventListener('keydown', handleKeyDown);
			cleanupAutoUpdate?.();
		};
	});

	function handleClickOutside(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.closest('.search-container')) {
			showResults = false;
			cancelSearch();
			selectedIndex = -1;
			keyboardSelected = false;
		}
	}

	function handleKeyDown(event: KeyboardEvent) {
		const isSearchFocused = document.activeElement === searchInputElement;

		if (!isSearchFocused && !showResults) {
			return;
		}

		switch (event.key) {
			case 'ArrowDown':
				if (!showResults || results.length === 0) return;
				event.preventDefault();
				selectedIndex = selectedIndex < results.length - 1 ? selectedIndex + 1 : 0;
				keyboardSelected = true;
				scrollToSelected();
				break;

			case 'ArrowUp':
				if (!showResults || results.length === 0) return;
				event.preventDefault();
				selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : results.length - 1;
				keyboardSelected = true;
				scrollToSelected();
				break;

			case 'Enter':
				if (!showResults) return;
				event.preventDefault();
				if (keyboardSelected && selectedIndex >= 0 && selectedIndex < results.length) {
					navigateToResult(results[selectedIndex]);
				} else {
					navigateToSearchPage();
				}
				break;

			case 'Escape':
				if (!showResults) return;
				event.preventDefault();
				showResults = false;
				cancelSearch();
				selectedIndex = -1;
				keyboardSelected = false;
				searchInputElement?.blur();
				break;

			case 'Tab':
				if (showResults) {
					showResults = false;
					cancelSearch();
					selectedIndex = -1;
					keyboardSelected = false;
				}
				break;
		}
	}

	function scrollToSelected() {
		requestAnimationFrame(() => {
			const selectedElement = resultsListElement?.querySelector(
				`[data-result-index="${selectedIndex}"]`
			) as HTMLElement | null;

			if (selectedElement) {
				selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
			}
		});
	}

	async function navigateToResult(result: SearchResult) {
		showResults = false;
		cancelSearch();
		selectedIndex = -1;
		keyboardSelected = false;
		searchQuery = '';
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- Result URLs are constructed with base above.
		await goto(result.url, { invalidateAll: true });
	}

	async function navigateToSearchPage() {
		const query = searchQuery.trim();
		showResults = false;
		cancelSearch();
		selectedIndex = -1;
		keyboardSelected = false;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- The resolved path is followed by a query string.
		await goto(`${resolve('/editions')}${query ? `?q=${encodeURIComponent(query)}` : ''}`, {
			invalidateAll: true
		});
	}

	function handleResultMouseEnter(index: number) {
		selectedIndex = index;
		keyboardSelected = false;
	}

	function handleDropdownWheel(event: WheelEvent) {
		if (!resultsListElement) return;
		event.preventDefault();
		resultsListElement.scrollTop += event.deltaY;
	}

	function getTypeLabel(type: SearchResultType): string {
		switch (type) {
			case 'edition':
				return 'Editions';
			case 'collection':
				return 'Collections';
			case 'content':
				return 'Resources';
		}
	}

	function getTypeIcon(type: SearchResultType): string {
		switch (type) {
			case 'edition':
				return 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4';
			case 'collection':
				return 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10';
			case 'content':
				return 'M4 3h16v18H4zM8 7h8M8 11h8M8 15h5';
		}
	}

	function getTypeColor(type: SearchResultType): string {
		switch (type) {
			case 'edition':
				return 'text-primary';
			case 'collection':
				return 'text-secondary';
			case 'content':
				return 'text-base-content';
		}
	}

	// Group results by type for display
	let groupedResults = $derived.by(() => {
		const groups: {
			type: SearchResultType;
			items: Array<SearchResult & { globalIndex: number }>;
		}[] = [];
		let currentType: SearchResultType | null = null;
		let globalIndex = 0;

		for (const result of results) {
			if (result.type !== currentType) {
				currentType = result.type;
				groups.push({ type: result.type, items: [] });
			}
			groups[groups.length - 1].items.push({ ...result, globalIndex });
			globalIndex++;
		}

		return groups;
	});
</script>

<svelte:window onclick={handleClickOutside} />

<div
	id="search"
	class="search-container relative"
	class:compact-on-mobile={compactOnMobile}
	class:mobile-open={mobileOpen}
	bind:this={containerElement}
>
	{#if compactOnMobile}
		<button
			type="button"
			class="mobile-search-toggle btn btn-square btn-ghost"
			aria-label={mobileOpen ? 'Close search' : 'Open search'}
			aria-expanded={mobileOpen}
			onclick={async () => {
				mobileOpen = !mobileOpen;
				if (mobileOpen) {
					await tick();
					searchInputElement?.focus();
				} else showResults = false;
			}}
		>
			<svg aria-hidden="true" class="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
				><path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
				/></svg
			>
		</button>
	{/if}
	<label
		bind:this={searchFieldElement}
		class="search-field input-bordered input flex items-center gap-2"
	>
		<svg class="h-5 w-5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
			/>
		</svg>
		<input
			type="text"
			bind:this={searchInputElement}
			bind:value={searchQuery}
			oninput={queryChanged}
			placeholder="Search editions, collections, resources…"
			aria-label="Search editions, collections and resources"
			class="grow border-none outline-none focus:ring-0 focus:outline-none"
			onfocus={openSearchResults}
			role="combobox"
			aria-expanded={showResults}
			aria-haspopup="listbox"
			aria-autocomplete="list"
			aria-controls="search-results"
		/>
		<span class="loading loading-xs loading-spinner" class:invisible={!searching}></span>
	</label>

	{#if showResults}
		<div
			bind:this={dropdownElement}
			id="search-results"
			class="card-compact card fixed z-50 overflow-hidden bg-base-100 shadow-xl"
			style="min-width: 300px; visibility: hidden;"
			role="listbox"
			onwheel={handleDropdownWheel}
		>
			<div class="card-body p-0">
				{#if searching && results.length === 0}
					<div class="flex items-center justify-center gap-2 p-4 text-sm opacity-70">
						<span class="loading loading-sm loading-spinner"></span>
						<span>Searching...</span>
					</div>
				{:else if results.length === 0}
					<div class="p-4 text-center text-sm opacity-70">
						{#if searchQuery.trim()}
							No results found for "{searchQuery}"
						{:else}
							No editions available
						{/if}
					</div>
				{:else}
					<div class="max-h-80 overflow-y-auto overscroll-contain" bind:this={resultsListElement}>
						{#each groupedResults as group (group.type)}
							<div
								class="sticky top-0 z-10 flex items-center gap-1.5 border-b border-base-200 bg-base-100 px-3 py-1.5 text-xs font-semibold tracking-wide text-base-content/60 uppercase"
							>
								<svg
									class="h-3 w-3 {getTypeColor(group.type)}"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d={getTypeIcon(group.type)}
									/>
								</svg>
								{!searchQuery.trim() && group.type === 'edition'
									? 'Explore editions'
									: getTypeLabel(group.type)}
							</div>
							{#each group.items as item (item.id)}
								{@const isSelected = selectedIndex === item.globalIndex}
								<button
									type="button"
									data-result-index={item.globalIndex}
									class="flex w-full items-center gap-3 px-3 py-2 text-left text-base-content transition-colors hover:bg-base-200 hover:text-base-content"
									class:bg-base-200={isSelected}
									onclick={() => navigateToResult(item)}
									onmouseenter={() => handleResultMouseEnter(item.globalIndex)}
									role="option"
									aria-selected={isSelected}
								>
									{#if item.thumbnail}
										<img
											src={item.thumbnail}
											alt=""
											class="h-10 w-10 shrink-0 rounded object-cover"
										/>
									{:else}
										<div
											class="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-base-300"
										>
											<svg
												class="h-5 w-5 opacity-50 {getTypeColor(item.type)}"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d={getTypeIcon(item.type)}
												/>
											</svg>
										</div>
									{/if}
									<div class="min-w-0 flex-1 overflow-hidden">
										<div class="truncate leading-tight font-medium">{item.title}</div>
										{#if item.subtitle}
											<div class="mt-0.5 truncate text-xs leading-tight opacity-60">
												{item.subtitle}
											</div>
										{/if}
									</div>
								</button>
							{/each}
						{/each}
					</div>
					<div class="border-t border-base-200 px-3 py-2 text-xs opacity-50">
						<kbd class="kbd kbd-xs">↑</kbd>
						<kbd class="kbd kbd-xs">↓</kbd> navigate
						<kbd class="ml-2 kbd kbd-xs">Enter</kbd> select
						<kbd class="ml-2 kbd kbd-xs">Esc</kbd> close
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.mobile-search-toggle {
		display: none;
	}
	@media (max-width: 650px) {
		.compact-on-mobile .mobile-search-toggle {
			display: inline-flex;
		}
		.compact-on-mobile .search-field {
			display: none;
		}
		.compact-on-mobile.mobile-open .search-field {
			display: flex;
			position: fixed;
			z-index: 50;
			top: calc(var(--header-height, 68px) + 8px);
			left: 16px;
			right: 16px;
			background: var(--color-base-100);
			box-shadow: 0 8px 24px #0002;
		}
	}
</style>
