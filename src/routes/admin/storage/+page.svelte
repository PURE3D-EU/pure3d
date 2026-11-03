<script lang="ts">
	import { onMount } from 'svelte';
	import { pb } from '$lib/database/client';
	import { authStore } from '$lib/database/stores/auth.svelte';
	import FloatingSelect from '$lib/components/ui/FloatingSelect.svelte';
	import { GlobalRole } from '$lib/types/roles';
	import toast from 'svelte-french-toast';
	import {
		filterStorageObjects,
		getStorageSummary,
		legacyStoragePage,
		type StorageObject,
		type StorageSort
	} from '$lib/utils/storage-dashboard';

	interface StorageResponse {
		bucket: string;
		objects: StorageObject[];
		hasMore: boolean;
		nextCursor: string;
		scanBounded: boolean;
		limitation: string;
	}

	const pageSize = 25;
	const sizeOptions = [
		{ value: 'all', label: 'Any size' },
		{ value: 'small', label: 'Under 1 MB' },
		{ value: 'medium', label: '1 MB to 10 MB' },
		{ value: 'large', label: '10 MB to 100 MB' },
		{ value: 'huge', label: '100 MB and above' }
	];
	const sortOptions = [
		{ value: 'modified-desc', label: 'Recently modified' },
		{ value: 'size-desc', label: 'Largest first' },
		{ value: 'size-asc', label: 'Smallest first' },
		{ value: 'key-asc', label: 'Name A-Z' }
	];

	let bucket = $state('');
	let objects = $state<StorageObject[]>([]);
	let loading = $state(true);
	let refreshing = $state(false);
	let downloadingKey = $state('');
	let errorMessage = $state('');
	let query = $state('');
	let sizeFilter = $state('all');
	let sort = $state<StorageSort>('modified-desc');
	let prefix = $state('');
	let prefixDraft = $state('');
	let cursor = $state('');
	let nextCursor = $state('');
	let cursorHistory = $state<string[]>([]);
	let hasMore = $state(false);
	let scanLimitation = $state('');

	let sizeRange = $derived.by(() => {
		if (sizeFilter === 'small') return [0, 1024 ** 2 - 1];
		if (sizeFilter === 'medium') return [1024 ** 2, 10 * 1024 ** 2 - 1];
		if (sizeFilter === 'large') return [10 * 1024 ** 2, 100 * 1024 ** 2 - 1];
		if (sizeFilter === 'huge') return [100 * 1024 ** 2, Infinity];
		return [0, Infinity];
	});
	let filteredObjects = $derived(
		filterStorageObjects(objects, {
			query,
			minSize: sizeRange[0],
			maxSize: sizeRange[1],
			sort
		})
	);
	let summary = $derived(getStorageSummary(objects));
	let visibleObjects = $derived(filteredObjects);
	let hasFilters = $derived(Boolean(query || sizeFilter !== 'all'));

	onMount(() => {
		if (authStore.globalRole === GlobalRole.Admin) void loadObjects();
	});

	async function loadObjects(refresh = false, targetCursor = cursor): Promise<boolean> {
		if (refresh) refreshing = true;
		else loading = true;
		errorMessage = '';
		try {
			const response = await pb.send<StorageResponse>('/api/pure3d/storage', {
				query: { prefix, cursor: targetCursor, limit: pageSize }
			});
			if (typeof response.hasMore !== 'boolean' || typeof response.nextCursor !== 'string') {
				Object.assign(
					response,
					legacyStoragePage(response.objects, prefix, targetCursor, pageSize)
				);
				response.scanBounded = false;
				response.limitation =
					'The server storage hook is awaiting its update. Inventory is paginated locally; each request still retrieves the full inventory.';
			}
			bucket = response.bucket;
			objects = response.objects;
			cursor = targetCursor;
			nextCursor = response.nextCursor;
			hasMore = response.hasMore;
			scanLimitation = response.scanBounded ? '' : response.limitation;
			return true;
		} catch (error) {
			console.error('Failed to load storage:', error);
			errorMessage = 'Storage could not be loaded. Check the PocketBase storage connection.';
			toast.error('Failed to load storage');
			return false;
		} finally {
			loading = false;
			refreshing = false;
		}
	}

	async function downloadObject(object: StorageObject) {
		downloadingKey = object.key;
		try {
			const response = await fetch(
				`${pb.baseUrl}/api/pure3d/storage/download?key=${encodeURIComponent(object.key)}`,
				{ headers: { Authorization: pb.authStore.token } }
			);
			if (!response.ok) throw new Error(`Download failed (${response.status})`);
			const url = URL.createObjectURL(await response.blob());
			const link = document.createElement('a');
			link.href = url;
			link.download = object.key.split('/').pop() || 'download';
			link.click();
			URL.revokeObjectURL(url);
		} catch (error) {
			console.error('Failed to download object:', error);
			toast.error('Failed to download object');
		} finally {
			downloadingKey = '';
		}
	}

	async function applyPrefix() {
		prefix = prefixDraft.trim();
		cursorHistory = [];
		await loadObjects(false, '');
	}

	async function nextPage() {
		if (!nextCursor) return;
		const previousCursor = cursor;
		if (await loadObjects(false, nextCursor)) cursorHistory = [...cursorHistory, previousCursor];
	}

	async function previousPage() {
		const previousCursor = cursorHistory.at(-1);
		if (previousCursor === undefined) return;
		if (await loadObjects(false, previousCursor)) cursorHistory = cursorHistory.slice(0, -1);
	}

	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		const units = ['KB', 'MB', 'GB', 'TB'];
		let value = bytes / 1024;
		let unit = 0;
		while (value >= 1024 && unit < units.length - 1) {
			value /= 1024;
			unit++;
		}
		return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`;
	}

	function formatDate(value: string): string {
		return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
			new Date(value)
		);
	}
</script>

<div id="admin-storage-page" class="mx-auto max-w-7xl">
	<header class="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
		<div>
			<p class="mb-2 text-xs font-semibold tracking-[0.18em] text-primary uppercase">
				{bucket || 'Object storage'}
			</p>
			<h1 class="text-3xl font-bold">Storage Management</h1>
			<p class="mt-2 max-w-2xl text-base-content/60">
				Find, inspect and download files from the connected S3 bucket.
			</p>
			<p class="mt-2 max-w-2xl text-sm text-base-content/60">
				Deletion is disabled to prevent removing files that have changed since the inventory was
				loaded.
			</p>
		</div>
		<button
			type="button"
			class="btn gap-2 btn-outline btn-sm"
			onclick={() => loadObjects(true)}
			disabled={loading || refreshing}
		>
			{#if refreshing}<span class="loading loading-xs loading-spinner"></span>{/if}
			Refresh inventory
		</button>
	</header>

	<section aria-label="Storage overview" class="mb-6 grid gap-4 sm:grid-cols-2">
		<div class="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
			<p class="text-sm text-base-content/60">Objects</p>
			<p class="mt-1 text-3xl font-semibold tabular-nums">{summary.count.toLocaleString()}</p>
			<p class="mt-2 text-xs text-base-content/45">Loaded page; {filteredObjects.length} visible</p>
		</div>
		<div class="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
			<p class="text-sm text-base-content/60">Total stored</p>
			<p class="mt-1 text-3xl font-semibold tabular-nums">{formatSize(summary.size)}</p>
			<p class="mt-2 text-xs text-base-content/45">Across this loaded page only</p>
		</div>
	</section>
	{#if scanLimitation}
		<div class="mb-6 alert text-sm" role="note"><span>{scanLimitation}</span></div>
	{/if}

	<section class="mb-6 rounded-box border border-base-300 bg-base-100 p-4 shadow-sm">
		<form
			class="mb-4 flex items-end gap-2"
			onsubmit={(event) => {
				event.preventDefault();
				void applyPrefix();
			}}
		>
			<label class="form-control grow">
				<span class="label pt-0 pb-1"><span class="label-text text-xs">Storage prefix</span></span>
				<input
					class="input-bordered input w-full font-mono"
					placeholder="project/"
					bind:value={prefixDraft}
				/>
			</label>
			<button type="submit" class="btn btn-outline">Load prefix</button>
		</form>
		<p class="mb-4 text-xs text-base-content/50">
			Search, totals, size filters, and sorting apply only to the loaded page{prefix
				? ` under ${prefix}`
				: ''}.
		</p>
		<div class="grid gap-3 xl:grid-cols-[minmax(16rem,1fr)_13rem_13rem_auto] xl:items-end">
			<label class="form-control">
				<span class="label pt-0 pb-1"
					><span class="label-text text-xs">Search object key</span></span
				>
				<input
					type="search"
					placeholder="project/12/edition/..."
					class="input-bordered input w-full bg-base-200/40"
					bind:value={query}
				/>
			</label>
			<label class="form-control">
				<span class="label pt-0 pb-1"><span class="label-text text-xs">File size</span></span>
				<FloatingSelect
					id="storage-size-filter"
					value={sizeFilter}
					options={sizeOptions}
					onchange={(value) => {
						sizeFilter = value;
					}}
				/>
			</label>
			<label class="form-control">
				<span class="label pt-0 pb-1"><span class="label-text text-xs">Sort</span></span>
				<FloatingSelect
					id="storage-sort"
					value={sort}
					options={sortOptions}
					onchange={(value) => {
						sort = value as StorageSort;
					}}
				/>
			</label>
			{#if hasFilters}
				<button
					type="button"
					class="btn btn-ghost btn-sm"
					onclick={() => {
						query = '';
						sizeFilter = 'all';
					}}>Clear</button
				>
			{/if}
		</div>
	</section>

	{#if loading}
		<div class="flex items-center justify-center py-16" aria-label="Loading storage">
			<span class="loading loading-lg loading-spinner"></span>
		</div>
	{:else if errorMessage}
		<div class="alert alert-error"><span>{errorMessage}</span></div>
	{:else if filteredObjects.length === 0}
		<div class="rounded-box border border-dashed border-base-300 py-16 text-center">
			<p class="font-medium">No objects match these filters</p>
			<p class="mt-1 text-sm text-base-content/50">Clear the filters or refresh the inventory.</p>
		</div>
	{:else}
		<div
			class="hidden overflow-x-auto rounded-box border border-base-300 bg-base-100 shadow-sm xl:block"
		>
			<table class="table">
				<thead
					><tr
						><th>Object key</th><th class="text-right">Size</th><th>Modified</th><th
							><span class="sr-only">Actions</span></th
						></tr
					></thead
				>
				<tbody>
					{#each visibleObjects as object (object.key)}
						<tr>
							<td class="max-w-xl"
								><span class="block truncate font-mono text-xs" title={object.key}
									>{object.key}</span
								></td
							>
							<td class="text-right font-mono text-xs tabular-nums">{formatSize(object.size)}</td>
							<td class="text-sm whitespace-nowrap text-base-content/60"
								>{formatDate(object.modified)}</td
							>
							<td>
								<div class="flex justify-end gap-1">
									<button
										type="button"
										class="btn btn-ghost btn-xs"
										onclick={() => downloadObject(object)}
										disabled={downloadingKey === object.key}
										>{downloadingKey === object.key ? 'Preparing...' : 'Download'}</button
									>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="space-y-3 xl:hidden">
			{#each visibleObjects as object (object.key)}
				<article class="rounded-box border border-base-300 bg-base-100 p-4 shadow-sm">
					<p class="font-mono text-xs leading-relaxed break-all">{object.key}</p>
					<div class="mt-3 flex justify-between text-xs text-base-content/55">
						<span>{formatSize(object.size)}</span><span>{formatDate(object.modified)}</span>
					</div>
					<div class="mt-4 flex gap-2">
						<button
							type="button"
							class="btn btn-outline btn-sm"
							onclick={() => downloadObject(object)}
							disabled={downloadingKey === object.key}>Download</button
						>
					</div>
				</article>
			{/each}
		</div>

		{#if cursorHistory.length > 0 || hasMore}
			<nav class="mt-6 flex items-center justify-between gap-4" aria-label="Storage pages">
				<p class="text-sm text-base-content/50">Loaded page {cursorHistory.length + 1}</p>
				<div class="join">
					<button
						type="button"
						class="btn join-item btn-sm"
						onclick={previousPage}
						disabled={cursorHistory.length === 0}>Previous</button
					>
					<button type="button" class="btn join-item btn-sm" onclick={nextPage} disabled={!hasMore}
						>Next</button
					>
				</div>
			</nav>
		{/if}
	{/if}
</div>
