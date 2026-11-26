<script lang="ts">
	import { onDestroy } from 'svelte';
	import { base, resolve } from '$app/paths';
	import { page } from '$app/stores';
	import { feedbackPageUrl, feedbackSubmission } from '$lib/database/feedback';
	import { authStore } from '$lib/database/stores/auth.svelte';
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

	let modal: HTMLDialogElement | undefined = $state();
	let isOpen = $state(false);
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
	let RichTextEditor = $state<
		Awaited<typeof import('$lib/components/ui/RichTextEditor.svelte')>['default'] | null
	>(null);
	let editorLoadError = $state('');

	let isFeedbackPage = $derived($page.url.pathname.replace(/\/$/, '') === `${base}/feedback`);

	function openFeedback() {
		participantName ||= authStore.user?.nickname || authStore.user?.email?.split('@')[0] || '';
		participantEmail ||= authStore.user?.email || '';
		relatedUrl ||= feedbackPageUrl();
		isOpen = true;
		modal?.showModal();
		void loadRichTextEditor();
	}

	async function loadRichTextEditor() {
		if (RichTextEditor) return;
		editorLoadError = '';
		try {
			RichTextEditor = (await import('$lib/components/ui/RichTextEditor.svelte')).default;
		} catch {
			editorLoadError = 'The feedback editor could not load. Please try again.';
		}
	}

	function closeFeedback() {
		modal?.close();
		isOpen = false;
	}

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
			relatedUrl = '';
			closeFeedback();
		} catch (error) {
			submissionError = (error as Error).message || 'Could not send feedback. Please try again.';
		} finally {
			isSubmitting = false;
		}
	}
</script>

{#if !isFeedbackPage}
	<button type="button" class="feedback-pill btn shadow-lg btn-primary" onclick={openFeedback}>
		Send Feedback
	</button>
{/if}

<dialog
	id="feedback-pill"
	bind:this={modal}
	class="modal"
	aria-labelledby="feedback-pill-title"
	onclose={() => (isOpen = false)}
>
	<div class="modal-box max-w-3xl border border-base-300 bg-base-100 p-0 shadow-2xl">
		<div class="border-b border-base-300 bg-base-200/60 px-5 py-4">
			<div class="flex items-start justify-between gap-4">
				<div>
					<p class="text-xs font-semibold tracking-wide text-primary uppercase">Send Feedback</p>
					<h2 id="feedback-pill-title" class="text-xl font-bold">What did you notice?</h2>
					<p class="mt-1 text-sm text-base-content/60">
						No account is needed. Only PURE3D administrators can see what you send.
					</p>
				</div>
				<button
					type="button"
					class="btn btn-circle btn-ghost btn-sm"
					aria-label="Close feedback form"
					onclick={closeFeedback}>✕</button
				>
			</div>
		</div>

		{#if isOpen}
			<form
				class="space-y-5 p-5"
				onsubmit={(event) => {
					event.preventDefault();
					submitFeedback();
				}}
			>
				<div class="rounded-box border border-base-300 bg-base-200/30 p-4">
					<div class="grid gap-4 md:grid-cols-2">
						<label class="form-control gap-1">
							<span class="label-text text-xs font-medium text-base-content/70">Name optional</span>
							<input
								class="feedback-field input-bordered input input-sm w-full"
								bind:value={participantName}
							/>
						</label>

						<label class="form-control gap-1">
							<span class="label-text text-xs font-medium text-base-content/70">Email optional</span
							>
							<input
								class="feedback-field input-bordered input input-sm w-full"
								type="email"
								bind:value={participantEmail}
							/>
						</label>

						<label class="form-control gap-1 md:col-span-2">
							<span class="label-text text-xs font-medium text-base-content/70">Related page</span>
							<input
								class="feedback-field input-bordered input input-sm w-full"
								bind:value={relatedUrl}
							/>
						</label>

						<label class="form-control gap-1">
							<span class="label-text text-xs font-medium text-base-content/70">Category</span>
							<select
								class="feedback-field select-bordered select w-full select-sm"
								bind:value={category}
							>
								{#each categoryOptions as option (option.value)}
									<option value={option.value}>{option.label}</option>
								{/each}
							</select>
						</label>

						<label class="form-control gap-1">
							<span class="label-text text-xs font-medium text-base-content/70">Severity</span>
							<select
								class="feedback-field select-bordered select w-full select-sm"
								bind:value={severity}
							>
								{#each severityOptions as option (option.value)}
									<option value={option.value}>{option.label}</option>
								{/each}
							</select>
						</label>
					</div>
				</div>

				<div class="feedback-editor">
					{#if RichTextEditor}
						<RichTextEditor
							content={feedbackHtml}
							placeholder="Write feedback here. You can paste screenshots."
							minHeight="220px"
							enableImagePaste
							uploadImage={async (file) => submission.stageImage(file, feedbackHtml)}
							onImageError={(message) => (submissionError = message)}
							onchange={(html) => (feedbackHtml = html)}
						/>
					{:else if editorLoadError}
						<p class="text-sm text-error" role="alert">{editorLoadError}</p>
					{:else}
						<div class="flex min-h-[220px] items-center justify-center" role="status">
							<span class="loading loading-sm loading-spinner"></span>
							<span class="ml-2 text-sm">Loading editor…</span>
						</div>
					{/if}
				</div>

				{#if submissionError}<p class="text-sm text-error" role="alert">{submissionError}</p>{/if}
				<div class="flex items-center justify-between gap-3 border-t border-base-300 pt-4">
					<a class="link text-sm link-primary" href={resolve('/feedback')}>Open feedback page</a>
					<div class="flex gap-2">
						<button type="button" class="btn btn-ghost btn-sm" onclick={closeFeedback}
							>Cancel</button
						>
						<button class="btn btn-sm btn-primary" disabled={isSubmitting || !RichTextEditor}>
							{#if isSubmitting}<span class="loading loading-xs loading-spinner"></span>{/if}
							Submit
						</button>
					</div>
				</div>
			</form>
		{/if}
	</div>
	<form method="dialog" class="modal-backdrop">
		<button>Close</button>
	</form>
</dialog>

<style>
	.feedback-pill {
		position: fixed;
		right: max(1rem, env(safe-area-inset-right));
		bottom: max(1rem, env(safe-area-inset-bottom));
		z-index: 60;
		border-radius: var(--radius-control);
		min-height: 2.75rem;
		padding-inline: 1.25rem;
	}

	.feedback-field {
		background: #ffffff;
		border-color: color-mix(in srgb, var(--color-base-content, #111111) 16%, transparent);
		box-shadow: 0 1px 0 rgb(0 0 0 / 0.03);
	}

	.feedback-field:focus,
	.feedback-field:focus-within {
		background: #ffffff;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 16%, transparent);
		outline: none;
	}

	.feedback-editor :global(.rounded-box) {
		background: #ffffff;
		box-shadow: 0 1px 0 rgb(0 0 0 / 0.03);
	}

	.feedback-editor :global(.editor-wrapper),
	.feedback-editor :global(.tiptap) {
		background: #ffffff;
	}

	.feedback-editor :global(.editor-wrapper) {
		border-bottom-right-radius: var(--radius-box, 1rem);
		border-bottom-left-radius: var(--radius-box, 1rem);
	}

	@media (width < 640px) {
		.feedback-pill {
			display: none;
		}
	}
</style>
