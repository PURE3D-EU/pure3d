<script lang="ts">
	import { onMount } from 'svelte';
	import type { RecordModel } from 'pocketbase';
	import { pb } from '$lib/database/client';
	import OpenCallCards from './OpenCallCards.svelte';

	interface Props {
		ids: string[];
	}

	let { ids }: Props = $props();
	let calls = $state<RecordModel[]>([]);

	onMount(async () => {
		if (!ids.length) return;
		try {
			const filter = pb.filter(
				`isPublished = true && (${ids.map((_, index) => `id = {:id${index}}`).join(' || ')})`,
				Object.fromEntries(ids.map((id, index) => [`id${index}`, id]))
			);
			const records = await pb.collection('open_calls').getFullList({ filter });
			const byId = new Map(records.map((record) => [record.id, record]));
			calls = ids.flatMap((id) => {
				const record = byId.get(id);
				return record ? [record] : [];
			});
		} catch {
			calls = [];
		}
	});
</script>

<div id="content-open-calls" class:my-6={calls.length > 0}>
	{#if calls.length}
		<OpenCallCards {calls} />
	{/if}
</div>
