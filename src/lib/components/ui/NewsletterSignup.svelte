<script lang="ts">
	import { onDestroy } from 'svelte';
	import { pb } from '$lib/database/client';
	let {
		id = 'newsletter-signup',
		email = '',
		framed = false
	}: { id?: string; email?: string; framed?: boolean } = $props();
	let website = $state('');
	let busy = $state(false);
	let done = $state(false);
	let error = $state('');
	let controller: AbortController | undefined;
	onDestroy(() => controller?.abort());
	async function subscribe(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		busy = true;
		error = '';
		const request = new AbortController();
		controller = request;
		const timeout = setTimeout(() => request.abort(), 20000);
		try {
			await pb.send('/api/pure3d/newsletter/subscribe', {
				method: 'POST',
				body: { email, website },
				signal: request.signal
			});
			done = true;
		} catch (cause) {
			const status = (cause as { status?: number }).status;
			error = request.signal.aborted
				? 'The confirmation email is taking too long. Check your inbox before trying again, and allow 15 minutes between requests.'
				: status === 429
					? 'Please wait a minute before trying again.'
					: status === 503
						? 'Confirmation email is currently unavailable. Please try again later.'
						: 'We could not process your subscription. Please try again later.';
		} finally {
			clearTimeout(timeout);
			controller = undefined;
			busy = false;
		}
	}
</script>

<section
	{id}
	class="mb-8 grid gap-6 rounded-xl bg-base-100 p-6 md:grid-cols-2 md:items-center"
	class:border={framed}
	class:border-base-300={framed}
>
	<div>
		<h2 class="text-xl font-semibold">Subscribe to our newsletter</h2>
		<p class="mt-2 text-sm opacity-70">
			PURE3D news, new editions and open calls. Unsubscribe at any time.
		</p>
	</div>
	<div>
		{#if done}
			<p role="status" class="text-sm">
				If your address needs confirmation, we’ll send you an email. Follow the link to subscribe.
			</p>
		{:else}
			<form onsubmit={subscribe} class="space-y-3" aria-busy={busy}>
				<label for={`${id}-email`} class="block text-sm font-medium">Add your email</label>
				<div class="flex flex-col gap-3 sm:flex-row">
					<input
						id={`${id}-email`}
						class="input min-w-0 flex-1"
						type="email"
						autocomplete="email"
						required
						maxlength="254"
						placeholder="you@example.org"
						bind:value={email}
						disabled={busy}
					/>
					<button class="btn btn-primary" disabled={busy}
						>{busy ? 'Subscribing…' : 'Subscribe'}</button
					>
				</div>
				<div class="hidden" aria-hidden="true">
					<label
						>Leave this empty<input tabindex="-1" autocomplete="off" bind:value={website} /></label
					>
				</div>
				<p class="text-xs opacity-60">
					By subscribing, you agree to receive the PURE3D newsletter. Please confirm your email
					address to join.
				</p>
			</form>
		{/if}
		{#if error}<p class="mt-3 text-sm text-error" role="alert">{error}</p>{/if}
	</div>
</section>
