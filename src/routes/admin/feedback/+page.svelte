<script lang="ts">
	import { contentText } from '$lib/utils/content-html';
	import SafeLink from '$lib/components/ui/SafeLink.svelte';
	import { ClientResponseError } from 'pocketbase';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { pb } from '$lib/database/client';
	import FloatingSelect from '$lib/components/ui/FloatingSelect.svelte';
	import toast from 'svelte-french-toast';
	import type { RecordModel } from 'pocketbase';

	interface FeedbackEntry {
		id: string;
		participantName: string;
		participantEmail: string;
		editionId: string;
		editionTitle: string;
		editionUrl: string;
		category: string;
		severity: string;
		feedbackHtml: string;
		images: string[];
		pageUrl: string;
		browserInfo: Record<string, unknown>;
		status: string;
		created: string;
		record: RecordModel;
	}

	interface FeedbackRecipient {
		id: string;
		email: string;
	}

	const categoryLabels: Record<string, string> = {
		bug: 'Bug',
		confusing: 'Confusing',
		upload_issue: 'Upload issue',
		viewer_issue: '3D viewer issue',
		metadata_workflow: 'Metadata/workflow',
		missing_feature: 'Missing feature',
		other: 'Other'
	};

	const severityLabels: Record<string, string> = {
		minor: 'Minor',
		important: 'Important',
		blocking: 'Blocking',
		suggestion: 'Suggestion'
	};

	const statusLabels: Record<string, string> = {
		draft: 'Draft',
		submitted: 'Submitted',
		reviewed: 'Reviewed',
		resolved: 'Resolved'
	};

	const statusOptions = [
		{ value: '', label: 'All statuses' },
		{ value: 'submitted', label: 'Submitted' },
		{ value: 'reviewed', label: 'Reviewed' },
		{ value: 'resolved', label: 'Resolved' },
		{ value: 'draft', label: 'Draft' }
	];

	const categoryOptions = [
		{ value: '', label: 'All categories' },
		...Object.entries(categoryLabels).map(([value, label]) => ({ value, label }))
	];

	const severityOptions = [
		{ value: '', label: 'All severities' },
		...Object.entries(severityLabels).map(([value, label]) => ({ value, label }))
	];

	let feedback = $state<FeedbackEntry[]>([]);
	let isLoading = $state(true);
	let searchQuery = $state('');
	let statusFilter = $state('submitted');
	let categoryFilter = $state('');
	let severityFilter = $state('');
	let expandedId = $state<string | null>(null);
	let recipients = $state<FeedbackRecipient[]>([]);
	let recipientEmail = $state('');
	let isLoadingRecipients = $state(true);
	let isSavingRecipient = $state(false);
	let deletingRecipientId = $state<string | null>(null);
	const perPage = 500;

	let hasActiveFilters = $derived(
		Boolean(searchQuery || statusFilter || categoryFilter || severityFilter)
	);
	let statusCounts = $derived(
		feedback.reduce(
			(counts, item) => {
				counts[item.status] = (counts[item.status] || 0) + 1;
				return counts;
			},
			{} as Record<string, number>
		)
	);
	onMount(() => {
		loadFeedback();
		loadRecipients();

		let unsubscribe: (() => void) | null = null;
		pb.collection('feedback')
			.subscribe('*', async (event) => {
				if (event.action === 'delete') {
					feedback = feedback.filter((item) => item.id !== event.record.id);
					return;
				}

				try {
					const record = await pb
						.collection('feedback')
						.getOne(event.record.id, { expand: 'edition' });
					upsertFeedback(mapFeedback(record));
				} catch (error) {
					console.error('Failed to apply realtime feedback update:', error);
				}
			})
			.then((fn) => {
				unsubscribe = fn;
			})
			.catch((error) => {
				console.error('Failed to subscribe to feedback updates:', error);
			});

		return () => {
			unsubscribe?.();
		};
	});

	async function loadRecipients() {
		isLoadingRecipients = true;
		try {
			const records = await pb.collection('feedbackRecipients').getFullList({ sort: 'email' });
			recipients = records.map((record) => ({ id: record.id, email: record.email }));
		} catch (error) {
			console.error('Failed to load feedback recipients:', error);
			toast.error('Failed to load email recipients');
		} finally {
			isLoadingRecipients = false;
		}
	}

	async function addRecipient() {
		const email = recipientEmail.trim().toLowerCase();
		if (!email) return;

		isSavingRecipient = true;
		try {
			await pb.collection('feedbackRecipients').create({ email });
			recipientEmail = '';
			await loadRecipients();
			toast.success('Email recipient added');
		} catch (error) {
			const message =
				(error instanceof ClientResponseError && error.response?.data?.email?.message) ||
				'Failed to add email recipient';
			toast.error(message);
		} finally {
			isSavingRecipient = false;
		}
	}

	async function deleteRecipient(recipient: FeedbackRecipient) {
		deletingRecipientId = recipient.id;
		try {
			await pb.collection('feedbackRecipients').delete(recipient.id);
			recipients = recipients.filter((item) => item.id !== recipient.id);
			toast.success('Email recipient removed');
		} catch {
			toast.error('Failed to remove email recipient');
		} finally {
			deletingRecipientId = null;
		}
	}

	async function loadFeedback() {
		isLoading = true;
		try {
			const result = await pb.collection('feedback').getList(1, perPage, {
				sort: '-@rowid',
				expand: 'edition'
			});

			feedback = result.items.map(mapFeedback);
		} catch (error) {
			console.error('Failed to load full feedback:', error);
			toast.error('Failed to load full feedback');
		} finally {
			isLoading = false;
		}
	}

	function mapFeedback(record: RecordModel): FeedbackEntry {
		const edition = record.expand?.edition as RecordModel | undefined;
		return {
			id: record.id,
			participantName: record.participantName || 'Anonymous',
			participantEmail: record.participantEmail || '',
			editionId: record.edition || '',
			editionTitle: edition?.title || '',
			editionUrl: record.editionUrl || '',
			category: record.category || 'other',
			severity: record.severity || 'minor',
			feedbackHtml: record.feedbackHtml || '',
			images: Array.isArray(record.images) ? record.images : [],
			pageUrl: record.pageUrl || '',
			browserInfo: (record.browserInfo as Record<string, unknown>) || {},
			status: record.status || 'submitted',
			created: record.created,
			record
		};
	}

	function upsertFeedback(item: FeedbackEntry) {
		const existingIndex = feedback.findIndex((entry) => entry.id === item.id);
		if (existingIndex === -1) {
			feedback = [item, ...feedback].slice(0, perPage);
			return;
		}

		feedback = feedback.map((entry) => (entry.id === item.id ? item : entry));
	}

	let visibleFeedback = $derived(
		feedback.filter((item) => {
			if (statusFilter && item.status !== statusFilter) return false;
			if (categoryFilter && item.category !== categoryFilter) return false;
			if (severityFilter && item.severity !== severityFilter) return false;

			const query = searchQuery.trim().toLowerCase();
			if (!query) return true;
			return [
				item.participantName,
				item.participantEmail,
				item.editionTitle,
				item.editionUrl,
				item.feedbackHtml,
				categoryLabels[item.category],
				severityLabels[item.severity]
			]
				.filter(Boolean)
				.some((value) => String(value).toLowerCase().includes(query));
		})
	);
	let visibleCount = $derived(visibleFeedback.length);

	function applyFilters() {
		// Filters are applied client-side to avoid PocketBase sort/filter quirks on this collection.
	}

	function clearFilters() {
		searchQuery = '';
		statusFilter = '';
		categoryFilter = '';
		severityFilter = '';
	}

	function filterByStatus(status: string) {
		statusFilter = status;
	}

	async function updateStatus(item: FeedbackEntry, status: string) {
		try {
			const updated = await pb.collection('feedback').update(item.id, { status });
			feedback = feedback.map((entry) => (entry.id === item.id ? mapFeedback(updated) : entry));
			toast.success(`Marked ${statusLabels[status].toLowerCase()}`);
		} catch (error) {
			console.error('Failed to update feedback status:', error);
			toast.error('Failed to update feedback status');
		}
	}

	function formatDate(dateStr: string) {
		const date = new Date(dateStr);
		return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
	}

	function imageUrl(item: FeedbackEntry, filename: string) {
		return pb.files.getURL(item.record, filename, { thumb: '400x300' });
	}

	function fullImageUrl(item: FeedbackEntry, filename: string) {
		return pb.files.getURL(item.record, filename);
	}

	function statusBadgeClass(status: string) {
		if (status === 'submitted') return 'badge-warning';
		if (status === 'reviewed') return 'badge-info';
		if (status === 'resolved') return 'badge-success';
		return 'badge-ghost';
	}
</script>

<svelte:head>
	<title>Send Feedback | Admin | Pure3D</title>
</svelte:head>

<div id="admin-feedback-page" class="mx-auto w-full max-w-6xl min-w-0">
	<div class="mb-8 flex flex-wrap items-start justify-between gap-4">
		<div>
			<h1 class="text-3xl font-bold">Send Feedback</h1>
			<p class="mt-2 text-base-content/60">
				Review submitted feedback from participants and visitors.
			</p>
		</div>
		<button class="btn btn-outline btn-sm" onclick={loadFeedback} disabled={isLoading}>
			{#if isLoading}<span class="loading loading-xs loading-spinner"></span>{/if}
			Refresh
		</button>
	</div>

	<section class="mb-6 rounded-box border border-base-300 bg-base-100 p-4 shadow-sm">
		<div class="mb-3">
			<h2 class="font-semibold">Email notifications</h2>
			<p class="text-sm text-base-content/60">
				These addresses receive an email whenever new feedback is submitted.
			</p>
		</div>
		<form
			class="flex flex-col gap-2 sm:flex-row"
			onsubmit={(event) => {
				event.preventDefault();
				addRecipient();
			}}
		>
			<label class="form-control min-w-0 flex-1">
				<span class="sr-only">Email address</span>
				<input
					type="email"
					required
					placeholder="notifications@example.org"
					class="input-bordered input w-full"
					bind:value={recipientEmail}
				/>
			</label>
			<button class="btn btn-primary" type="submit" disabled={isSavingRecipient}>
				{#if isSavingRecipient}<span class="loading loading-xs loading-spinner"></span>{/if}
				Add recipient
			</button>
		</form>

		{#if isLoadingRecipients}
			<div class="mt-4"><span class="loading loading-sm loading-spinner"></span></div>
		{:else if recipients.length === 0}
			<div class="mt-4 alert text-sm alert-warning">
				No recipients configured. Feedback will still be saved, but no email will be sent.
			</div>
		{:else}
			<ul class="mt-4 divide-y divide-base-300 rounded-box border border-base-300">
				{#each recipients as recipient (recipient.id)}
					<li class="flex items-center justify-between gap-3 px-3 py-2">
						<span class="min-w-0 truncate">{recipient.email}</span>
						<button
							type="button"
							class="btn text-error btn-ghost btn-xs"
							disabled={deletingRecipientId === recipient.id}
							onclick={() => deleteRecipient(recipient)}
						>
							{deletingRecipientId === recipient.id ? 'Removing...' : 'Remove'}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<div class="mb-6 rounded-box border border-base-300 bg-base-100 p-4 shadow-sm">
		<div class="mb-3 flex items-center justify-between gap-3">
			<div>
				<h2 class="text-sm font-semibold tracking-wide text-base-content/70 uppercase">Filters</h2>
				<p class="text-xs text-base-content/50">
					Find feedback by category, severity, status, or text.
				</p>
			</div>
			{#if hasActiveFilters}
				<button type="button" class="btn btn-ghost btn-xs" onclick={clearFilters}>Clear</button>
			{/if}
		</div>
		<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(16rem,1fr)_12rem_12rem_12rem]">
			<label class="form-control">
				<span class="label pt-0 pb-1"><span class="label-text text-xs">Search</span></span>
				<input
					type="text"
					placeholder="Participant, edition, feedback..."
					class="input-bordered input w-full bg-base-200/40"
					bind:value={searchQuery}
				/>
			</label>
			<label class="form-control">
				<span class="label pt-0 pb-1"><span class="label-text text-xs">Status</span></span>
				<FloatingSelect
					id="feedback-status-filter"
					bind:value={statusFilter}
					options={statusOptions}
					class="w-full bg-base-200/40"
					onchange={applyFilters}
				/>
			</label>
			<label class="form-control">
				<span class="label pt-0 pb-1"><span class="label-text text-xs">Category</span></span>
				<FloatingSelect
					id="feedback-category-filter"
					bind:value={categoryFilter}
					options={categoryOptions}
					class="w-full bg-base-200/40"
					onchange={applyFilters}
				/>
			</label>
			<label class="form-control">
				<span class="label pt-0 pb-1"><span class="label-text text-xs">Severity</span></span>
				<FloatingSelect
					id="feedback-severity-filter"
					bind:value={severityFilter}
					options={severityOptions}
					class="w-full bg-base-200/40"
					onchange={applyFilters}
				/>
			</label>
		</div>
	</div>

	<div class="mb-6 flex flex-wrap gap-2">
		<button
			type="button"
			class={`btn h-auto min-h-0 gap-2 rounded-full px-3 py-2 btn-xs ${statusFilter === '' ? 'btn-accent' : 'btn-outline'}`}
			onclick={() => filterByStatus('')}
		>
			<span class="font-medium">Total</span>
			<span class="font-mono text-sm">{feedback.length}</span>
		</button>
		<button
			type="button"
			class="btn h-auto min-h-0 gap-2 rounded-full px-3 py-2 opacity-75 btn-outline btn-xs"
			onclick={clearFilters}
		>
			<span class="font-medium">Visible</span>
			<span class="font-mono text-sm">{visibleCount}</span>
		</button>
		{#each statusOptions.filter((option) => option.value) as option (option.value)}
			<button
				type="button"
				class={`btn h-auto min-h-0 gap-2 rounded-full px-3 py-2 btn-xs ${statusFilter === option.value ? 'btn-accent' : 'opacity-75 btn-outline'}`}
				onclick={() => filterByStatus(option.value)}
			>
				<span class="font-medium">{option.label}</span>
				<span class="font-mono text-sm">{statusCounts[option.value] || 0}</span>
			</button>
		{/each}
	</div>

	{#if isLoading}
		<div class="flex justify-center py-12">
			<span class="loading loading-lg loading-spinner"></span>
		</div>
	{:else if feedback.length === 0}
		<p class="py-12 text-center text-base-content/60">No full feedback yet.</p>
	{:else if visibleFeedback.length === 0}
		<p class="py-12 text-center text-base-content/60">No feedback matches the current search.</p>
	{:else}
		<div class="space-y-3">
			{#each visibleFeedback as item (item.id)}
				<article class="rounded-box border border-base-300 bg-base-100 shadow-sm">
					<button
						type="button"
						class="flex w-full flex-wrap items-center gap-3 p-4 text-left"
						onclick={() => (expandedId = expandedId === item.id ? null : item.id)}
					>
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-2">
								<h2 class="font-semibold">{item.participantName}</h2>
								<span class="badge badge-outline"
									>{categoryLabels[item.category] || item.category}</span
								>
								<span class="badge badge-outline"
									>{severityLabels[item.severity] || item.severity}</span
								>
								<span class={`badge ${statusBadgeClass(item.status)}`}>
									{statusLabels[item.status] || item.status}
								</span>
							</div>
							<p class="mt-1 truncate text-sm text-base-content/60">
								{item.editionTitle || item.editionUrl || 'No edition linked'}
							</p>
						</div>
						<div class="text-sm text-base-content/50">{formatDate(item.created)}</div>
					</button>

					{#if expandedId === item.id}
						<div class="border-t border-base-300 p-4">
							<div class="mb-4 flex flex-wrap gap-2">
								{#if item.editionId}
									<a
										class="btn btn-outline btn-xs"
										href={resolve('/editions/[slug]', { slug: item.editionId })}>Open edition</a
									>
								{/if}
								{#if item.editionUrl}
									<SafeLink class="btn btn-outline btn-xs" href={item.editionUrl}
										>Open submitted URL</SafeLink
									>
								{/if}
								{#if item.status !== 'reviewed'}
									<button
										class="btn btn-xs btn-info"
										onclick={() => updateStatus(item, 'reviewed')}
									>
										Mark reviewed
									</button>
								{/if}
								{#if item.status !== 'resolved'}
									<button
										class="btn btn-xs btn-success"
										onclick={() => updateStatus(item, 'resolved')}
									>
										Mark resolved
									</button>
								{/if}
								{#if item.status !== 'submitted'}
									<button
										class="btn btn-ghost btn-xs"
										onclick={() => updateStatus(item, 'submitted')}
									>
										Reopen
									</button>
								{/if}
							</div>

							<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
								<div class="space-y-4">
									<div class="rounded-box bg-base-200 p-4 text-sm whitespace-pre-wrap">
										{contentText(item.feedbackHtml) || 'No written feedback.'}
									</div>

									{#if item.images.length > 0}
										<div class="grid grid-cols-2 gap-3 md:grid-cols-3">
											{#each item.images as filename (filename)}
												<SafeLink
													href={fullImageUrl(item, filename)}
													target="_blank"
													rel="noreferrer"
												>
													<img
														src={imageUrl(item, filename)}
														alt="Feedback screenshot"
														class="aspect-video w-full rounded border border-base-300 object-cover"
													/>
												</SafeLink>
											{/each}
										</div>
									{/if}
								</div>

								<dl class="space-y-3 rounded-box bg-base-200 p-4 text-sm">
									<div>
										<dt class="font-semibold">Email</dt>
										<dd class="break-words text-base-content/70">{item.participantEmail || '—'}</dd>
									</div>
									<div>
										<dt class="font-semibold">Page URL</dt>
										<dd class="break-words text-base-content/70">{item.pageUrl || '—'}</dd>
									</div>
									<div>
										<dt class="font-semibold">Browser</dt>
										<dd class="break-words text-base-content/70">
											{item.browserInfo.userAgent || '—'}
										</dd>
									</div>
									<div>
										<dt class="font-semibold">Viewport</dt>
										<dd class="text-base-content/70">{item.browserInfo.viewport || '—'}</dd>
									</div>
								</dl>
							</div>
						</div>
					{/if}
				</article>
			{/each}
		</div>

		{#if feedback.length >= perPage}
			<p class="mt-6 text-center text-sm text-base-content/60">
				Showing the latest {perPage} feedback entries.
			</p>
		{/if}
	{/if}
</div>
