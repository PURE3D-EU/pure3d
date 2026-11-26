<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import { feedbackSubmission } from '$lib/database/feedback';
	import { authStore } from '$lib/database/stores/auth.svelte';
	import RichTextEditor from '$lib/components/ui/RichTextEditor.svelte';
	import toast from 'svelte-french-toast';

	const categoryOptions = [
		{ value: 'bug', label: 'Bug' },
		{ value: 'confusing', label: 'Confusing' },
		{ value: 'upload_issue', label: 'Upload issue' },
		{ value: 'viewer_issue', label: '3D viewer issue' },
		{ value: 'metadata_workflow', label: 'Metadata/workflow' },
		{ value: 'missing_feature', label: 'Missing feature' },
		{ value: 'other', label: 'Other' }
	];

	const severityOptions = [
		{ value: 'minor', label: 'Minor' },
		{ value: 'important', label: 'Important' },
		{ value: 'blocking', label: 'Blocking' },
		{ value: 'suggestion', label: 'Suggestion' }
	];

	let isSubmitting = $state(false);
	const submission = feedbackSubmission();
	onDestroy(submission.clear);
	let submissionError = $state('');
	let participantName = $state('');
	let participantEmail = $state('');
	let relatedUrl = $state('');
	let category = $state('confusing');
	let severity = $state('important');
	let feedbackHtml = $state('');

	onMount(() => {
		participantName = authStore.user?.nickname || authStore.user?.email?.split('@')[0] || '';
		participantEmail = authStore.user?.email || '';
		relatedUrl = $page.url.searchParams.get('from') || '';
	});

	async function submitFeedback() {
		if (isSubmitting) return;
		submissionError = '';
		isSubmitting = true;
		try {
			await submission.send({
				participantName,
				participantEmail,
				editionUrl: relatedUrl,
				category,
				severity,
				feedbackHtml
			});
			toast.success('Thank you — feedback submitted');
			feedbackHtml = '';
		} catch (error) {
			submissionError = (error as Error).message || 'Could not send feedback. Please try again.';
		} finally {
			isSubmitting = false;
		}
	}
</script>

<svelte:head>
	<title>Feedback | PURE3D</title>
</svelte:head>

<div id="feedback-page" class="container mx-auto max-w-5xl px-4 py-10">
	<div class="mb-8 rounded-box bg-primary/10 p-6 ring-1 ring-primary/20 md:p-8">
		<p class="mb-2 text-sm font-semibold tracking-wide text-primary uppercase">Feedback</p>
		<h1 class="text-3xl font-bold md:text-4xl">Tell us what you notice</h1>
		<p class="mt-3 max-w-3xl text-base-content/70">
			Open the platform in a new tab and use it as naturally as possible. Try browsing, creating a
			3D edition, uploading files, editing metadata, and viewing the result. You do not need to
			finish everything. If something is confusing, broken, slow, or unclear, that is exactly what
			we want to know.
		</p>
		<a class="btn mt-5 btn-primary" href={resolve('/')} target="_blank" rel="noreferrer">
			Open PURE3D
		</a>
	</div>

	<section class="rounded-box border border-base-300 bg-base-100 p-6 shadow-sm">
		<div class="mb-5">
			<h2 class="text-xl font-semibold">Feedback form</h2>
			<p class="mt-1 text-sm text-base-content/60">
				No account is needed. You can paste screenshots into the text box. Only PURE3D administrators
				can see what you send.
			</p>
		</div>

		<form
			class="space-y-4"
			onsubmit={(event) => {
				event.preventDefault();
				submitFeedback();
			}}
		>
			<div class="grid gap-4 md:grid-cols-2">
				<label class="form-control">
					<span class="label pt-0 pb-1"><span class="label-text text-xs">Name optional</span></span>
					<input class="input-bordered input" bind:value={participantName} />
				</label>

				<label class="form-control">
					<span class="label pt-0 pb-1"><span class="label-text text-xs">Email optional</span></span
					>
					<input class="input-bordered input" type="email" bind:value={participantEmail} />
				</label>
			</div>

			<label class="form-control">
				<span class="label pt-0 pb-1">
					<span class="label-text text-xs">Related page or edition URL optional</span>
				</span>
				<input
					class="input-bordered input"
					placeholder="Paste the page or edition URL if relevant"
					bind:value={relatedUrl}
				/>
			</label>

			<div class="grid gap-4 md:grid-cols-2">
				<label class="form-control">
					<span class="label pt-0 pb-1"><span class="label-text text-xs">Category</span></span>
					<select class="select-bordered select" bind:value={category}>
						{#each categoryOptions as option (option.value)}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>
				</label>
				<label class="form-control">
					<span class="label pt-0 pb-1"><span class="label-text text-xs">Severity</span></span>
					<select class="select-bordered select" bind:value={severity}>
						{#each severityOptions as option (option.value)}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>
				</label>
			</div>

			<RichTextEditor
				content={feedbackHtml}
				placeholder="What did you notice? You can paste screenshots here."
				minHeight="300px"
				enableImagePaste
				uploadImage={async (file) => submission.stageImage(file, feedbackHtml)}
				onImageError={(message) => (submissionError = message)}
				onchange={(html) => (feedbackHtml = html)}
			/>

			{#if submissionError}<p class="text-sm text-error" role="alert">{submissionError}</p>{/if}
			<div class="flex justify-end">
				<button class="btn btn-primary" disabled={isSubmitting}>
					{#if isSubmitting}<span class="loading loading-xs loading-spinner"></span>{/if}
					Submit feedback
				</button>
			</div>
		</form>
	</section>
</div>
