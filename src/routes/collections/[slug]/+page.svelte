<script lang="ts">
	import ContentRenderer from '$lib/components/content/ContentRenderer.svelte';
	import { base, resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import EditionCard from '$lib/components/cards/EditionCard.svelte';
	import { authStore } from '$lib/database/stores/auth.svelte';
	import { pb } from '$lib/database/client';
	import { EditionStatus, GlobalRole, Permission, type UserRoleContext } from '$lib/types/roles';
	import { hasPermission } from '$lib/utils/permissions';
	import { resolvePageContext } from '$lib/utils/page-permissions';
	import { getEditionRoot, getEditionThumbnailUrl } from '$lib/utils/asset-urls';
	import { creditHref, creatorNames, readCredits } from '$lib/utils/credits';
	import toast from 'svelte-french-toast';
	import type { RecordModel } from 'pocketbase';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let collection = $derived(data.collection);
	let editions = $state(data.editions);

	let permissionContext = $state<UserRoleContext>({ globalRole: GlobalRole.User });
	let isCreating = $state(false);
	let isLoadingEditionManager = $state(false);
	let isUpdatingEdition = $state(false);
	let selectedEditionId = $state('');
	let availableEditions = $state<EditionOption[]>([]);
	let editionManagerLoaded = $state(false);
	let descriptionExpanded = $state(false);

	type EditionOption = {
		id: string;
		title: string;
		pubNum: number;
		status: string | null;
		collectionId: string;
		collectionTitle: string;
	};

	const DESCRIPTION_CLAMP_LENGTH = 320;

	function stripHtml(html: string): string {
		return html.replace(/<[^>]*>/g, '').trim();
	}

	let descriptionIsLong = $derived(
		stripHtml(collection.description).length > DESCRIPTION_CLAMP_LENGTH
	);

	let canEdit = $derived(hasPermission(permissionContext, Permission.CollectionEdit));
	let canCreateEdition = $derived(hasPermission(permissionContext, Permission.EditionCreate));
	let canManageEditions = $derived(canEdit);

	// Group editions by status for version-aware display
	let editionGroups = $derived.by(() => {
		const groups: Record<string, typeof editions> = {};
		for (const edition of editions) {
			const key = edition.status || 'Unknown';
			if (!groups[key]) groups[key] = [];
			groups[key].push(edition);
		}
		// Sort groups: want "published" or "current" first, then others
		const priority: Record<string, number> = { published: 0, current: 0, draft: 2, review: 1 };
		const sortedKeys = Object.keys(groups).sort((a, b) => {
			const pa = priority[a.toLowerCase()] ?? 3;
			const pb = priority[b.toLowerCase()] ?? 3;
			return pa - pb;
		});
		return sortedKeys.map((key) => ({ status: key, editions: groups[key] }));
	});

	// Latest edition (highest pubNum)
	let latestEdition = $derived(
		editions.length > 0
			? editions.reduce((a, b) => ((a.pubNum || 0) > (b.pubNum || 0) ? a : b))
			: null
	);

	onMount(async () => {
		if (!authStore.isAuthenticated || !authStore.appUserId) {
			permissionContext = { globalRole: authStore.globalRole };
			return;
		}

		permissionContext = await resolvePageContext({
			globalRole: authStore.globalRole,
			userProfileId: authStore.appUserId,
			collectionId: collection.id
		});
	});

	$effect(() => {
		if (canManageEditions && !editionManagerLoaded && !isLoadingEditionManager) {
			void loadEditionManager();
		}
	});

	function editionFromRecord(record: RecordModel) {
		const expandedCollection = record.expand?.collection as RecordModel | undefined;
		const collectionPubNum = expandedCollection?.pubNum || collection.pubNum || 0;
		const editionPubNum = record.pubNum || 1;

		return {
			id: record.id,
			slug: record.id,
			title: record.dcTitle || record.title,
			description: record.dcAbstract || '',
			authors: creatorNames(record.credits),
			credits: readCredits(record.credits),
			thumbnail:
				record.thumbnail && collectionPubNum > 0
					? getEditionThumbnailUrl(collectionPubNum, editionPubNum)
					: '',
			voyagerUrl: collectionPubNum > 0 ? getEditionRoot(collectionPubNum, editionPubNum) : '',
			usageConditions: record.dcRightsLicense || '',
			alternativeVersion: null,
			tags: Array.isArray(record.dcKeyword) ? record.dcKeyword : [],
			created: record.created,
			hasPeerReview: !!record.peerReviewKind && record.peerReviewKind !== 'No peer review',
			pubNum: editionPubNum,
			modelSize: record.modelSize || null,
			status: record.status || null,
			isPublished: !!record.isPublished,
			dcDoi: Array.isArray(record.dcDoi) ? record.dcDoi : [],
			coverImage: record.coverImage || ''
		};
	}

	function editionOptionFromRecord(record: RecordModel): EditionOption {
		const expandedCollection = record.expand?.collection as RecordModel | undefined;
		return {
			id: record.id,
			title: record.dcTitle || record.title || 'Untitled Edition',
			pubNum: record.pubNum || 0,
			status: record.status || null,
			collectionId: record.collection || '',
			collectionTitle: expandedCollection?.title || ''
		};
	}

	async function loadEditionManager() {
		isLoadingEditionManager = true;
		editionManagerLoaded = true;
		try {
			const [collectionEditionsResult, allEditionsResult] = await Promise.all([
				pb.collection('editions').getFullList({
					sort: 'pubNum,title',
					filter: `collection = "${collection.id}"`,
					expand: 'collection'
				}),
				pb.collection('editions').getFullList({
					sort: 'pubNum,title',
					expand: 'collection'
				})
			]);

			editions = collectionEditionsResult.map(editionFromRecord) as typeof editions;
			availableEditions = allEditionsResult
				.filter((record) => record.collection !== collection.id)
				.map(editionOptionFromRecord);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to load editable editions');
		} finally {
			isLoadingEditionManager = false;
		}
	}

	async function addEditionToCollection() {
		if (!selectedEditionId) return;

		isUpdatingEdition = true;
		try {
			await pb.collection('editions').update(selectedEditionId, { collection: collection.id });
			selectedEditionId = '';
			await loadEditionManager();
			toast.success('Edition added to collection');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to add edition');
		} finally {
			isUpdatingEdition = false;
		}
	}

	async function removeEditionFromCollection(editionId: string) {
		if (!confirm('Remove this edition from the collection?')) return;

		isUpdatingEdition = true;
		try {
			await pb.collection('editions').update(editionId, { collection: null });
			await loadEditionManager();
			toast.success('Edition removed from collection');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to remove edition');
		} finally {
			isUpdatingEdition = false;
		}
	}

	async function createEdition() {
		isCreating = true;
		try {
			const record = await pb.collection('editions').create({
				title: 'Untitled Edition',
				dcTitle: 'Untitled Edition',
				collection: collection.id,
				status: EditionStatus.Draft,
				isPublished: false
			});

			goto(resolve('/editions/[slug]/workflow', { slug: record.id }));
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to create edition');
		} finally {
			isCreating = false;
		}
	}
</script>

<svelte:head>
	<title>{collection.title} | Pure 3D</title>
	<meta name="description" content={collection.description} />
</svelte:head>

<div class="container mx-auto max-w-7xl px-4 py-12">
	<!-- Collection Header -->
	<div class="mb-12">
		<nav class="breadcrumbs mb-6 text-sm">
			<ul>
				<li>
					<a href={resolve('/')} data-sveltekit-preload-data="hover" class="link link-hover">Home</a
					>
				</li>
				<li>
					<a
						href={resolve('/collections')}
						data-sveltekit-preload-data="hover"
						class="link link-hover">Collections</a
					>
				</li>
				<li class="text-base-content/70">{collection.title}</li>
			</ul>
		</nav>

		<div
			class="relative grid gap-8 md:grid-cols-[minmax(0,320px)_1fr] md:items-start md:gap-10 lg:gap-14"
		>
			<!-- Cover -->
			<figure class="ds-card-frame aspect-square w-full p-3 md:sticky md:top-24">
				<div class="relative h-full w-full overflow-hidden rounded-lg bg-base-200">
					{#if collection.thumbnail}
						<img
							src={collection.thumbnail}
							alt={collection.title}
							class="h-full w-full object-cover"
							loading="eager"
						/>
					{:else}
						<div class="flex h-full w-full items-center justify-center text-base-content/20">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-24 w-24"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="1.25"
									d="M4.5 4.5h15v15h-15z M4.5 15l4-4 4 4 3-3 4 4"
								/>
							</svg>
						</div>
					{/if}
					{#if collection.isVisible === false}
						<div
							class="absolute top-3 right-3 rounded-md border border-red-800 bg-red-700 px-2 py-1 text-[11px] font-semibold tracking-wide text-white uppercase shadow-sm"
							style="color: white;"
							title="This collection is hidden and not visible to public visitors"
						>
							Not public
						</div>
					{/if}
				</div>
			</figure>

			<!-- Info column -->
			<div class="flex min-w-0 flex-col">
				{#if canEdit}
					<div
						class="mb-3 flex flex-wrap justify-end gap-2 md:absolute md:top-0 md:right-0 md:z-10 md:mb-0"
					>
						<a
							href={resolve('/collections/[slug]/edit', { slug: collection.id })}
							class="btn btn-outline btn-sm"
						>
							Manage
						</a>
					</div>
				{/if}

				<div class="mb-4 flex flex-wrap items-start gap-3 md:pr-24">
					<h1 class="text-3xl leading-tight font-bold md:text-4xl lg:text-5xl">
						{collection.title}
					</h1>
				</div>

				<!-- Creators byline -->
				{#each ['creator', 'contributor'] as role (role)}
					{@const credits = collection.credits.filter((credit) => credit.role === role)}
					{#if credits.length}
						<p class="mb-3 text-sm text-base-content/70">
							<span class="text-base-content/50"
								>{role === 'creator' ? 'Creators:' : 'Contributors:'}</span
							>
							{#each credits as credit, index (credit)}
								{@const href = creditHref(credit, base)}
								{#if href}<a
										class="link link-hover"
										{href}
										rel={credit.userId ? undefined : 'external noopener noreferrer'}
										>{credit.name}</a
									>{:else}{credit.name}{/if}{credit.contributionRole
									? ` (${credit.contributionRole})`
									: ''}{index < credits.length - 1 ? '; ' : ''}
							{/each}
						</p>
					{/if}
				{/each}

				<!-- Meta chips -->
				<div class="mb-5 flex flex-wrap items-center gap-2 text-sm">
					<span class="badge badge-ghost">
						{editions.length}
						{editions.length === 1 ? 'edition' : 'editions'}
					</span>
					{#if collection.dcCoveragePeriod}
						<span class="badge badge-outline">{collection.dcCoveragePeriod}</span>
					{/if}
					{#if collection.dcCoveragePlace}
						<span class="badge badge-outline">{collection.dcCoveragePlace}</span>
					{/if}
					{#each collection.dcLanguage as lang (lang)}
						<span class="badge badge-outline">{lang}</span>
					{/each}
				</div>

				{#if collection.description}
					<div class="relative">
						<div
							class="prose max-w-prose text-base leading-relaxed text-base-content/80"
							class:line-clamp-6={descriptionIsLong && !descriptionExpanded}
						>
							<ContentRenderer className="contents" content={collection.description} />
						</div>
						{#if descriptionIsLong}
							<button
								type="button"
								class="mt-2 text-sm font-medium text-primary hover:underline"
								onclick={() => (descriptionExpanded = !descriptionExpanded)}
							>
								{descriptionExpanded ? 'Show less' : 'Show more'}
							</button>
						{/if}
					</div>
				{/if}

				{#if collection.dcInstitution.length > 0}
					<p class="mt-4 text-sm text-base-content/60">
						<span class="text-xs font-semibold tracking-wider text-base-content/50 uppercase">
							Institutions
						</span>
						<br />
						{collection.dcInstitution.join(', ')}
					</p>
				{/if}

				{#if collection.dcSubject.length > 0}
					<div class="mt-5 flex flex-wrap gap-1.5">
						{#each collection.dcSubject as subject (subject)}
							<span class="badge badge-sm badge-neutral">{subject}</span>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>

	<!-- Editions Section -->
	<div class="mb-8">
		<div class="mb-6 flex flex-wrap items-center justify-between gap-3">
			<h2 class="text-2xl font-semibold">Editions</h2>
			<div class="flex flex-wrap items-center gap-2">
				{#if canManageEditions}
					<button
						type="button"
						class="btn btn-ghost btn-sm"
						onclick={loadEditionManager}
						disabled={isLoadingEditionManager || isUpdatingEdition}
					>
						{#if isLoadingEditionManager}
							<span class="loading loading-xs loading-spinner"></span>
						{/if}
						Refresh editions
					</button>
				{/if}
				{#if canCreateEdition}
					<button class="btn btn-sm btn-primary" onclick={createEdition} disabled={isCreating}>
						{#if isCreating}
							<span class="loading loading-xs loading-spinner"></span>
						{/if}
						+ New Edition
					</button>
				{/if}
			</div>
		</div>

		{#if canManageEditions}
			<div class="mb-6 rounded-box border border-base-300 bg-base-100 p-4 shadow-sm">
				<div class="flex flex-col gap-3 md:flex-row md:items-end">
					<div class="form-control flex-1">
						<label class="label pb-1" for="edition-to-add">
							<span class="label-text font-medium">Add existing edition</span>
						</label>
						<select
							id="edition-to-add"
							class="select-bordered select w-full"
							bind:value={selectedEditionId}
							disabled={isLoadingEditionManager ||
								isUpdatingEdition ||
								availableEditions.length === 0}
						>
							<option value="">
								{availableEditions.length === 0
									? 'No editions available to add'
									: 'Select an edition'}
							</option>
							{#each availableEditions as edition (edition.id)}
								<option value={edition.id}>
									{edition.pubNum
										? `Ed. ${String(edition.pubNum).padStart(2, '0')} · `
										: ''}{edition.title}{edition.collectionTitle
										? ` · currently in ${edition.collectionTitle}`
										: ' · unassigned'}
								</option>
							{/each}
						</select>
						<p class="mt-1 text-xs text-base-content/50">
							Adding an edition that is already in another collection will move it here.
						</p>
					</div>
					<button
						type="button"
						class="btn btn-primary"
						onclick={addEditionToCollection}
						disabled={!selectedEditionId || isUpdatingEdition}
					>
						{#if isUpdatingEdition}
							<span class="loading loading-xs loading-spinner"></span>
						{/if}
						Add to Collection
					</button>
				</div>
			</div>
		{/if}

		{#if editions.length > 0}
			<!-- Version summary -->
			{#if latestEdition && latestEdition.pubNum > 1}
				<div class="mb-4 text-sm text-base-content/60">
					{editions.length} editions · Latest: Ed. {String(latestEdition.pubNum).padStart(2, '0')} ·
					<a
						href={resolve('/editions/[slug]', { slug: latestEdition.id })}
						data-sveltekit-preload-data="hover"
						class="link link-hover"
					>
						{latestEdition.title}
					</a>
				</div>
			{/if}

			<!-- Grouped by status -->
			{#if editionGroups.length > 1}
				{#each editionGroups as group (group.status)}
					<div class="mb-6">
						<h3
							class="mb-3 flex items-center gap-2 text-sm font-semibold tracking-wider text-base-content/50 uppercase"
						>
							{group.status}
							<span class="badge badge-sm">{group.editions.length}</span>
						</h3>
						<div
							class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
						>
							{#each group.editions as edition (edition.id)}
								<EditionCard
									{edition}
									onRemove={canManageEditions
										? () => removeEditionFromCollection(edition.id)
										: undefined}
									removeDisabled={isUpdatingEdition}
								/>
							{/each}
						</div>
					</div>
				{/each}
			{:else}
				<div
					class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
				>
					{#each editions as edition (edition.id)}
						<EditionCard
							{edition}
							onRemove={canManageEditions
								? () => removeEditionFromCollection(edition.id)
								: undefined}
							removeDisabled={isUpdatingEdition}
						/>
					{/each}
				</div>
			{/if}
		{:else}
			<div
				class="rounded-lg border border-dashed border-base-300 bg-base-200/40 px-4 py-8 text-center text-sm text-base-content/60"
			>
				No editions available in this collection yet.
			</div>
		{/if}
	</div>

	<!-- Back Button -->
	<div class="mt-12 flex justify-center">
		<a
			href={resolve('/collections')}
			data-sveltekit-preload-data="hover"
			class="btn btn-outline btn-lg"
		>
			← Back to Collections
		</a>
	</div>
</div>
