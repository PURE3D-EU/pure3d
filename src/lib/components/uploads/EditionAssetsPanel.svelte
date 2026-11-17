<script lang="ts">
	import { onMount } from 'svelte';
	import { pb } from '$lib/database/client';
	import type { RecordModel } from 'pocketbase';
	import ModelFilesUpload from './ModelFilesUpload.svelte';
	import SceneDocumentUpload from './SceneDocumentUpload.svelte';
	import VoyagerPreview from './VoyagerPreview.svelte';
	import VoyagerSceneEditor from './VoyagerSceneEditor.svelte';
	import ModelOptimisationModal from './ModelOptimisationModal.svelte';

	type Props = {
		edition: RecordModel;
		collectionPubNum?: number | null;
		editionPubNum?: number | null;
		title?: string;
		disabled?: boolean;
		onupdated?: (r: RecordModel) => void;
		onbusychange?: (busy: boolean) => void;
	};
	let {
		edition = $bindable(),
		collectionPubNum,
		editionPubNum,
		title,
		disabled = false,
		onupdated,
		onbusychange
	}: Props = $props();

	function handleUpdated(r: RecordModel) {
		edition = r;
		onupdated?.(r);
	}

	let uploaderRef: ModelFilesUpload | undefined = $state();
	let modelBusy = $state(false);
	let sceneBusy = $state(false);
	let editorBusy = $state(false);
	let optimisationBusy = $state(false);
	let initializing = $state(false);
	let initializationError = $state('');
	$effect(() => {
		onbusychange?.(modelBusy || sceneBusy || editorBusy || optimisationBusy || initializing);
	});
	onMount(() => {
		if (
			edition.status !== 'concept_accepted' ||
			edition.modelFile ||
			edition.sceneDocument ||
			(Array.isArray(edition.modelAssets) && edition.modelAssets.length) ||
			!Array.isArray(edition.proposalModels) ||
			!edition.proposalModels.length
		)
			return;
		initializing = true;
		void pb
			.send(`/api/pure3d/editions/${edition.id}/initialize-draft-assets`, { method: 'POST' })
			.then(() => pb.collection('editions').getOne(edition.id))
			.then(handleUpdated)
			.catch((cause) => {
				initializationError =
					(cause as Error).message || 'Could not copy the accepted proposal models into the draft.';
			})
			.finally(() => (initializing = false));
	});
</script>

<div id="edition-assets-panel" class="space-y-4">
	{#if initializing}
		<p class="alert text-sm alert-info" role="status">Preparing the accepted proposal models…</p>
	{:else if initializationError}
		<p class="alert text-sm alert-error" role="alert">{initializationError}</p>
	{/if}
	<VoyagerPreview
		{edition}
		{collectionPubNum}
		{editionPubNum}
		title={title || edition.title || 'Edition preview'}
		onFiles={disabled || initializing || modelBusy || sceneBusy || editorBusy || optimisationBusy
			? undefined
			: (files) => uploaderRef?.uploadFiles(files)}
	/>
	<div class="flex flex-wrap items-start gap-3">
		<VoyagerSceneEditor
			{edition}
			{collectionPubNum}
			{editionPubNum}
			title={title || edition.title || 'Edition preview'}
			disabled={disabled || initializing || modelBusy || sceneBusy || optimisationBusy}
			onupdated={handleUpdated}
			onbusychange={(busy) => (editorBusy = busy)}
		/>
		<ModelOptimisationModal
			{edition}
			disabled={disabled || initializing || modelBusy || sceneBusy || editorBusy}
			onupdated={handleUpdated}
			onbusychange={(busy) => (optimisationBusy = busy)}
		/>
	</div>

	<div class="rounded-xl border border-base-300 bg-base-100 p-5">
		<h3 class="mb-3 text-sm font-semibold tracking-wide text-base-content/50 uppercase">
			3D Model Files
		</h3>
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
			<div>
				<div class="mb-1 text-xs text-base-content/60">
					Model file(s)
					<span class="text-base-content/40">— drop a GLTF/OBJ with its companions</span>
				</div>
				<ModelFilesUpload
					bind:this={uploaderRef}
					bind:record={edition}
					disabled={disabled || initializing || sceneBusy || editorBusy || optimisationBusy}
					onbusychange={(busy) => (modelBusy = busy)}
					onuploaded={handleUpdated}
					onremoved={handleUpdated}
				/>
			</div>
			<div>
				<div class="mb-1 text-xs text-base-content/60">Scene file (SVX)</div>
				<SceneDocumentUpload
					bind:record={edition}
					disabled={disabled || initializing || modelBusy || editorBusy || optimisationBusy}
					onbusychange={(busy) => (sceneBusy = busy)}
					onuploaded={handleUpdated}
					onremoved={handleUpdated}
				/>
			</div>
		</div>
	</div>
</div>
