<script lang="ts">
	import type { RecordModel } from 'pocketbase';
	import { pb } from '$lib/database/client';
	import ProposalModelUploads from '$lib/components/uploads/ProposalModelUploads.svelte';
	import ProposalQuestionnaire from '$lib/components/workflow/ProposalQuestionnaire.svelte';
	import {
		formatOpenCallDeadline,
		MODEL_SOURCES,
		MODEL_RIGHTS_QUESTION,
		OBJECT_LINKS_LABEL,
		isProposalLink
	} from '$lib/workflow/proposal';
	import toast from 'svelte-french-toast';

	let { record }: { record: RecordModel } = $props();
	let openCall = $derived.by(() => {
		const value = record.proposalSnapshot?.openCall;
		return value && typeof value.id === 'string' && typeof value.title === 'string' ? value : null;
	});

	function optionLabels(values: unknown, options: ReadonlyArray<readonly [string, string]>) {
		return Array.isArray(values)
			? values.map((value) => options.find(([id]) => id === value)?.[1] || value)
			: [];
	}

	function supportingLinks(value: unknown): string[] {
		if (Array.isArray(value)) return value.filter((link): link is string => typeof link === 'string');
		if (typeof value === 'string')
			return value
				.split('\n')
				.map((link) => link.trim())
				.filter(Boolean);
		return [];
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

<div id="read-only-proposal" class="space-y-5">
	<section class="space-y-4 overflow-hidden rounded-box border border-base-300 bg-base-100 p-5">
		<div class="-mx-5 -mt-5 border-b border-base-300 bg-base-200 px-5 py-3">
			<h2 class="text-base font-semibold">Submitted proposal</h2>
		</div>
		<div>
			<h3 class="text-sm font-semibold">Title</h3>
			<p class="mt-1 rounded-lg bg-base-200/50 p-3 text-sm">
				{record.title || 'Untitled edition'}
			</p>
		</div>
		<div>
			<h3 class="text-sm font-semibold">Proposal Type</h3>
			<p class="mt-1 rounded-lg bg-base-200/50 p-3 text-sm">
				{#if openCall}
					{openCall.title}{openCall.deadline
						? ` · deadline ${formatOpenCallDeadline(openCall.deadline)}`
						: ''}
				{:else}General submission{/if}
			</p>
		</div>
		<div>
			<h3 class="font-semibold">Authors</h3>
			<div class="mt-3 space-y-2">
				{#each record.proposalAuthorAffiliations || [] as author, index (index)}
					<div class="rounded-lg bg-base-200/50 p-3 text-sm">
						<p class="font-semibold">{author.name || `Author ${index + 1}`}</p>
						<p class="text-base-content/70">{author.affiliation || 'No affiliation provided'}</p>
					</div>
				{:else}
					<p class="rounded-lg bg-base-200/50 p-3 text-sm">Not provided</p>
				{/each}
			</div>
		</div>
	</section>

	<ProposalQuestionnaire
		purpose={record.proposalPurpose || ''}
		modelReferences={record.proposalModelReferences || ''}
		argument={record.proposalArgument || ''}
		rationale={record.proposalThreeDRationale || ''}
		context={record.proposalContextualMaterial || ''}
		audience={Array.isArray(record.proposalAudience) ? record.proposalAudience : []}
		readOnly
	/>

	<section class="space-y-5 overflow-hidden rounded-box border border-base-300 bg-base-100 p-5">
		<div class="-mx-5 -mt-5 border-b border-base-300 bg-base-200 px-5 py-3">
			<h2 class="text-base font-semibold">3D model(s)</h2>
		</div>
		<div>
			<h3 class="text-sm font-semibold">Do you already have a digital 3D model to use for this edition?</h3>
			<p class="mt-2 rounded-lg bg-base-200/50 p-3 text-sm">
				{record.proposalHasExistingModel ? 'Yes' : 'No'}
			</p>
		</div>
		{#if record.proposalHasExistingModel}
			<div>
				<h3 class="text-sm font-semibold">Model source · Select all that apply</h3>
				<div class="mt-2 flex min-h-12 flex-wrap items-center gap-2 rounded-lg bg-base-200/50 p-3">
					{#each optionLabels(record.proposalModelSources, MODEL_SOURCES) as label (label)}
						<span class="badge badge-outline">{label}</span>
					{:else}<span class="text-sm">Not provided</span>{/each}
				</div>
			</div>
			{#if record.proposalModels?.length || record.proposalModelFiles?.length}
				<div class="space-y-2">
					<h3 class="text-sm font-semibold">Model files</h3>
					<ProposalModelUploads edition={record} readOnly />
				</div>
			{/if}
			<div>
				<h3 class="text-sm font-semibold">
					{MODEL_RIGHTS_QUESTION}
				</h3>
				<p class="mt-2 min-h-12 rounded-lg bg-base-200/50 p-3 text-sm whitespace-pre-wrap">
					{record.proposalCopyrightOwnership || 'Not provided'}
				</p>
			</div>
		{:else}
			<div>
				<h3 class="text-sm font-semibold">Describe the digitisation situation</h3>
				<p class="mt-2 min-h-12 rounded-lg bg-base-200/50 p-3 text-sm whitespace-pre-wrap">
					{record.proposalDigitisationSituation || 'Not provided'}
				</p>
			</div>
			<div>
				<h3 class="text-sm font-semibold">{OBJECT_LINKS_LABEL}</h3>
				<ul class="mt-2 space-y-1 rounded-lg bg-base-200/50 p-3 text-sm">
					{#each supportingLinks(record.proposalSupportingLinks) as link, index (index)}
						<li class="break-all">
							{#if isProposalLink(link)}
								<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- Validated absolute external HTTP(S) URL. -->
								<a class="link link-primary" href={link} target="_blank" rel="noreferrer">{link}</a>
							{:else}{link}{/if}
						</li>
					{:else}<li>Not provided</li>{/each}
				</ul>
			</div>
			{#if Array.isArray(record.proposalSupportingFiles) && record.proposalSupportingFiles.length}
				<div>
					<h3 class="text-sm font-semibold">Supporting files</h3>
					<ul class="mt-2 space-y-1 rounded-lg bg-base-200/50 p-3">
						{#each record.proposalSupportingFiles as filename (filename)}
							<li>
								<button
									type="button"
									class="link link-primary text-left text-sm break-all"
									onclick={() => download(filename)}>{filename}</button
								>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		{/if}
	</section>
</div>
