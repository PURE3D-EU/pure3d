<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { pb } from '$lib/database/client';
	let action = $state('');
	let token = $state('');
	let busy = $state(false);
	let done = $state(false);
	let error = $state('');
	onMount(() => {
		const params = new URLSearchParams(window.location.hash.slice(1));
		action = params.has('confirm') ? 'confirm' : params.has('unsubscribe') ? 'unsubscribe' : '';
		token = params.get(action) || '';
		// Keep private tokens out of browser history and subsequent referrers.
		replaceState(resolve('/newsletter'), page.state);
	});
	async function submit() {
		if (busy) return;
		busy = true;
		error = '';
		try {
			await pb.send(`/api/pure3d/newsletter/${action}`, { method: 'POST', body: { token } });
			done = true;
		} catch {
			error =
				'This link may be invalid or expired, or the service is unavailable. Please try again or request a new subscription link.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head
	><title>Newsletter · PURE3D</title><meta name="robots" content="noindex" /><meta
		name="referrer"
		content="no-referrer"
	/></svelte:head
>
<main id="page" class="mx-auto max-w-xl px-6 py-16">
	<h1 class="text-3xl font-semibold">
		{action === 'unsubscribe' ? 'Unsubscribe' : 'PURE3D newsletter'}
	</h1>
	{#if done}
		<p class="my-6" role="status">
			{action === 'confirm'
				? 'You’re subscribed. Thank you for joining the PURE3D newsletter.'
				: 'You’re unsubscribed. We will not send you any more newsletters.'}
		</p>
	{:else if action && token}
		<p class="my-6">
			{action === 'confirm'
				? 'Confirm your email address to receive PURE3D news, new editions and open calls.'
				: 'Would you like to stop receiving the PURE3D newsletter?'}
		</p>
		<button class="btn btn-primary" onclick={submit} disabled={busy}
			>{busy
				? 'Please wait…'
				: action === 'confirm'
					? 'Confirm subscription'
					: 'Unsubscribe'}</button
		>
	{:else}
		<p class="my-6">
			Subscribe using the form below, or follow the link in your newsletter email to manage your
			subscription.
		</p>
	{/if}
	{#if error}<p role="alert" class="mt-6 text-error">{error}</p>{/if}
	<a href={resolve('/')} class="mt-8 block text-sm underline">Back to PURE3D</a>
</main>
