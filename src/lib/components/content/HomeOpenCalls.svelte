<script lang="ts">
	import { onMount } from 'svelte';
	import type { RecordModel } from 'pocketbase';
	import { pb } from '$lib/database/client';
	import OpenCallCards from './OpenCallCards.svelte';

	let calls = $state<RecordModel[]>([]);

	onMount(async () => {
		try {
			calls = await pb.collection('open_calls').getFullList({
				filter: pb.filter('isPublished = true && (deadline = "" || deadline >= {:today})', {
					today: `${new Date().toISOString().slice(0, 10)} 00:00:00.000Z`
				}),
				sort: 'order,deadline,title'
			});
		} catch {
			// Keep the rest of the homepage available.
		}
	});
</script>

<div id="home-open-calls">
	{#if calls.length}
		<section aria-labelledby="home-open-calls-title" class="calls-section">
			<div class="calls-shell">
				<header class="calls-heading">
					<p class="eyebrow">
						<span class="signal" aria-hidden="true"></span> Open for proposals
					</p>
					<h2 id="home-open-calls-title">Thematic Calls</h2>
				</header>
				<OpenCallCards {calls} />
			</div>
		</section>
	{/if}
</div>

<style>
	.calls-section {
		background: var(--color-base-200);
		border-bottom: 1px solid var(--rule);
		padding: clamp(48px, 6vw, 88px) 0;
	}
	.calls-shell {
		max-width: 1320px;
		margin: 0 auto;
		padding: 0 clamp(20px, 4vw, 48px);
	}
	.calls-heading {
		margin-bottom: 34px;
	}
	.eyebrow {
		display: flex;
		align-items: center;
		gap: 9px;
		font: 500 11px/1.4 var(--font-sans);
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.signal {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-vermillion-ink);
	}
	h2 {
		margin: 17px 0 0;
		font: 500 clamp(34px, 4vw, 52px) / 1.04 var(--font-sans);
		letter-spacing: -0.045em;
	}
</style>
