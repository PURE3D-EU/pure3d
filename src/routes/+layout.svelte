<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.png';
	import FeedbackPill from '$lib/components/ui/FeedbackPill.svelte';
	import Header from '$lib/components/ui/Header.svelte';
	import SiteFooter from '$lib/components/ui/SiteFooter.svelte';
	import { Toaster } from 'svelte-french-toast';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/database/stores/auth.svelte';

	let { children } = $props();
	onMount(() => authStore.watchSession());
</script>

<Header />

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="-mt-10 min-h-[calc(100vh-4rem)] bg-base-100 text-base-content">
	{#if authStore.sessionLocked}
		<p role="status">Your session has expired. Please sign in with ORCID again.</p>
	{:else}
		{@render children?.()}
	{/if}
</div>

<FeedbackPill />

<SiteFooter />

<Toaster />
