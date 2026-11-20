<script lang="ts">
	import type { Credit } from '$lib/types/credits';
	import { normalizeOrcid } from '$lib/utils/credits';
	import IconArrowUp from '~icons/heroicons/arrow-up';
	import IconArrowDown from '~icons/heroicons/arrow-down';
	import IconTrash from '~icons/heroicons/trash';
	let {
		credits = $bindable<Credit[]>([]),
		disabled = false,
		authorsOnly = false,
		affiliations = {}
	}: {
		credits: Credit[];
		disabled?: boolean;
		authorsOnly?: boolean;
		affiliations?: Record<string, string>;
	} = $props();

	function move(index: number, direction: number) {
		const reordered = [...credits];
		[reordered[index], reordered[index + direction]] = [
			reordered[index + direction],
			reordered[index]
		];
		credits = reordered;
	}
</script>

<div id="credits-editor" class="space-y-3">
	{#if !authorsOnly}<h3 class="font-semibold">Creators and contributors</h3>{/if}
	<p class="text-sm text-base-content/70">
		{#if authorsOnly}To add co-authors, please add them with their name and ORCID ID. Adding an
			author at this stage of the process will give them credit. Editing rights for co-authors
			are done at a later stage.
		{:else}Every individual creator needs an ORCID to submit or publish. Organisations do not.
			Contributors are optional. Linking a user does not grant access.{/if}
	</p>
	{#each credits as credit, index (credit)}
		<fieldset
			{disabled}
			class={authorsOnly ? 'space-y-3 rounded-box bg-base-200/50 p-3' : 'space-y-3 rounded-box border border-base-300 p-3'}
		>
			<legend class={authorsOnly ? 'sr-only' : 'px-1 text-sm font-semibold'}
				>{authorsOnly ? 'Author' : 'Credit'} {index + 1}</legend
			>
			{#if authorsOnly}
				<div class="flex items-center justify-between gap-3">
					<span class="text-sm font-semibold">Author {index + 1}</span>
					<div class="flex items-center gap-1">
						{#if credits.length > 1}
							<button type="button" class="btn btn-square btn-ghost btn-sm" disabled={index === 0} onclick={() => move(index, -1)} aria-label={`Move author ${index + 1} up`} title="Move up"><IconArrowUp class="size-4" aria-hidden="true" /></button>
							<button type="button" class="btn btn-square btn-ghost btn-sm" disabled={index === credits.length - 1} onclick={() => move(index, 1)} aria-label={`Move author ${index + 1} down`} title="Move down"><IconArrowDown class="size-4" aria-hidden="true" /></button>
						{/if}
						<button type="button" class="btn btn-square btn-ghost btn-sm" onclick={() => (credits = credits.filter((_, i) => i !== index))} aria-label={`Remove author ${index + 1}`} title="Remove author"><IconTrash class="size-4" aria-hidden="true" /></button>
					</div>
				</div>
			{/if}
			<div class="grid gap-3 sm:grid-cols-2" class:author-fields={authorsOnly}>
				<label class="form-control"
					>Name<input
						class="input-bordered input w-full"
						bind:value={credit.name}
						required
					/></label
				>
				{#if authorsOnly}
					<label class="flex flex-col"
						>Affiliation<input
							class="input-bordered input w-full"
							readonly
							value={credit.userId ? affiliations[credit.userId] || '' : ''}
							placeholder="From the author’s profile"
						/></label
					>
				{:else}
					<label class="form-control"
						>Type<select class="select-bordered select w-full" bind:value={credit.type}
							><option value="person">Person</option><option value="org">Organisation</option
							></select
						></label
					>
					<label class="form-control"
						>Credit role<select class="select-bordered select w-full" bind:value={credit.role}
							><option value="creator">Creator</option><option value="contributor"
								>Contributor</option
							></select
						></label
					>
				{/if}
				<label class="form-control"
					>ORCID<input
						class="input-bordered input w-full"
						value={credit.orcid ?? ''}
						oninput={(event) => (credit.orcid = event.currentTarget.value || null)}
						onblur={() => {
							credit.orcid = normalizeOrcid(credit.orcid) || credit.orcid;
						}}
						placeholder="https://orcid.org/0000-0000-0000-0000"
						aria-invalid={!!credit.orcid && !normalizeOrcid(credit.orcid)}
					/></label
				>
				{#if !authorsOnly}
					<label class="form-control"
						>Linked user ID (optional)<input
							class="input-bordered input w-full"
							value={credit.userId ?? ''}
							oninput={(event) => {
								const value = event.currentTarget.value.trim();
								if (value) credit.userId = value;
								else delete credit.userId;
							}}
						/></label
					>
					<label class="form-control"
						>Contribution role (optional)<input
							class="input-bordered input w-full"
							bind:value={credit.contributionRole}
						/></label
					>
				{/if}
			</div>
			{#if credit.orcid && !normalizeOrcid(credit.orcid)}<p class="text-sm text-error">
					Enter a valid ORCID, including its checksum.
				</p>{/if}
			{#if !authorsOnly}
			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					class="btn btn-sm"
					disabled={index === 0}
					onclick={() => move(index, -1)}
					aria-label={`Move credit ${index + 1} up`}>Up</button
				>
				<button
					type="button"
					class="btn btn-sm"
					disabled={index === credits.length - 1}
					onclick={() => move(index, 1)}
					aria-label={`Move credit ${index + 1} down`}>Down</button
				>
				<button
					type="button"
					class="btn btn-sm"
					onclick={() => (credits = credits.filter((_, i) => i !== index))}
					aria-label={`Remove credit ${index + 1}`}>Remove</button
				>
			</div>
			{/if}
		</fieldset>
	{/each}
	<button
		type="button"
		class="btn btn-sm"
		{disabled}
		onclick={() =>
			(credits = [
				...credits,
				{ type: 'person', name: '', orcid: null, role: 'creator', provenance: 'manual' }
			])}>{authorsOnly ? 'Add co-author' : 'Add credit'}</button
	>
</div>

<style>
	.author-fields label {
		font-size: 0.75rem;
		line-height: 1.5;
		gap: 0.25rem;
	}
</style>
