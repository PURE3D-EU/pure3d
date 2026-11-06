<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { pb } from '$lib/database/client';
	import { authStore } from '$lib/database/stores/auth.svelte';
	import type { RecordModel } from 'pocketbase';
	type Counts = { pending: number; sending: number; sent: number; failed: number; skipped: number };
	let subscribers = $state<RecordModel[]>([]);
	let campaigns = $state<RecordModel[]>([]);
	let subscriberPage = $state(1);
	let totalPages = $state(1);
	let totalSubscribers = $state(0);
	let campaignPage = $state(1);
	let campaignPages = $state(1);
	let campaignStatus = $state('');
	let editorDialog: HTMLDialogElement;
	let subscriberDialog: HTMLDialogElement;
	let editorOpen = $state(false);
	let subscriberOpen = $state(false);
	let subscriberEmail = $state('');
	let consent = $state(false);
	let consentNote = $state('');
	let search = $state('');
	let status = $state('');
	let selected = $state<RecordModel | null>(null);
	let subject = $state('');
	let body = $state('');
	let counts = $state<Counts | null>(null);
	let busy = $state(false);
	let loading = $state(true);
	let sending = $state(false);
	let stop = $state(false);
	let error = $state('');
	let notice = $state('');
	let dirty = $derived(subject !== (selected?.subject || '') || body !== (selected?.body || ''));
	let locked = $derived(!!selected && selected.status !== 'draft');
	let subscriberDirty = $derived(subscriberOpen && !!(subscriberEmail || consentNote || consent));
	beforeNavigate((navigation) => {
		if (dirty || sending || subscriberDirty) {
			if (navigation.willUnload) {
				navigation.cancel();
				return;
			}
			const prompt = sending
				? 'Leave this page? Sending will pause after the current batch.'
				: subscriberDirty
					? 'Discard this subscriber entry?'
					: 'Discard unsaved newsletter changes?';
			if (!confirm(prompt)) navigation.cancel();
			else stop = true;
		}
	});
	onDestroy(() => {
		stop = true;
	});
	function message(e: unknown) {
		const response = e as { response?: { message?: string } };
		return (
			response.response?.message ||
			'The newsletter service is unavailable. Check that its PocketBase collections and hooks are installed.'
		);
	}
	async function loadSubscribers() {
		const filters: string[] = [];
		if (search.trim()) filters.push(pb.filter('email ~ {:email}', { email: search.trim() }));
		if (status) filters.push(pb.filter('status = {:status}', { status }));
		const result = await pb
			.collection('newsletter_subscribers')
			.getList(subscriberPage, 20, { sort: '-created', filter: filters.join(' && ') });
		subscribers = result.items;
		totalPages = result.totalPages;
		totalSubscribers = result.totalItems;
	}
	async function loadCampaigns() {
		const result = await pb.collection('newsletter_campaigns').getList(campaignPage, 20, {
			sort: '-created',
			filter: campaignStatus ? pb.filter('status = {:status}', { status: campaignStatus }) : ''
		});
		campaigns = result.items;
		campaignPages = result.totalPages;
	}
	async function run(task: () => Promise<void>) {
		if (busy) return;
		busy = true;
		error = '';
		notice = '';
		try {
			await task();
		} catch (e) {
			error = message(e);
		} finally {
			busy = false;
		}
	}
	async function choose(campaign: RecordModel | null) {
		if (dirty && !confirm('Discard unsaved newsletter changes?')) return;
		selected = campaign;
		subject = campaign?.subject || '';
		body = campaign?.body || '';
		counts = null;
		editorDialog.showModal();
		editorOpen = true;
		if (campaign && campaign.status !== 'draft')
			counts = await pb.send(`/api/pure3d/newsletter/campaigns/${campaign.id}/progress`, {});
	}
	function closeEditor() {
		if (busy && !sending) return;
		if (sending && !confirm('Pause sending after the current batch and close?')) return;
		if (dirty && !confirm('Discard unsaved newsletter changes?')) return;
		stop = true;
		subject = selected?.subject || '';
		body = selected?.body || '';
		editorDialog.close();
	}
	function openSubscriber() {
		subscriberEmail = '';
		consent = false;
		consentNote = '';
		error = '';
		notice = '';
		subscriberDialog.showModal();
		subscriberOpen = true;
	}
	function closeSubscriber() {
		if (busy) return;
		if (subscriberDirty && !confirm('Discard this subscriber entry?')) return;
		subscriberDialog.close();
	}
	async function addSubscriber() {
		const result = await pb.send<{ alreadySubscribed: boolean }>(
			'/api/pure3d/newsletter/subscribers',
			{
				method: 'POST',
				body: { email: subscriberEmail, consent, consentNote }
			}
		);
		subscriberDialog.close();
		subscriberPage = 1;
		search = '';
		status = '';
		notice = result.alreadySubscribed
			? 'This address is already subscribed. Its consent record was not changed.'
			: 'Subscriber added. No email was sent.';
		await loadSubscribers();
	}
	async function save() {
		selected = await pb.send('/api/pure3d/newsletter/drafts', {
			method: 'POST',
			body: { id: selected?.id, version: selected?.updated, subject, body }
		});
		subject = selected!.subject;
		body = selected!.body;
		notice = 'Draft saved.';
		await loadCampaigns();
	}
	async function send() {
		if (!selected || dirty) return;
		if (!confirm('Send this saved newsletter to subscribed addresses? Emails cannot be recalled.'))
			return;
		sending = true;
		stop = false;
		const id = selected.id;
		const version = selected.updated;
		try {
			do {
				counts = await pb.send(`/api/pure3d/newsletter/campaigns/${id}/send`, {
					method: 'POST',
					body: { version }
				});
				selected = await pb.collection('newsletter_campaigns').getOne(id);
			} while (counts && counts.pending > 0 && !stop);
			notice = stop
				? 'Paused after the current batch. You can continue later.'
				: 'Sending finished. Review the delivery counts below.';
		} finally {
			sending = false;
			await loadCampaigns();
		}
	}
	onMount(() => {
		if (authStore.globalRole !== 'admin') return;
		void run(async () => {
			try {
				await Promise.all([loadSubscribers(), loadCampaigns()]);
			} finally {
				loading = false;
			}
		});
	});
</script>

<svelte:head><title>Newsletter · PURE3D admin</title></svelte:head>
<div id="page">
	{#if authStore.globalRole === 'admin'}
		<h1 class="text-3xl font-semibold">Newsletter</h1>
		<p class="mt-2 mb-8 text-sm opacity-60">
			Manage subscribers and send simple email updates. Only subscribed addresses receive
			newsletters.
		</p>
		{#if error && !editorOpen && !subscriberOpen}<p class="mb-6 alert alert-error" role="alert">
				{error}
			</p>{/if}
		{#if notice && !editorOpen && !subscriberOpen}<p class="mb-6 alert" role="status">
				{notice}
			</p>{/if}
		{#if loading}<p role="status" class="mb-6 animate-pulse">Loading newsletter…</p>{/if}
		<div>
			<section class="min-w-0 rounded-xl border border-base-300 p-6" aria-label="Saved newsletters">
				<div class="mb-6 flex flex-wrap items-center justify-between gap-3">
					<h2 class="text-xl font-semibold">Newsletters</h2>
					<button class="btn btn-primary" disabled={busy} onclick={() => run(() => choose(null))}
						>New newsletter</button
					>
				</div>
				<div class="mb-6 flex flex-wrap gap-2" role="group" aria-label="Filter newsletters">
					{#each [{ value: '', label: 'All' }, { value: 'draft', label: 'Drafts' }, { value: 'sending', label: 'Sending / paused' }, { value: 'sent', label: 'Sent' }] as filter (filter.value)}
						<button
							class="btn btn-sm"
							class:btn-outline={campaignStatus !== filter.value}
							class:btn-neutral={campaignStatus === filter.value}
							aria-pressed={campaignStatus === filter.value}
							disabled={busy}
							onclick={() =>
								run(async () => {
									campaignStatus = filter.value;
									campaignPage = 1;
									await loadCampaigns();
								})}>{filter.label}</button
						>
					{/each}
				</div>
				{#if !campaigns.length && !loading}<p class="text-sm opacity-60">
						No newsletters found. Choose New newsletter to start a draft.
					</p>{/if}
				<ul class="space-y-3">
					{#each campaigns as campaign (campaign.id)}<li>
							<button
								class="w-full rounded-lg p-3 text-left hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
								class:bg-base-200={selected?.id === campaign.id}
								disabled={busy}
								onclick={() => run(() => choose(campaign))}
								><span class="block font-medium break-words">{campaign.subject}</span><span
									class="text-xs opacity-60"
									>{campaign.status === 'sent'
										? 'Finished'
										: campaign.status === 'sending'
											? 'Sending / paused'
											: 'Draft'} · {new Date(campaign.created).toLocaleDateString('en-GB')}</span
								></button
							>
						</li>{/each}
				</ul>
				<div class="mt-6 flex items-center gap-3">
					<button
						class="btn btn-ghost btn-sm"
						disabled={busy || campaignPage <= 1}
						onclick={() =>
							run(async () => {
								campaignPage--;
								await loadCampaigns();
							})}>Previous</button
					><span class="text-xs">Page {campaignPage}</span><button
						class="btn btn-ghost btn-sm"
						disabled={busy || campaignPage >= campaignPages}
						onclick={() =>
							run(async () => {
								campaignPage++;
								await loadCampaigns();
							})}>Next</button
					>
				</div>
			</section>
			<dialog
				bind:this={editorDialog}
				class="modal"
				aria-labelledby="newsletter-editor-title"
				oncancel={(event) => {
					event.preventDefault();
					closeEditor();
				}}
				onclose={() => {
					editorOpen = false;
				}}
			>
				<div
					class="modal-box max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto border border-base-300 bg-base-100 p-6"
				>
					<div class="mb-6 flex items-start justify-between gap-4">
						<h2 id="newsletter-editor-title" class="text-xl font-semibold">
							{locked ? 'Newsletter details' : selected ? 'Edit draft' : 'New newsletter'}
						</h2>
						<button
							type="button"
							class="btn btn-ghost btn-sm"
							aria-label="Close newsletter"
							disabled={busy && !sending}
							onclick={closeEditor}>Close</button
						>
					</div>
					{#if error}<p class="mb-6 alert alert-error" role="alert">{error}</p>{/if}
					{#if notice}<p class="mb-6 alert" role="status">{notice}</p>{/if}
					<form
						class="space-y-5"
						onsubmit={(e) => {
							e.preventDefault();
							void run(save);
						}}
					>
						<label class="block text-sm font-medium"
							>Subject<input
								class="input mt-2 w-full"
								required
								maxlength="200"
								bind:value={subject}
								disabled={busy || locked}
							/></label
						>
						<label class="block text-sm font-medium"
							>Message<textarea
								class="textarea mt-2 min-h-64 w-full"
								required
								maxlength="20000"
								bind:value={body}
								disabled={busy || locked}
							></textarea></label
						>
						<p class="text-xs opacity-60">
							Plain text keeps things simple. An unsubscribe link is added to every subscriber
							email. Up to 1,000 subscribed addresses per newsletter.
						</p>
						{#if !locked}<button class="btn btn-primary" disabled={busy || !dirty}
								>{busy ? 'Please wait…' : 'Save draft'}</button
							>{/if}
					</form>
					{#if selected}<div class="mt-5 flex flex-wrap gap-3">
							<button
								class="btn btn-outline"
								disabled={busy || dirty}
								onclick={() =>
									run(async () => {
										await pb.send(`/api/pure3d/newsletter/campaigns/${selected!.id}/test`, {
											method: 'POST'
										});
										notice = 'Test email sent to your admin account address.';
									})}>Send me a test</button
							>
							{#if selected.status !== 'sent'}<button
									class="btn btn-primary"
									disabled={busy || dirty}
									onclick={() => run(send)}
									>{selected.status === 'draft' ? 'Send newsletter' : 'Continue sending'}</button
								>{/if}
							{#if sending}<button
									class="btn btn-outline"
									disabled={stop}
									onclick={() => {
										stop = true;
									}}>Pause after this batch</button
								>{/if}
						</div>{/if}
					{#if dirty && selected}<p class="mt-3 text-xs opacity-60">
							Save your changes before testing or sending.
						</p>{/if}
					{#if counts}<div class="mt-6 rounded-lg bg-base-200 p-4 text-sm" role="status">
							<p>
								{counts.sent} sent · {counts.pending} waiting · {counts.sending} in progress · {counts.failed}
								failed · {counts.skipped} skipped
							</p>
							{#if counts.failed || counts.sending}<p class="mt-2 opacity-70">
									Failed or interrupted deliveries are not retried automatically, to avoid duplicate
									emails. Ask an administrator to investigate before sending another newsletter.
								</p>{/if}
						</div>{/if}
				</div>
				<div class="modal-backdrop">
					<button type="button" aria-label="Close newsletter" onclick={closeEditor}>Close</button>
				</div>
			</dialog>
		</div>
		<section class="mt-8 rounded-xl border border-base-300 p-6" aria-label="Subscribers">
			<div class="flex flex-wrap items-center justify-between gap-4">
				<h2 class="text-xl font-semibold">
					Subscribers <span class="text-base font-normal opacity-60">({totalSubscribers})</span>
				</h2>
				<button class="btn btn-outline" disabled={busy} onclick={openSubscriber}
					>Add subscriber</button
				>
			</div>
			<p class="mt-2 text-sm opacity-60">
				People can confirm through the signup form, or be added with recorded permission. Pending
				addresses are not subscribed.
			</p>
			<form
				class="my-6 flex flex-wrap items-end gap-3"
				onsubmit={(e) => {
					e.preventDefault();
					void run(async () => {
						subscriberPage = 1;
						await loadSubscribers();
					});
				}}
			>
				<label class="min-w-0 flex-1 text-sm"
					>Find an address<input
						class="input mt-2 w-full"
						type="search"
						bind:value={search}
					/></label
				><label class="text-sm"
					>Status<select class="select mt-2 block" bind:value={status}
						><option value="">All statuses</option><option value="subscribed">Subscribed</option
						><option value="pending">Pending</option><option value="unsubscribed"
							>Unsubscribed</option
						></select
					></label
				><button class="btn btn-outline" disabled={busy}>Filter</button>
			</form>
			<div class="overflow-x-auto">
				<table class="table">
					<thead
						><tr
							><th>Email address</th><th>Status</th><th>Consent recorded</th><th
								><span class="sr-only">Actions</span></th
							></tr
						></thead
					><tbody
						>{#each subscribers as subscriber (subscriber.id)}<tr
								><td>{subscriber.email}</td><td
									><span class="badge badge-neutral">{subscriber.status}</span></td
								><td
									>{subscriber.consentRecordedAt || subscriber.confirmedAt
										? new Date(
												subscriber.consentRecordedAt || subscriber.confirmedAt
											).toLocaleDateString('en-GB')
										: 'Not recorded'}{#if subscriber.consentSource === 'admin_recorded'}<span
											class="mt-1 block text-xs opacity-60">Added by admin</span
										>
										<details class="mt-1 text-xs">
											<summary class="cursor-pointer underline">Consent details</summary>
											<p class="mt-2 max-w-sm whitespace-pre-wrap">{subscriber.consentNote}</p>
										</details>{/if}</td
								><td
									>{#if subscriber.status !== 'unsubscribed'}<button
											class="btn btn-ghost btn-sm"
											disabled={busy}
											onclick={() => {
												if (confirm(`Unsubscribe ${subscriber.email}?`))
													void run(async () => {
														await pb.send(
															`/api/pure3d/newsletter/subscribers/${subscriber.id}/unsubscribe`,
															{ method: 'POST' }
														);
														await loadSubscribers();
														notice = 'Address unsubscribed.';
													});
											}}>Unsubscribe</button
										>{/if}</td
								></tr
							>{:else}<tr><td colspan="4">{loading ? 'Loading…' : 'No subscribers found.'}</td></tr
							>{/each}</tbody
					>
				</table>
			</div>
			<div class="mt-6 flex items-center justify-end gap-3">
				<button
					class="btn btn-outline btn-sm"
					disabled={busy || subscriberPage <= 1}
					onclick={() =>
						run(async () => {
							subscriberPage--;
							await loadSubscribers();
						})}>Previous</button
				><span class="text-sm">Page {subscriberPage}</span><button
					class="btn btn-outline btn-sm"
					disabled={busy || subscriberPage >= totalPages}
					onclick={() =>
						run(async () => {
							subscriberPage++;
							await loadSubscribers();
						})}>Next</button
				>
			</div>
		</section>
		<dialog
			bind:this={subscriberDialog}
			class="modal"
			aria-labelledby="newsletter-add-subscriber-title"
			oncancel={(event) => {
				event.preventDefault();
				closeSubscriber();
			}}
			onclose={() => {
				subscriberOpen = false;
			}}
		>
			<div
				class="modal-box max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto border border-base-300 bg-base-100 p-6"
			>
				<div class="mb-6 flex items-start justify-between gap-4">
					<h2 id="newsletter-add-subscriber-title" class="text-xl font-semibold">Add subscriber</h2>
					<button
						type="button"
						class="btn btn-ghost btn-sm"
						disabled={busy}
						onclick={closeSubscriber}>Close</button
					>
				</div>
				<p class="mb-6 text-sm opacity-70">
					Add someone who has already agreed to receive the PURE3D newsletter. This subscribes them
					directly without sending a confirmation email. Previously unsubscribed addresses must
					subscribe themselves again.
				</p>
				{#if error}<p class="mb-6 alert alert-error" role="alert">{error}</p>{/if}
				<form
					class="space-y-5"
					onsubmit={(event) => {
						event.preventDefault();
						void run(addSubscriber);
					}}
				>
					<label class="block text-sm font-medium"
						>Email address<input
							type="email"
							autocomplete="email"
							class="input mt-2 w-full"
							maxlength="254"
							required
							bind:value={subscriberEmail}
							disabled={busy}
						/></label
					>
					<label class="block text-sm font-medium"
						>Consent record<textarea
							class="textarea mt-2 min-h-24 w-full"
							maxlength="1000"
							required
							placeholder="Where and when did they agree to receive the newsletter?"
							bind:value={consentNote}
							disabled={busy}
						></textarea></label
					>
					<label class="flex items-start gap-3 text-sm"
						><input
							type="checkbox"
							class="checkbox checkbox-sm"
							required
							bind:checked={consent}
							disabled={busy}
						/><span>I confirm this person has agreed to receive the PURE3D newsletter.</span></label
					>
					<div class="flex flex-wrap justify-end gap-3">
						<button type="button" class="btn btn-outline" disabled={busy} onclick={closeSubscriber}
							>Cancel</button
						><button class="btn btn-primary" disabled={busy}
							>{busy ? 'Adding…' : 'Add subscriber'}</button
						>
					</div>
				</form>
			</div>
			<div class="modal-backdrop">
				<button type="button" aria-label="Close add subscriber" onclick={closeSubscriber}
					>Close</button
				>
			</div>
		</dialog>
	{:else}<p>Administrator access required.</p>{/if}
</div>
