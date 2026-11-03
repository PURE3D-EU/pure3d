<script lang="ts">
	import { resolve } from '$app/paths';
	let { showButton = true }: { showButton?: boolean } = $props();
</script>

<div id="feedback-button">
	{#if showButton}
		<a class="btn btn-sm" href={resolve('/resources/[slug]', { slug: 'contact' })}>Feedback</a>
	{/if}
</div>
