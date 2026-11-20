<script lang="ts">
	import type { RecordModel } from 'pocketbase';
	import { pb } from '$lib/database/client';
	import {
		formatOpenCallDeadline,
		MODEL_SOURCES,
		PROPOSAL_AUDIENCES,
		OBJECT_LINKS_LABEL,
		isProposalLink
	} from '$lib/workflow/proposal';
	import ProposalModelUploads from '$lib/components/uploads/ProposalModelUploads.svelte';
	import toast from 'svelte-french-toast';
	let { record, embedded = false }: { record: RecordModel; embedded?: boolean } = $props();
	const questions = [
		['proposalPurpose', 'Purpose'],
		['proposalModelReferences', 'Model links and published materials'],
		['proposalArgument', 'Narrative or story'],
		['proposalThreeDRationale', 'Why 3D'],
		['proposalContextualMaterial', 'Contextual material']
	];
	let openCall = $derived.by(() => {
		const value = record.proposalSnapshot?.openCall;
		return value && typeof value.id === 'string' && typeof value.title === 'string' ? value : null;
	});
	function labels(values: unknown, options: ReadonlyArray<readonly [string, string]>) {
		return Array.isArray(values)
			? values.map((value) => options.find(([id]) => id === value)?.[1] || value).join(', ')
			: 'Not provided';
	}
	async function download(filename: string) {
		try {
			const token = await pb.files.getToken();
			const anchor = document.createElement('a');
			anchor.href = pb.files.getURL(record, filename, { token, download: true });
			anchor.download = filename;
			anchor.click();
		} catch {
			toast.error('Could not download the file. Please try again.');
		}
	}
</script>

<section
	id="proposal-summary"
	class="{embedded ? 'space-y-3' : 'space-y-6 rounded-box border border-base-300 bg-base-100 p-5 sm:p-6'}"
>
	{#if !embedded}<h2 class="text-xl font-semibold">Submitted proposal</h2>{/if}
	<dl class="compact-summary text-sm">
		<div class={embedded ? 'grid grid-cols-[5rem_1fr] gap-2' : ''}>
			<dt class="font-semibold">Proposal Type</dt>
			<dd>
				{#if openCall}
					{openCall.title}{openCall.deadline
						? ` · deadline ${formatOpenCallDeadline(openCall.deadline)}`
						: ''}
				{:else}General submission{/if}
			</dd>
		</div>
		<div class={embedded ? 'grid grid-cols-[5rem_1fr] gap-2' : ''}>
			<dt class="font-semibold">Authors</dt>
			<dd>
				<ul>
					{#each record.proposalAuthorAffiliations || [] as author, index (index)}<li>
							{author.name}{author.affiliation ? ` — ${author.affiliation}` : ''}
						</li>{/each}
				</ul>
			</dd>
		</div>
		{#if embedded}
			<div class="grid grid-cols-[5rem_1fr] gap-2">
				<dt class="font-semibold">Audience</dt>
				<dd>{labels(record.proposalAudience, PROPOSAL_AUDIENCES)}</dd>
			</div>
		{/if}
		{#each questions as [field, label] (field)}
			<div>
				<dt class="font-semibold">{label}</dt>
				<dd class="mt-1 break-words whitespace-pre-wrap">{record[field] || 'Not provided'}</dd>
			</div>
		{/each}
		{#if !embedded}
		<div>
			<dt class="font-semibold">Audience</dt>
			<dd>{labels(record.proposalAudience, PROPOSAL_AUDIENCES)}</dd>
		</div>
		{/if}
	</dl>
	<details open={!embedded}>
		<summary class="cursor-pointer text-sm font-semibold">Model & digitisation details</summary>
		<dl class="compact-summary mt-3 text-sm">
		<div>
			<dt class="font-semibold">Existing digital model</dt>
			<dd>{record.proposalHasExistingModel ? 'Yes' : 'No'}</dd>
		</div>
		{#if record.proposalHasExistingModel}
			<div>
				<dt class="font-semibold">Model sources</dt>
				<dd>{labels(record.proposalModelSources, MODEL_SOURCES)}</dd>
			</div>
			<div>
				<dt class="font-semibold">Rights and permissions</dt>
				<dd class="whitespace-pre-wrap">{record.proposalCopyrightOwnership}</dd>
			</div>
		{:else}
			<div>
				<dt class="font-semibold">Digitisation situation</dt>
				<dd class="whitespace-pre-wrap">{record.proposalDigitisationSituation}</dd>
			</div>
		{/if}
		{#if Array.isArray(record.proposalSupportingLinks) && record.proposalSupportingLinks.length}
			<div>
				<dt class="font-semibold">{OBJECT_LINKS_LABEL}</dt>
				<dd>
					<ul>
						{#each record.proposalSupportingLinks as link, index (index)}<li class="break-all">
								{#if isProposalLink(link)}
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- Validated absolute external HTTP(S) URL. -->
									<a class="link" href={link} target="_blank" rel="noreferrer">{link}</a
									>{:else}{link}{/if}
							</li>{/each}
					</ul>
				</dd>
			</div>
		{/if}
		</dl>
	{#if record.proposalModelFiles?.length}<ProposalModelUploads edition={record} readOnly />{/if}
	{#if Array.isArray(record.proposalSupportingFiles) && record.proposalSupportingFiles.length}
		<div>
			<h3 class="font-semibold">Supporting files</h3>
			<ul>
				{#each record.proposalSupportingFiles as filename (filename)}<li>
						<button
							type="button"
							class="link text-left text-sm break-all"
							onclick={() => download(filename)}>{filename}</button
						>
					</li>{/each}
			</ul>
		</div>
	{/if}
	</details>
</section>

<style>
	.compact-summary {
		overflow: hidden;
		border: 1px solid var(--color-base-300);
		border-radius: 0.5rem;
	}
	.compact-summary > div {
		display: grid;
		grid-template-columns: minmax(6rem, 28%) minmax(0, 1fr);
		gap: 0;
	}
	.compact-summary > div + div {
		border-top: 1px solid var(--color-base-300);
	}
	.compact-summary dt,
	.compact-summary dd {
		padding: 0.625rem 0.75rem;
	}
	.compact-summary dt {
		background: color-mix(in srgb, var(--color-base-200) 50%, transparent);
		border-right: 1px solid var(--color-base-300);
		font-weight: 500;
	}
	.compact-summary dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	@media (max-width: 639px) {
		.compact-summary > div {
			grid-template-columns: minmax(0, 1fr);
		}
		.compact-summary dt {
			border-right: 0;
			border-bottom: 1px solid var(--color-base-300);
		}
	}
</style>
