<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- Internal routes use resolve; attachment and WordPress source URLs are absolute. */
	import { getContext, onMount } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { page } from '$app/stores';
	import { base, resolve } from '$app/paths';
	import { pb } from '$lib/database/client';
	import { authStore } from '$lib/database/stores/auth.svelte';
	import RichTextEditor from '$lib/components/ui/RichTextEditor.svelte';
	import { contentKinds, contentSections, kindLabels } from '$lib/content';
	import { cleanContent } from '$lib/utils/content-html';
	import { ClientResponseError, type RecordModel } from 'pocketbase';
	import toast from 'svelte-french-toast';
	import { contentPath, validParent, orderedPages, move } from '$lib/cms';
	import { refreshMenus } from '$lib/stores/navigation';
	const contentActions = getContext<{
		register: (action: (() => void) | null) => void;
	}>('admin-content-actions');
	let { kindFilter = '' }: { kindFilter?: 'page' | 'post' | '' } = $props();
	let layout = $state('standard'),
		parent = $state(''),
		order = $state(0),
		categoryIds = $state<string[]>([]),
		categoryOptions = $state<RecordModel[]>([]),
		cmsEditions = $state<{ id: string; title: string }[]>([]),
		cmsOpenCalls = $state<{ id: string; title: string }[]>([]),
		library = $state<RecordModel[]>([]),
		showLibrary = $state(false);
	let dragId = $state('');
	let notes = $state('');
	let libraryQuery = $state('');
	let matchingMedia = $derived(
		library.filter((asset) =>
			`${asset.file} ${asset.caption || ''} ${asset.alt || ''}`
				.toLowerCase()
				.includes(libraryQuery.toLowerCase())
		)
	);
	let items = $state<RecordModel[]>([]),
		selected = $state<RecordModel | null>(null);
	let parentOptions = $derived(
		items.filter(
			(r) =>
				r.id !== selected?.id &&
				r.kind === 'page' &&
				r.layout === layout &&
				validParent(items, selected?.id || '', r.id, layout)
		)
	);
	let query = $state(''),
		kind = $state(''),
		status = $state(''),
		failure = $state('');
	let title = $state(''),
		slug = $state(''),
		summary = $state(''),
		body = $state(''),
		author = $state(''),
		publishedAt = $state(''),
		coverUrl = $state(''),
		section = $state('resources'),
		formKind = $state('page'),
		isPublished = $state(false),
		learningMaterial = $state(false),
		learningMaterialOrder = $state(0);
	let learningMaterialsOnly = $derived(
		$page.url.searchParams.get('filter') === 'learning-materials'
	);
	let saving = $state(false),
		loading = $state(true),
		dirty = $state(false),
		assets = $state<RecordModel[]>([]);
	let filtered = $derived(
		items.filter(
			(i) =>
				(!kindFilter || i.kind === kindFilter) &&
				(!learningMaterialsOnly || i.learningMaterial) &&
				(!kind || i.kind === kind) &&
				(!status || (status === 'published') === i.isPublished) &&
				`${i.title} ${i.slug}`.toLowerCase().includes(query.toLowerCase())
		)
	);
	let allowed = $derived(authStore.globalRole === 'admin');
	let filteredOrder = $derived(Boolean(query || kind || status));
	let openCallsUnavailable = $state(false);
	async function load() {
		loading = true;
		failure = '';
		openCallsUnavailable = false;
		try {
			const [content, categories, media, editions, openCalls] = await Promise.all([
				pb.collection('content').getFullList({ sort: '-updated' }),
				pb.collection('cms_categories').getFullList({ sort: 'name' }),
				pb.collection('content_assets').getFullList(),
				pb.collection('editions').getFullList({
					filter: 'isPublished = true',
					fields: 'id,title,dcTitle',
					sort: 'dcTitle,title'
				}),
				pb
					.collection('open_calls')
					.getFullList({
						filter: 'isPublished = true',
						fields: 'id,title',
						sort: 'order,title'
					})
					.catch((error: unknown) => {
						// Older/local databases may not have the optional Open calls migration yet.
						// Keep pages editable, but do not hide permission or connectivity failures.
						if (!(error instanceof ClientResponseError) || error.status !== 404) throw error;
						openCallsUnavailable = true;
						return [];
					})
			]);
			items = content;
			categoryOptions = categories;
			library = media;
			cmsEditions = editions.map((edition) => ({
				id: edition.id,
				title: edition.dcTitle || edition.title || 'Untitled edition'
			}));
			cmsOpenCalls = openCalls.map((call) => ({ id: call.id, title: call.title }));
		} catch (e) {
			failure = e instanceof Error ? e.message : 'Could not load content';
		} finally {
			loading = false;
		}
	}
	function reset() {
		selected = null;
		dirty = false;
	}
	async function edit(item: RecordModel) {
		if (dirty && !confirm('Discard unsaved changes?')) return;
		selected = item;
		title = item.title;
		slug = item.slug;
		summary = item.summary || '';
		notes = item.importNotes || '';
		body = cleanContent(item.body || '');
		author = item.author || '';
		publishedAt = item.publishedAt?.slice(0, 10) || '';
		coverUrl = item.coverUrl || '';
		section = item.section;
		formKind = item.kind;
		isPublished = item.isPublished;
		learningMaterial = Boolean(item.learningMaterial);
		learningMaterialOrder = item.learningMaterialOrder || 0;
		layout = item.layout;
		parent = item.parent || '';
		order = item.order || 0;
		categoryIds = [...(item.categoryIds || [])];
		dirty = false;
		assets = [];
		try {
			const loaded = await pb
				.collection('content_assets')
				.getFullList({ filter: pb.filter('content = {:id}', { id: item.id }) });
			if (selected?.id === item.id) assets = loaded;
		} catch {
			toast.error('Could not load attachments. Please reopen the page to retry.');
		}
	}
	async function create() {
		if (dirty && !confirm('Discard unsaved changes?')) return;
		const newKind = kindFilter || 'page';
		saving = true;
		try {
			const row = await pb.collection('content').create({
				title: `Untitled ${newKind}`,
				slug: `draft-${crypto.randomUUID()}`,
				kind: newKind,
				layout: newKind === 'post' ? 'article' : 'standard',
				section: 'resources',
				learningMaterial: learningMaterialsOnly,
				learningMaterialOrder:
					Math.max(
						-1,
						...items
							.filter((item) => item.learningMaterial)
							.map((item) => item.learningMaterialOrder || 0)
					) + 1,
				isPublished: false
			});
			items = [row, ...items];
			dirty = false;
			await edit(row);
			toast.success('Draft created');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not create draft');
		} finally {
			saving = false;
		}
	}
	async function save() {
		if (!allowed || saving) return;
		if (!title.trim() || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
			toast.error('Enter a title and a lowercase URL slug (letters, numbers, hyphens).');
			return;
		}
		saving = true;
		if (formKind === 'page' && !validParent(items, selected?.id || '', parent, layout)) {
			toast.error('Choose a parent page with the same layout, without creating a cycle.');
			saving = false;
			return;
		}
		try {
			const payload = {
				title: title.trim(),
				slug,
				summary,
				importNotes: notes,
				body: cleanContent(body),
				author,
				publishedAt: publishedAt
					? selected?.publishedAt?.slice(0, 10) === publishedAt
						? selected.publishedAt
						: `${publishedAt}T00:00:00Z`
					: '',
				coverUrl,
				section,
				kind: formKind,
				layout: formKind === 'post' ? 'article' : layout,
				parent: formKind === 'post' ? '' : parent,
				order,
				categoryIds: formKind === 'post' ? categoryIds : [],
				isPublished,
				learningMaterial: formKind === 'page' && learningMaterial,
				learningMaterialOrder
			};
			const row = selected
				? await pb.collection('content').update(selected.id, payload, {
						headers: { 'X-Pure3D-Content-Version': selected.updated }
					})
				: await pb.collection('content').create(payload);
			dirty = false;
			await load();
			await edit(row);
			await refreshMenus();
			toast.success('Content saved');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Save failed');
		} finally {
			saving = false;
		}
	}
	async function upload(file: File) {
		if (!selected) throw new Error('Save your draft before adding media.');
		const form = new FormData();
		form.set('content', selected.id);
		form.set('file', file);
		const row = await pb.collection('content_assets').create(form);
		assets = [...assets, row];
		return pb.files.getURL(row, row.file);
	}
	async function chooseMedia(event: Event, cover = false) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			const url = await upload(file);
			if (cover) {
				coverUrl = url;
				dirty = true;
			}
			toast.success(cover ? 'Cover ready — save to apply' : 'Media uploaded');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Upload failed');
		} finally {
			input.value = '';
		}
	}
	async function remove() {
		if (selected && items.some((i) => i.parent === selected?.id)) {
			toast.error('Move or delete child pages first.');
			return;
		}
		if (
			!selected ||
			!confirm(
				`Delete “${selected.title}”? Media stays in the library for other pages. This cannot be undone.`
			)
		)
			return;
		try {
			await pb.collection('content').delete(selected.id);
			reset();
			await load();
			toast.success('Content deleted');
			await refreshMenus();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Delete failed');
		}
	}
	beforeNavigate(({ cancel }) => {
		if (dirty && !confirm('Discard unsaved changes?')) cancel();
	});
	onMount(() => {
		contentActions.register(create);
		void (async () => {
			if (!allowed) return;
			await load();
			const id = $page.url.searchParams.get('edit');
			const item = items.find((i) => i.id === id);
			if (item) await edit(item);
		})();
		return () => contentActions.register(null);
	});
	let reordering = $state(false);
	let pendingOrder: { entries: RecordModel[]; field: string } | null = null;
	async function reorder(id: string, targetId: string) {
		if (!allowed || saving || filteredOrder || id === targetId) return;
		const source = items.find((i) => i.id === id),
			target = items.find((i) => i.id === targetId);
		if (
			!source ||
			!target ||
			source.kind !== 'page' ||
			target.kind !== 'page' ||
			(learningMaterialsOnly
				? !source.learningMaterial || !target.learningMaterial
				: source.parent !== target.parent || source.layout !== target.layout)
		) {
			toast.error('Reorder pages within the same parent and layout.');
			return;
		}
		const siblings = reorderSiblings(source);
		const next = move(
			siblings,
			siblings.findIndex((i) => i.id === id),
			siblings.findIndex((i) => i.id === targetId)
		);
		const orderField = learningMaterialsOnly ? 'learningMaterialOrder' : 'order';
		const positions = new Map(next.map((item, index) => [item.id, index]));
		items = items.map((item) =>
			positions.has(item.id) ? { ...item, [orderField]: positions.get(item.id) } : item
		);
		pendingOrder = { entries: next, field: orderField };
		if (reordering) return;
		reordering = true;
		try {
			while (pendingOrder) {
				const batch = pendingOrder;
				pendingOrder = null;
				const updates = await Promise.allSettled(
					batch.entries.map((item, index) =>
						pb.collection('content').update(item.id, { [batch.field]: index })
					)
				);
				if (updates.some((result) => result.status === 'rejected')) {
					throw new Error('Order save failed');
				}
			}
		} catch {
			pendingOrder = null;
			toast.error('Could not save the order. Reloading the saved positions.');
			await load();
		} finally {
			reordering = false;
		}
	}
	let displayed = $derived<(RecordModel & { depth: number })[]>(
		learningMaterialsOnly
			? [...filtered]
					.sort(
						(a, b) =>
							(a.learningMaterialOrder || 0) - (b.learningMaterialOrder || 0) ||
							a.title.localeCompare(b.title)
					)
					.map((item) => ({ ...item, depth: 0 }))
			: kindFilter === 'page' && !query && !kind && !status
				? orderedPages(items.filter((i) => i.kind === 'page')).map((r) => ({
						...r.item,
						depth: r.depth
					}))
				: filtered.map((item) => ({ ...item, depth: 0 }))
	);
	function reorderSiblings(item: RecordModel) {
		const orderField = learningMaterialsOnly ? 'learningMaterialOrder' : 'order';
		return items
			.filter(
				(i) =>
					i.kind === 'page' &&
					(learningMaterialsOnly
						? i.learningMaterial
						: i.parent === item.parent && i.layout === item.layout)
			)
			.sort(
				(a, b) => (a[orderField] || 0) - (b[orderField] || 0) || a.title.localeCompare(b.title)
			);
	}
	function neighbor(item: RecordModel, delta: number) {
		const siblings = reorderSiblings(item);
		return siblings[siblings.findIndex((i) => i.id === item.id) + delta]?.id || '';
	}
	function useMedia(asset: RecordModel, cover = false) {
		const url = pb.files.getURL(asset, asset.file);
		if (cover) coverUrl = url;
		else
			body += cleanContent(
				/\.(avif|png|jpg|jpeg|webp|gif)$/i.test(asset.file)
					? `<p><img src="${url}" alt="${(asset.alt || '').replace(/"/g, '&quot;')}" /></p>`
					: `<p><a href="${url}">${asset.caption || asset.file}</a></p>`
			);
		dirty = true;
		showLibrary = false;
	}
</script>

<svelte:window
	onbeforeunload={(event) => {
		if (dirty) {
			event.preventDefault();
			event.returnValue = '';
		}
	}}
/>
<svelte:head
	><title
		>{kindFilter === 'page' ? 'Pages' : kindFilter === 'post' ? 'Posts' : 'Pages & posts'} | PURE3D Admin</title
	></svelte:head
>
<div id="content-manager">
	{#if !allowed}<p>Admin access is required.</p>{:else}
		{#if failure}<div role="alert" class="alert alert-error">
				{failure}<button onclick={load}>Retry</button>
			</div>{/if}
		{#if !failure && openCallsUnavailable}<div role="status" class="mb-4 alert alert-warning">
				Open calls are not configured in this database. You can still edit pages and posts; adding
				Open calls components is unavailable until the Open calls migration is applied.
				<button type="button" class="btn btn-sm" onclick={load}>Retry</button>
			</div>{/if}
		{#if selected}
			<div class="mb-6 flex flex-wrap items-center justify-between gap-3">
				<button
					class="btn btn-ghost"
					disabled={saving}
					onclick={() => {
						if (!dirty || confirm('Discard unsaved changes?')) reset();
					}}>← Content library</button
				>
				<div class="flex gap-3">
					{#if selected}<a class="btn btn-outline" href={`${base}${contentPath(selected)}`}
							>Preview</a
						>{/if}<button class="btn btn-primary" disabled={saving || !dirty} onclick={save}
						>{saving ? 'Saving…' : 'Save changes'}</button
					>
				</div>
			</div>
			<div inert={saving} class="grid gap-7 xl:grid-cols-[minmax(0,1fr)_280px]">
				<div class="min-w-0 space-y-6">
					<div>
						<label class="block text-sm font-medium"
							>Cover image<input
								type="file"
								accept="image/*"
								class="file-input mt-2 w-full"
								onchange={(e) => chooseMedia(e, true)}
							/></label
						>
						{#if coverUrl}<img
								src={coverUrl}
								alt="Current cover"
								class="mt-3 aspect-video w-full rounded-xl object-cover"
							/><button
								class="btn mt-2 btn-xs"
								onclick={() => {
									coverUrl = '';
									dirty = true;
								}}>Remove cover</button
							>{/if}
					</div>
					<label class="block text-sm font-medium"
						>Title<input
							class="input mt-2 w-full text-lg"
							bind:value={title}
							oninput={() => (dirty = true)}
						/></label
					><label class="block text-sm font-medium"
						>Summary<textarea
							class="textarea mt-2 min-h-24 w-full"
							bind:value={summary}
							oninput={() => (dirty = true)}
						></textarea></label
					>
					<div>
						<h2 class="mb-3 text-sm font-medium">Page content</h2>
						{#key selected?.id || 'new'}<RichTextEditor
								content={body}
								minHeight="450px"
								enableImagePaste
								uploadImage={upload}
								cmsComponents
								{cmsEditions}
								{cmsOpenCalls}
								cmsOpenCallsEnabled={!openCallsUnavailable}
								onchange={(html) => {
									body = html;
									dirty = true;
								}}
							/>{/key}
					</div>
					<section class="rounded-xl border border-base-300 p-5">
						<h2 class="font-semibold">Images & attachments</h2>
						<button
							type="button"
							class="btn my-3 btn-outline btn-sm"
							onclick={() => (showLibrary = !showLibrary)}
							>{showLibrary ? 'Close media library' : 'Choose from media library'}</button
						>
						{#if showLibrary}<input
								aria-label="Search media library"
								class="input my-3 w-full"
								placeholder="Search files or captions…"
								bind:value={libraryQuery}
							/>
							<div class="my-4 grid max-h-96 gap-3 overflow-y-auto sm:grid-cols-2">
								{#each matchingMedia as asset (asset.id)}<div
										class="min-w-0 rounded-lg border border-base-300 p-3"
									>
										{#if /\.(avif|png|jpg|jpeg|webp|gif)$/i.test(asset.file)}<img
												src={pb.files.getURL(asset, asset.file)}
												alt={asset.alt || ''}
												class="mb-2 h-20 w-full object-contain"
												loading="lazy"
											/>{/if}
										<p class="truncate text-xs">{asset.caption || asset.file}</p>
										<div class="mt-2 flex gap-2">
											<button class="btn btn-xs" onclick={() => useMedia(asset)}
												>Insert into page</button
											>{#if /\.(avif|png|jpg|jpeg|webp|gif)$/i.test(asset.file)}<button
													class="btn btn-xs"
													onclick={() => useMedia(asset, true)}>Use as cover</button
												>{/if}
										</div>
									</div>{/each}
							</div>{/if}
						<p class="my-2 text-xs opacity-60">
							Save a draft first. Paste images into the editor, or upload images and PDFs here and
							copy their links.
						</p>
						<input
							aria-label="Upload attachment"
							type="file"
							class="file-input w-full"
							accept="image/*,application/pdf,audio/mpeg,video/mp4"
							disabled={!selected}
							onchange={(e) => chooseMedia(e)}
						/>
						<ul class="mt-4 space-y-3">
							{#each assets as asset (asset.id)}<li
									class="flex flex-wrap items-center justify-between gap-2 text-sm"
								>
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- Absolute PocketBase file URL. -->
									<a
										class="max-w-full truncate underline"
										href={pb.files.getURL(asset, asset.file)}
										target="_blank"
										rel="noopener">{asset.file}</a
									><button
										class="btn btn-xs"
										onclick={async () => {
											try {
												await navigator.clipboard.writeText(pb.files.getURL(asset, asset.file));
												toast.success('Link copied');
											} catch {
												toast.error('Could not copy link');
											}
										}}>Copy link</button
									>
								</li>{/each}
						</ul>
					</section>
				</div>
				<aside class="space-y-5 self-start rounded-xl border border-base-300 bg-base-200 p-5">
					<h2 class="font-semibold">Publication settings</h2>
					<label class="flex items-center justify-between text-sm"
						>Published<input
							type="checkbox"
							class="toggle"
							bind:checked={isPublished}
							onchange={() => (dirty = true)}
						/></label
					>
					<p class="text-xs opacity-60">Drafts are visible only to admins.</p>
					{#if formKind === 'page'}
						<label class="flex items-center justify-between text-sm"
							>Learning material<input
								type="checkbox"
								class="toggle"
								bind:checked={learningMaterial}
								onchange={() => (dirty = true)}
							/></label
						>
						{#if learningMaterial}
							<label class="block text-sm"
								>Learning materials order<input
									class="input mt-2 w-full"
									type="number"
									bind:value={learningMaterialOrder}
									oninput={() => (dirty = true)}
								/></label
							>
						{/if}
					{/if}
					<label class="block text-sm"
						>URL slug<input
							class="input mt-2 w-full"
							disabled={selected?.layout === 'guide' && selected?.slug === 'documentation'}
							bind:value={slug}
							oninput={() => (dirty = true)}
						/></label
					>
					<label class="block text-sm"
						>Content type<select
							aria-label="Entry type"
							disabled={selected?.layout === 'guide' && selected?.slug === 'documentation'}
							class="select mt-2 w-full"
							bind:value={formKind}
							onchange={(event) => {
								layout = event.currentTarget.value === 'post' ? 'article' : 'standard';
								parent = '';
								dirty = true;
							}}
							>{#each contentKinds as value (value)}<option {value}>{kindLabels[value]}</option
								>{/each}</select
						></label
					>
					{#if formKind === 'page'}
						<label class="block text-sm"
							>Layout<select
								aria-label="Page layout"
								disabled={selected?.layout === 'guide' && selected?.slug === 'documentation'}
								class="select mt-2 w-full"
								bind:value={layout}
								onchange={(event) => {
									parent =
										event.currentTarget.value === 'guide'
											? items.find((r) => r.layout === 'guide' && r.slug === 'documentation')?.id ||
												''
											: '';
									if (event.currentTarget.value === 'guide') section = 'publish';
									dirty = true;
								}}
								><option value="standard">Standard page</option><option value="guide"
									>Documentation / guide</option
								></select
							></label
						>
						<label class="block text-sm"
							>Parent page<select
								aria-label="Parent page"
								disabled={selected?.layout === 'guide' && selected?.slug === 'documentation'}
								class="select mt-2 w-full"
								bind:value={parent}
								onchange={() => (dirty = true)}
								><option value="">No parent</option
								>{#each parentOptions as option (option.id)}<option value={option.id}
										>{option.title}</option
									>{/each}</select
							></label
						>
						<label class="block text-sm"
							>Page order<input
								class="input mt-2 w-full"
								type="number"
								bind:value={order}
								oninput={() => (dirty = true)}
							/></label
						>
					{:else}<fieldset class="space-y-2">
							<legend class="mb-2 text-sm">Categories</legend
							>{#each categoryOptions as category (category.id)}<label
									class="flex items-center gap-2 text-sm"
									><input
										class="checkbox checkbox-sm"
										type="checkbox"
										value={category.id}
										bind:group={categoryIds}
										onchange={() => (dirty = true)}
									/>{category.name}</label
								>{/each}
						</fieldset>{/if}
					<label class="block text-sm"
						>Editorial section<select
							class="select mt-2 w-full"
							bind:value={section}
							onchange={() => (dirty = true)}
							>{#each contentSections as value (value)}<option {value}>{value}</option
								>{/each}</select
						></label
					>
					<label class="block text-sm"
						>Author<input
							class="input mt-2 w-full"
							bind:value={author}
							oninput={() => (dirty = true)}
						/></label
					><label class="block text-sm"
						>Original publication date<input
							type="date"
							class="input mt-2 w-full"
							bind:value={publishedAt}
							oninput={() => (dirty = true)}
						/></label
					>
					{#if selected?.sourceUrl}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- Original external source. -->
						<a
							class="block text-xs underline"
							href={selected.sourceUrl}
							target="_blank"
							rel="noopener">Original WordPress source ↗</a
						>{/if}
					<label class="block text-sm"
						>Editorial notes<textarea
							class="textarea mt-2 min-h-28 w-full"
							bind:value={notes}
							oninput={() => (dirty = true)}
						></textarea></label
					>
					{#if selected}<button
							class="btn btn-outline btn-sm btn-error"
							disabled={selected.layout === 'guide' && selected.slug === 'documentation'}
							title={selected.layout === 'guide' && selected.slug === 'documentation'
								? 'The documentation landing page can be edited or unpublished.'
								: undefined}
							onclick={remove}>Delete content</button
						>{/if}
				</aside>
			</div>
		{:else}
			{#if learningMaterialsOnly}
				<div class="mb-6 space-y-2">
					<p>
						Create a page to add a card, or open an existing page and enable Learning material.
						Publish the page to show its card. Lower order values appear first.
					</p>
					<a class="btn btn-outline btn-sm" href={resolve('/admin/pages')}>Browse all pages</a>
				</div>
			{/if}
			<div class="mb-6 grid gap-3 md:grid-cols-[1fr_200px_170px]">
				<input
					aria-label="Search content"
					class="input w-full"
					type="search"
					placeholder="Search by title or URL…"
					bind:value={query}
				/><select aria-label="Content type" class="select w-full" bind:value={kind}
					><option value="">All types</option>{#each contentKinds as value (value)}<option {value}
							>{kindLabels[value]}</option
						>{/each}</select
				><select aria-label="Publication status" class="select w-full" bind:value={status}
					><option value="">All statuses</option><option value="draft">Drafts</option><option
						value="published">Published</option
					></select
				>
			</div>
			<p class="mb-4 text-xs opacity-50">
				{#if learningMaterialsOnly}Learning materials ·
				{/if}
				{filtered.length} entries · {filtered.filter((i) => !i.isPublished).length} drafts
				{#if kindFilter === 'page' && filteredOrder}
					· Clear filters to reorder pages.{/if}
			</p>
			{#if reordering}<p role="status" class="mb-3 text-sm">Saving order…</p>{/if}
			{#if loading}<p>Loading content…</p>{:else}<div
					class="overflow-x-auto rounded-xl border border-base-300"
				>
					<table class="table">
						<thead
							><tr><th>Title</th><th>Type</th><th>Section</th><th>Status</th><th></th></tr></thead
						><tbody
							>{#each displayed as item (item.id)}<tr
									draggable={kindFilter === 'page' && !saving && !filteredOrder}
									ondragend={() => (dragId = '')}
									ondragstart={(e) => {
										dragId = item.id;
										e.dataTransfer?.setData('text/plain', item.id);
									}}
									ondragover={(e) => e.preventDefault()}
									ondrop={(e) => {
										e.preventDefault();
										void reorder(dragId, item.id);
										dragId = '';
									}}
									><td
										><button
											class="text-left font-medium hover:underline"
											style:padding-left={`${item.depth * 16}px`}
											onclick={() => edit(item)}>{item.title}</button
										>
										<div class="mt-1 max-w-sm truncate text-xs opacity-45">
											{contentPath(item)}
										</div></td
									><td class="whitespace-nowrap"
										>{item.layout === 'guide' ? 'Guide' : kindLabels[item.kind]}</td
									><td>{item.section}</td><td
										><span class="badge badge-sm" class:badge-success={item.isPublished}
											>{item.isPublished ? 'Published' : 'Draft'}</span
										></td
									><td
										>{#if kindFilter === 'page'}<button
												class="btn btn-xs"
												aria-label={`Move ${item.title} up`}
												disabled={saving || filteredOrder || !neighbor(item, -1)}
												onclick={() => reorder(item.id, neighbor(item, -1))}>↑</button
											><button
												class="btn btn-xs"
												aria-label={`Move ${item.title} down`}
												disabled={saving || filteredOrder || !neighbor(item, 1)}
												onclick={() => reorder(item.id, neighbor(item, 1))}>↓</button
											>{/if}<button class="btn btn-ghost btn-sm" onclick={() => edit(item)}
											>Edit</button
										></td
									></tr
								>{/each}</tbody
						>
					</table>
				</div>{/if}
		{/if}
	{/if}
</div>
