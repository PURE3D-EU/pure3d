<script lang="ts">
	import { onMount } from 'svelte';
	import type { RecordModel } from 'pocketbase';
	import { pb } from '$lib/database/client';
	import ContentRenderer from './ContentRenderer.svelte';

	interface Props {
		ids: string[];
	}

	let { ids }: Props = $props();
	let calls = $state<RecordModel[]>([]);

	function deadline(value: string) {
		if (!value) return '';
		return new Intl.DateTimeFormat('en-GB', {
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		}).format(new Date(value));
	}

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

<div id="content-open-calls" class="not-prose my-6 space-y-3">
	{#each calls as call (call.id)}
		<details class="group rounded-box border border-base-300 bg-base-100">
			<summary
				class="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 marker:hidden"
			>
				<span class="flex min-w-0 items-center gap-4">
					{#if call.cover}<img
							src={pb.files.getURL(call, call.cover)}
							alt=""
							loading="lazy"
							width="80"
							height="80"
							class="aspect-square w-20 shrink-0 rounded object-contain"
						/>{/if}
					<span class="min-w-0 wrap-anywhere">
						<span class="block font-semibold">{call.title}</span>
						{#if call.shortDescription?.trim()}
							<span class="mt-1 block text-sm opacity-70">{call.shortDescription}</span>
						{/if}
						{#if call.deadline}
							<span class="mt-1 block text-sm opacity-65 sm:hidden">
								Deadline {deadline(call.deadline)}
							</span>
						{/if}
					</span>
				</span>
				<span class="flex shrink-0 items-center gap-3 text-sm opacity-65">
					{#if call.deadline}<span class="hidden sm:inline">Deadline {deadline(call.deadline)}</span
						>{/if}
					<span aria-hidden="true" class="text-lg transition-transform group-open:rotate-45">+</span
					>
				</span>
			</summary>
			<div class="border-t border-base-300 px-5 py-5">
				<ContentRenderer content={call.body || ''} renderOpenCalls={false} />
			</div>
		</details>
	{/each}
</div>
