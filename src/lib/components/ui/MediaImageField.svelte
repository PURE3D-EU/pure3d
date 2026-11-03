<script lang="ts">
	import { pb } from '$lib/database/client';
	import { safeContentImageUrl } from '$lib/utils/content-components';
	let {
		src = $bindable(''),
		alt = $bindable(''),
		uploadImage,
		libraryEnabled = false,
		busy = $bindable(false)
	}: {
		src?: string;
		alt?: string;
		uploadImage?: (file: File) => Promise<string>;
		libraryEnabled?: boolean;
		busy?: boolean;
	} = $props();
	let error = $state('');
	let library = $state<{ id: string; url: string; alt: string; name: string }[]>([]);
	let showLibrary = $state(false);
	let query = $state('');
	let active = true;
	import { onDestroy } from 'svelte';
	onDestroy(() => {
		active = false;
	});
	async function upload(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !uploadImage || busy) return;
		busy = true;
		error = '';
		try {
			if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
			const url = await uploadImage(file);
			if (active) src = url;
		} catch (e) {
			if (active) error = e instanceof Error ? e.message : 'Could not upload image.';
		} finally {
			if (active) busy = false;
			input.value = '';
		}
	}
	async function chooseLibrary() {
		showLibrary = !showLibrary;
		if (!showLibrary) return;
		error = '';
		try {
			const assets = await pb.collection('content_assets').getFullList({ sort: '-created' });
			if (active)
				library = assets
					.filter((asset) => /\.(avif|png|jpe?g|webp|gif|svg|bmp|ico)$/i.test(asset.file))
					.map((asset) => ({
						id: asset.id,
						url: pb.files.getURL(asset, asset.file),
						alt: asset.alt || '',
						name: asset.caption || asset.file
					}));
		} catch {
			if (active) error = 'Could not load the media library. Please try again.';
		}
	}
</script>

<div id="media-image-field" class="space-y-3">
	{#if safeContentImageUrl(src)}<img
			{src}
			{alt}
			class="max-h-40 max-w-full rounded object-contain"
		/>{/if}
	<label class="block text-sm"
		>Image URL<input
			class="input mt-1 w-full"
			maxlength="2048"
			disabled={busy}
			bind:value={src}
		/></label
	>
	<label class="block text-sm"
		>Image description<input
			class="input mt-1 w-full"
			maxlength="240"
			disabled={busy}
			bind:value={alt}
		/></label
	>
	<div class="flex flex-wrap gap-2">
		{#if uploadImage}<label class="btn btn-sm"
				>{busy ? 'Uploading…' : src ? 'Replace image' : 'Upload image'}<input
					class="sr-only"
					type="file"
					accept="image/*"
					disabled={busy}
					onchange={upload}
				/></label
			>{/if}
		{#if libraryEnabled}<button
				type="button"
				class="btn btn-sm"
				disabled={busy}
				onclick={chooseLibrary}
				>{showLibrary ? 'Close media library' : 'Choose from media library'}</button
			>{/if}
		{#if src}<button
				type="button"
				class="btn btn-sm"
				disabled={busy}
				onclick={() => {
					src = '';
				}}>Remove image</button
			>{/if}
	</div>
	{#if showLibrary}
		<label class="block text-sm"
			>Search media<input type="search" class="input mt-1 w-full" bind:value={query} /></label
		>
		<div class="grid max-h-64 gap-2 overflow-auto sm:grid-cols-2">
			{#each library.filter((item) => `${item.name} ${item.alt}`
					.toLowerCase()
					.includes(query.toLowerCase())) as item (item.id)}
				<button
					type="button"
					class="btn h-auto justify-start p-2"
					onclick={() => {
						src = item.url;
						alt = item.alt;
						showLibrary = false;
					}}>{item.name}</button
				>
			{:else}<p class="text-sm">No matching images.</p>{/each}
		</div>
	{/if}
	{#if error}<p role="alert" class="text-sm text-error">{error}</p>{/if}
</div>
