<script lang="ts">
	import { pb } from '$lib/database/client';
	import type { RecordModel } from 'pocketbase';
	import { untrack, type Snippet } from 'svelte';
	import toast from 'svelte-french-toast';
	import { fetchFileSize } from '$lib/utils/file-size';

	type Props = {
		record: RecordModel;
		collectionName: string;
		fieldName: string;
		accept: string;
		maxSize: number;
		allowedExtensions?: string[];
		disabled?: boolean;
		onuploaded?: (record: RecordModel) => void;
		onremoved?: (record: RecordModel) => void;
		onbusychange?: (busy: boolean) => void;
		preview?: Snippet<[{ filename: string; url: string }]>;
		emptyPreview?: Snippet;
	};

	let {
		record = $bindable(),
		collectionName,
		fieldName,
		accept,
		maxSize,
		allowedExtensions,
		disabled = false,
		onuploaded,
		onremoved,
		onbusychange,
		preview,
		emptyPreview
	}: Props = $props();

	let currentFilename = $derived((record[fieldName] as string | undefined) ?? '');
	let progress = $state(0);
	let uploading = $state(false);
	let removing = $state(false);
	let fileToken = $state('');
	$effect(() => {
		onbusychange?.(uploading || removing);
	});
	$effect(() => {
		if (collectionName !== 'editions' || record.isPublished || !currentFilename) return;
		let active = true;
		void untrack(() => pb.files.getToken())
			.then((token) => {
				if (active) fileToken = token;
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	});
	let errorMsg = $state('');
	let pendingFile = $state<File | null>(null);
	let dragActive = $state(false);
	let currentXhr: XMLHttpRequest | null = null;
	let inputEl: HTMLInputElement | undefined = $state();

	let acceptList = $derived(
		accept
			.split(',')
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean)
	);

	function acceptsFile(file: File): boolean {
		if (acceptList.length === 0) return true;
		const type = file.type.toLowerCase();
		const name = file.name.toLowerCase();
		return acceptList.some((token) => {
			if (token.startsWith('.')) return name.endsWith(token);
			if (token.endsWith('/*')) return type.startsWith(token.slice(0, -1));
			return type === token;
		});
	}

	$effect(() => {
		return () => {
			if (currentXhr) {
				currentXhr.abort();
				currentXhr = null;
			}
		};
	});

	function humanSize(n: number): string {
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
		if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
		return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
	}

	function validate(file: File): string | null {
		if (maxSize > 0 && file.size > maxSize) {
			return `File is ${humanSize(file.size)}, max allowed is ${humanSize(maxSize)}`;
		}
		if (allowedExtensions && allowedExtensions.length > 0) {
			const lower = file.name.toLowerCase();
			if (!allowedExtensions.some((ext) => lower.endsWith(ext.toLowerCase()))) {
				return `Extension not allowed. Accepted: ${allowedExtensions.join(', ')}`;
			}
		}
		return null;
	}

	function upload(file: File) {
		if (disabled || uploading || removing) return;
		const vErr = validate(file);
		if (vErr) {
			errorMsg = vErr;
			return;
		}

		if (currentXhr) {
			currentXhr.abort();
			currentXhr = null;
		}

		uploading = true;
		errorMsg = '';
		progress = 0;
		pendingFile = file;

		const form = new FormData();
		form.append(fieldName, file);

		const xhr = new XMLHttpRequest();
		currentXhr = xhr;
		const url = `${pb.baseUrl}/api/collections/${collectionName}/records/${record.id}`;
		xhr.open('PATCH', url);
		const token = pb.authStore.token;
		if (token) xhr.setRequestHeader('Authorization', token);

		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) {
				progress = Math.round((e.loaded / e.total) * 100);
			}
		};

		xhr.onload = async () => {
			currentXhr = null;
			if (xhr.status >= 200 && xhr.status < 300) {
				try {
					const updated = await pb.collection(collectionName).getOne(record.id);
					record = updated;
					onuploaded?.(updated);
					pendingFile = null;
					progress = 0;
				} catch (err) {
					errorMsg = (err as Error).message || 'Failed to refresh record';
				}
			} else {
				let msg = `Upload failed (${xhr.status})`;
				try {
					const body = JSON.parse(xhr.responseText);
					msg = body?.message || msg;
				} catch {
					/* noop */
				}
				errorMsg = msg;
				toast.error(msg);
			}
			uploading = false;
		};

		xhr.onerror = () => {
			currentXhr = null;
			uploading = false;
			errorMsg = 'Network error';
			toast.error('Network error while uploading');
		};

		xhr.onabort = () => {
			currentXhr = null;
			uploading = false;
		};

		xhr.send(form);
	}

	function onFilePicked(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		target.value = '';
		if (file) upload(file);
	}

	async function remove() {
		if (!currentFilename || disabled || uploading || removing) return;
		removing = true;
		try {
			const updated = await pb.collection(collectionName).update(record.id, {
				[fieldName]: null
			});
			record = updated;
			onremoved?.(updated);
		} catch (err) {
			console.error(`Remove ${fieldName} failed:`, err);
			toast.error((err as Error).message || 'Failed to remove file');
		} finally {
			removing = false;
		}
	}

	function retry() {
		if (pendingFile) upload(pendingFile);
	}

	function pick() {
		inputEl?.click();
	}

	function onDragOver(e: DragEvent) {
		if (disabled || uploading) return;
		if (!e.dataTransfer?.types.includes('Files')) return;
		e.preventDefault();
		dragActive = true;
	}

	function onDragLeave() {
		dragActive = false;
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragActive = false;
		if (disabled || uploading) return;
		const file = e.dataTransfer?.files?.[0];
		if (!file) return;
		if (!acceptsFile(file)) {
			errorMsg = `File type not accepted. Allowed: ${accept}`;
			toast.error(errorMsg);
			return;
		}
		upload(file);
	}

	let fileUrl = $derived(
		currentFilename ? pb.files.getURL(record, currentFilename, { token: fileToken }) : ''
	);
	let fileSize = $state<number | null>(null);
	$effect(() => {
		const url = fileUrl;
		const controller = new AbortController();
		fileSize = null;
		if (url && (collectionName !== 'editions' || record.isPublished || fileToken)) {
			void fetchFileSize(url, controller.signal).then((size) => {
				if (!controller.signal.aborted) fileSize = size;
			});
		}
		return () => controller.abort();
	});
</script>

<div id="file-upload-field" class="space-y-2">
	<input
		bind:this={inputEl}
		type="file"
		{accept}
		class="hidden"
		{disabled}
		onchange={onFilePicked}
	/>

	<div
		class="relative rounded-lg transition-all {dragActive
			? 'ring-2 ring-primary ring-offset-2 ring-offset-base-100'
			: ''}"
		ondragover={onDragOver}
		ondragenter={onDragOver}
		ondragleave={onDragLeave}
		ondrop={onDrop}
		role="presentation"
	>
		{#if currentFilename && !uploading}
			{#if preview && (collectionName !== 'editions' || record.isPublished || fileToken)}
				{@render preview({ filename: currentFilename, url: fileUrl })}
			{:else}
				<div class="text-xs">{currentFilename}</div>
			{/if}
			<div class="text-xs text-base-content/50">
				{fileSize !== null ? humanSize(fileSize) : 'Size unavailable'}
			</div>
			<div class="mt-2 flex gap-2">
				<button type="button" class="btn btn-outline btn-xs" onclick={pick} {disabled}>
					Replace
				</button>
				<button type="button" class="btn btn-ghost btn-xs" onclick={remove} {disabled}>
					Remove
				</button>
			</div>
		{:else if uploading}
			<div class="space-y-1">
				<div class="text-xs text-base-content/60">
					Uploading {humanSize(pendingFile?.size ?? 0)}...
				</div>
				<progress class="progress w-full progress-primary" value={progress} max="100"></progress>
				<div class="text-xs text-base-content/40">{progress}%</div>
			</div>
		{:else}
			{#if emptyPreview}
				{@render emptyPreview()}
			{/if}
			<button type="button" class="btn mt-2 w-full btn-outline btn-sm" onclick={pick} {disabled}>
				Choose file
			</button>
		{/if}

		{#if dragActive}
			<div
				class="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-primary/10"
			>
				<span class="text-xs font-medium text-primary">Drop to upload</span>
			</div>
		{/if}
	</div>

	{#if errorMsg}
		<div class="alert-sm alert alert-error">
			<span class="text-xs">{errorMsg}</span>
			{#if pendingFile}
				<button type="button" class="btn btn-ghost btn-xs" onclick={retry}>Retry</button>
			{/if}
		</div>
	{/if}
</div>
