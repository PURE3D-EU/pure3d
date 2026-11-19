<script lang="ts">
	import { beforeNavigate } from '$app/navigation';
	import { onMount } from 'svelte';
	import type { RecordModel } from 'pocketbase';
	import toast from 'svelte-french-toast';
	import { pb } from '$lib/database/client';
	import { authStore } from '$lib/database/stores/auth.svelte';
	import RichTextEditor from '$lib/components/ui/RichTextEditor.svelte';
	import { cleanContent } from '$lib/utils/content-html';

	let calls = $state<RecordModel[]>([]);
	let cmsEditions = $state<{ id: string; title: string }[]>([]);
	let selected = $state<RecordModel | null>(null);
	let creating = $state(false);
	let title = $state('');
	let shortDescription = $state('');
	let body = $state('');
	let cover = $state<File | null>(null);
	let coverPreview = $state('');
	let removeCover = $state(false);
	$effect(() => {
		if (!cover) {
			coverPreview = '';
			return;
		}
		const url = URL.createObjectURL(cover);
		coverPreview = url;
		return () => URL.revokeObjectURL(url);
	});
	let deadline = $state('');
	let isPublished = $state(false);
	let order = $state(0);
	let loading = $state(true);
	let saving = $state(false);
	let dirty = $state(false);
	let failure = $state('');
	let allowed = $derived(authStore.globalRole === 'admin');

	async function load() {
		loading = true;
		failure = '';
		try {
			const [records, editions] = await Promise.all([
				pb.collection('open_calls').getFullList({ sort: 'order,title' }),
				pb.collection('editions').getFullList({
					filter: 'isPublished = true',
					fields: 'id,title,dcTitle',
					sort: 'dcTitle,title'
				})
			]);
			calls = records;
			cmsEditions = editions.map((edition) => ({
				id: edition.id,
				title: edition.dcTitle || edition.title || 'Untitled edition'
			}));
		} catch (error) {
			failure = error instanceof Error ? error.message : 'Could not load open calls.';
		} finally {
			loading = false;
		}
	}

	function closeEditor() {
		selected = null;
		creating = false;
		dirty = false;
	}

	function startCreate() {
		if (dirty && !confirm('Discard unsaved changes?')) return;
		selected = null;
		creating = true;
		cover = null;
		removeCover = false;
		title = '';
		shortDescription = '';
		body = '';
		deadline = '';
		isPublished = false;
		order = Math.max(-1, ...calls.map((call) => Number(call.order) || 0)) + 1;
		dirty = false;
	}

	function edit(call: RecordModel) {
		if (dirty && !confirm('Discard unsaved changes?')) return;
		selected = call;
		cover = null;
		removeCover = false;
		creating = false;
		title = call.title || '';
		shortDescription = call.shortDescription || '';
		body = cleanContent(call.body || '');
		deadline = call.deadline?.slice(0, 10) || '';
		isPublished = Boolean(call.isPublished);
		order = Number(call.order) || 0;
		dirty = false;
	}

	async function save() {
		if (!title.trim()) {
			toast.error('Enter a title.');
			return;
		}
		if (body.includes('data-cms-open-calls')) {
			toast.error('Open calls cannot contain another open calls component.');
			return;
		}
		if (isPublished !== Boolean(selected?.isPublished)) {
			const action = isPublished ? 'Publish' : 'Unpublish';
			if (!confirm(`${action} “${title.trim()}”?`)) return;
		}
		saving = true;
		try {
			const payload = {
				title: title.trim(),
				shortDescription: shortDescription.trim(),
				body: cleanContent(body),
				deadline: deadline ? `${deadline}T00:00:00.000Z` : '',
				isPublished,
				order,
				...(cover ? { cover } : removeCover ? { cover: '' } : {})
			};
			const record = selected
				? await pb.collection('open_calls').update(selected.id, payload, {
						headers: { 'X-Pure3D-Open-Call-Version': selected.updated }
					})
				: await pb.collection('open_calls').create(payload);
			dirty = false;
			await load();
			edit(record);
			toast.success('Open call saved.');
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Could not save the open call.');
		} finally {
			saving = false;
		}
	}

	async function remove(call: RecordModel) {
		if (!confirm(`Delete “${call.title}”? This cannot be undone.`)) return;
		try {
			await pb.collection('open_calls').delete(call.id);
			if (selected?.id === call.id) closeEditor();
			await load();
			toast.success('Open call deleted.');
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Could not delete the open call.');
		}
	}

	beforeNavigate(({ cancel }) => {
		if (dirty && !confirm('Discard unsaved changes?')) cancel();
	});
	onMount(() => {
		if (allowed) void load();
	});
</script>

<svelte:window
	onbeforeunload={(event) => {
		if (dirty) {
			event.preventDefault();
			event.returnValue = '';
		}
	}}
/>
<svelte:head><title>Open Calls | PURE3D Admin</title></svelte:head>

<div id="open-calls-page">
	{#if !allowed}
		<p>Admin access is required.</p>
	{:else}
		<div class="mb-8 flex flex-wrap items-start justify-between gap-4">
			<div>
				<h1 class="text-3xl font-semibold">Open Calls</h1>
				<p class="mt-2 text-sm opacity-65">Create and publish calls for reusable page content.</p>
			</div>
			<button class="btn btn-primary" disabled={saving} onclick={startCreate}
				>+ New open call</button
			>
		</div>
		{#if failure}
			<div role="alert" class="mb-5 alert alert-error">
				<span>{failure}</span><button class="btn btn-sm" onclick={load}>Retry</button>
			</div>
		{/if}
		{#if selected || creating}
			<div class="mb-6 flex flex-wrap items-center justify-between gap-3">
				<button
					class="btn btn-ghost"
					disabled={saving}
					onclick={() => {
						if (!dirty || confirm('Discard unsaved changes?')) closeEditor();
					}}>← Open calls</button
				>
				<button class="btn btn-primary" disabled={saving || !dirty} onclick={save}>
					{saving ? 'Saving…' : 'Save open call'}
				</button>
			</div>
			<div inert={saving} class="grid gap-7 xl:grid-cols-[minmax(0,1fr)_280px]">
				<div class="min-w-0 space-y-6">
					<label class="block text-sm font-medium"
						>Title<input
							class="input mt-2 w-full text-lg"
							maxlength="500"
							bind:value={title}
							oninput={() => (dirty = true)}
						/></label
					>
					<label class="block text-sm font-medium">
						Short description <span class="font-normal opacity-65">(optional)</span>
						<textarea
							class="textarea mt-2 w-full"
							maxlength="300"
							rows="3"
							bind:value={shortDescription}
							oninput={() => (dirty = true)}
							aria-describedby="call-description-help"
						></textarea>
					</label>
					<p id="call-description-help" class="text-xs opacity-65">
						Introduce the call in up to 300 characters. This appears on the homepage and in
						embedded open calls.
					</p>
					<div>
						<h2 class="mb-3 text-sm font-medium">Content</h2>
						{#key selected?.id || 'new'}
							<RichTextEditor
								content={body}
								minHeight="450px"
								cmsComponents
								{cmsEditions}
								cmsOpenCallsEnabled={false}
								onchange={(html) => {
									body = html;
									dirty = true;
								}}
							/>
						{/key}
					</div>
				</div>
				<aside class="space-y-5 self-start rounded-xl border border-base-300 bg-base-200 p-5">
					<h2 class="font-semibold">Publication settings</h2>
					<div class="space-y-3">
						<label class="block text-sm" for="call-cover">Cover image</label>
						{#if coverPreview || (selected?.cover && !removeCover)}
							<img
								src={coverPreview || pb.files.getURL(selected!, selected!.cover)}
								alt="Cover preview"
								class="aspect-square w-full rounded object-contain"
							/>
							{#if cover}<p class="break-all text-sm">{cover.name}</p>{/if}
							<button
								type="button"
								class="btn btn-sm"
								onclick={() => {
									cover = null;
									removeCover = true;
									dirty = true;
								}}>Remove image</button
							>
						{/if}
						<input
							id="call-cover"
							type="file"
							accept="image/jpeg,image/png,image/webp"
							class="file-input w-full"
							onchange={(event) => {
								const file = event.currentTarget.files?.[0];
								event.currentTarget.value = '';
								if (!file) return;
								if (
									!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
									file.size > 10000000
								) {
									toast.error('Choose a JPEG, PNG or WebP image up to 10 MB.');
									return;
								}
								cover = file;
								removeCover = false;
								dirty = true;
							}}
						/>
						<p class="text-xs opacity-60">
							Use square artwork. The complete image is shown without cropping. JPEG, PNG or WebP,
							up to 10 MB.
						</p>
					</div>
					<label class="flex items-center justify-between text-sm"
						>Published<input
							type="checkbox"
							class="toggle"
							bind:checked={isPublished}
							onchange={() => (dirty = true)}
						/></label
					>
					<p class="text-xs opacity-60">Drafts are visible only to administrators.</p>
					<label class="block text-sm"
						>Deadline<input
							class="input mt-2 w-full"
							type="date"
							bind:value={deadline}
							onchange={() => (dirty = true)}
						/></label
					>
					<label class="block text-sm"
						>Display order<input
							class="input mt-2 w-full"
							type="number"
							bind:value={order}
							oninput={() => (dirty = true)}
						/></label
					>
					{#if selected}<button
							class="btn w-full text-error btn-ghost"
							disabled={saving}
							onclick={() => selected && remove(selected)}>Delete open call</button
						>{/if}
				</aside>
			</div>
		{:else if loading}
			<p>Loading open calls…</p>
		{:else if calls.length}
			<ul class="space-y-3">
				{#each calls as call (call.id)}
					<li
						class="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-base-300 p-5"
					>
						<div class="flex min-w-0 items-center gap-4">
							{#if call.cover}
								<img
									src={pb.files.getURL(call, call.cover)}
									alt=""
									loading="lazy"
									width="48"
									height="48"
									class="size-12 shrink-0 rounded object-contain"
								/>
							{/if}
							<div class="min-w-0 wrap-anywhere">
								<h2 class="font-semibold">{call.title}</h2>
								<p class="mt-1 text-xs opacity-60">
									{call.isPublished ? 'Published' : 'Draft'}{call.deadline
										? ` · Deadline ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(call.deadline))}`
										: ''} · Order {call.order || 0}
								</p>
							</div>
						</div>
						<div class="flex gap-2">
							<button class="btn btn-sm" onclick={() => edit(call)}>Edit</button><button
								class="btn text-error btn-ghost btn-sm"
								onclick={() => remove(call)}>Delete</button
							>
						</div>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="rounded-xl bg-base-200 p-6">No open calls yet.</p>
		{/if}
	{/if}
</div>
