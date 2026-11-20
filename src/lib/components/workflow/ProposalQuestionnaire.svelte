<script lang="ts">
	import { PROPOSAL_AUDIENCES, QUESTIONNAIRE_WORD_LIMIT, wordCount } from '$lib/workflow/proposal';
	let {
		purpose = $bindable(''),
		modelReferences = $bindable(''),
		argument = $bindable(''),
		rationale = $bindable(''),
		context = $bindable(''),
		audience = $bindable<string[]>([]),
		readOnly = false
	} = $props();
	const questions = $derived([
		{
			id: 'proposal-purpose',
			label: 'Tell us for what purpose your 3D model was created.',
			hint: '',
			value: purpose,
			change: (value: string) => (purpose = value)
		},
		{
			id: 'proposal-model-references',
			label: 'Model links and published materials (optional)',
			hint: 'If your model is publicly available, please provide a link. If there are published materials, such as popular or academic articles, blog posts, videos, etc., about the models and its creation, please include links and brief descriptions below.',
			value: modelReferences,
			change: (value: string) => (modelReferences = value),
			optional: true
		},
		{
			id: 'proposal-argument',
			label: 'What is the narrative or story about the 3D model you would like to tell?',
			hint: '',
			value: argument,
			change: (value: string) => (argument = value)
		},
		{
			id: 'proposal-3d-rationale',
			label:
				'Why is 3D visualisation an appropriate means of presenting your argument or narrative?',
			hint: '',
			value: rationale,
			change: (value: string) => (rationale = value)
		},
		{
			id: 'proposal-context',
			label: 'What material do you intend to use to contextualise your 3D model(s)?',
			hint: 'Please provide any information you currently have, including previously written material, bibliographic references, archival sources, images, videos, audio recordings, etc. This is material that will both inform your narrative and multimedia that will enrich the experience and narrative flow of your 3D edition. Links are not necessary at this time.',
			value: context,
			change: (value: string) => (context = value)
		}
	]);
</script>

<section
	id="proposal-questionnaire"
	class="space-y-4 overflow-hidden rounded-box border border-base-300 bg-base-100 p-5"
>
	<div class="-mx-5 -mt-5 border-b border-base-300 bg-base-200 px-5 py-3">
		<h2 class="text-base font-semibold">Submission Questionnaire</h2>
	</div>
	{#each questions as field (field.id)}
		<div class="form-control">
			{#if readOnly}
				<h3 class="label-text font-semibold">{field.label}</h3>
			{:else}
				<label class="label-text font-semibold" for={field.id}>{field.label}</label>
			{/if}
			{#if field.hint}<span id={`${field.id}-hint`} class="mt-1 text-sm text-base-content/75"
					>{field.hint}</span
				>{/if}
			{#if readOnly}
				<p class="mt-2 min-h-12 rounded-lg bg-base-200/50 p-3 text-sm whitespace-pre-wrap">
					{field.value || 'Not provided'}
				</p>
			{:else}
				<textarea
					id={field.id}
					class="textarea-bordered textarea mt-2 min-h-20 w-full"
					rows="3"
					value={field.value}
					aria-invalid={wordCount(field.value) > QUESTIONNAIRE_WORD_LIMIT}
					aria-describedby={field.hint
						? `${field.id}-hint ${field.id}-count`
						: `${field.id}-count`}
					oninput={(event) => {
						field.change(event.currentTarget.value);
						event.currentTarget.style.height = 'auto';
						event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`;
					}}
					required={!field.optional}
				></textarea>
				<span id={`${field.id}-count`} class="mt-1 text-right text-xs text-base-content/75"
					>{wordCount(field.value)}/{QUESTIONNAIRE_WORD_LIMIT} words</span
				>
			{/if}
		</div>
	{/each}
	{#if readOnly}
		<div>
			<h3 class="font-semibold">Intended audience</h3>
			<div class="mt-2 flex min-h-12 flex-wrap items-center gap-2 rounded-lg bg-base-200/50 p-3">
				{#each PROPOSAL_AUDIENCES.filter(([value]) => audience.includes(value)) as [value, label] (value)}
					<span class="badge badge-outline">{label}</span>
				{:else}
					<span class="text-sm">Not provided</span>
				{/each}
			</div>
		</div>
	{:else}
		<fieldset class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			<legend class="font-semibold">Intended audience</legend>
			{#each PROPOSAL_AUDIENCES as [value, label] (value)}
				<label class="flex items-center gap-2 text-sm"
					><input
						type="checkbox"
						class="checkbox checkbox-sm"
						bind:group={audience}
						{value}
					/>{label}</label
				>
			{/each}
		</fieldset>
	{/if}
</section>
