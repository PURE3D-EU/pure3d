<script lang="ts">
	import { tick } from 'svelte';
	import { resolve } from '$app/paths';
	import type { RecordModel } from 'pocketbase';
	import { pb } from '$lib/database/client';
	import { cleanContent } from '$lib/utils/content-html';
	import ContentRenderer from './ContentRenderer.svelte';

	let { calls }: { calls: RecordModel[] } = $props();
	let selected = $state<RecordModel | null>(null);
	let dialog: HTMLDialogElement;
	const instanceId = $props.id();
	const titleId = `${instanceId}-title`;
	const date = (value: string) =>
		new Intl.DateTimeFormat('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			timeZone: 'UTC'
		}).format(new Date(value));

	function excerpt(call: RecordModel) {
		const description = call.shortDescription?.trim();
		if (description) return description;
		const document = new DOMParser().parseFromString(cleanContent(call.body || ''), 'text/html');
		const paragraph =
			Array.from(document.querySelectorAll('p'))
				.find((node) => (node.textContent?.trim().length || 0) > 100)
				?.textContent?.replace(/\s+/g, ' ')
				.trim() || '';
		return paragraph.length > 175 ? `${paragraph.slice(0, 175).replace(/\s+\S*$/, '')}…` : paragraph;
	}

	async function openCall(call: RecordModel) {
		selected = call;
		await tick();
		dialog.showModal();
	}
</script>

<div id="open-call-cards">
	<div class="calls-grid not-prose">
		{#each calls as call (call.id)}
			{@const description = excerpt(call)}
			<article class="call-card">
				{#if call.cover}
					<img
						class="call-cover"
						src={pb.files.getURL(call, call.cover)}
						alt=""
						loading="lazy"
						width="800"
						height="800"
					/>
				{/if}
				<div class="card-top">
					<span>Thematic call</span>
				</div>
				<h3>{call.title}</h3>
				{#if description}<p class="excerpt">{description}</p>{/if}
				<div class="card-footer">
					<div class="deadline">
						<span>{call.deadline ? 'Proposal deadline' : 'Applications'}</span><strong
							>{call.deadline ? date(call.deadline) : 'Open'}</strong
						>
					</div>
					<button
						type="button"
						onclick={() => openCall(call)}
						aria-label={`Read call: ${call.title}`}
						aria-haspopup="dialog"
						>Read call <span class="arrow" aria-hidden="true">↗</span></button
					>
				</div>
			</article>
		{/each}
	</div>
	<dialog bind:this={dialog} aria-labelledby={titleId} onclose={() => (selected = null)}>
		{#if selected}
			<div class="dialog-toolbar not-prose">
				<span class="eyebrow">Thematic call</span><button
					type="button"
					class="close-button"
					aria-label="Close open call"
					onclick={() => dialog.close()}>✕</button
				>
			</div>
			<div class="dialog-body">
				{#if selected.cover}
					<img class="dialog-cover not-prose" src={pb.files.getURL(selected, selected.cover)} alt="" />
				{/if}
				<h2 id={titleId} class="not-prose">{selected.title}</h2>
				{#if selected.deadline}<p class="dialog-deadline not-prose">
						Proposal deadline · {date(selected.deadline)}
					</p>{/if}
				{#key selected.id}<ContentRenderer
						content={selected.body || ''}
						renderOpenCalls={false}
					/>{/key}
				<a class="not-prose btn mt-8 btn-primary" href={resolve('/documentation/submission')}
					>Read submission guidelines <span aria-hidden="true">→</span></a
				>
			</div>
		{/if}
	</dialog>
</div>

<style>
	#open-call-cards {
		--rule: color-mix(in srgb, var(--color-base-content) 12%, transparent);
		font-family: var(--font-sans);
		line-height: 1.5;
	}
	.eyebrow {
		display: flex;
		align-items: center;
		gap: 9px;
		font: 500 11px/1.4 var(--font-sans);
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.calls-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, max(18rem, (100% - 20px) / 2)), 1fr));
		gap: 20px;
	}
	.call-card {
		display: flex;
		flex-direction: column;
		position: relative;
		padding: clamp(24px, 3vw, 36px);
		border-radius: 4px;
		background: var(--color-base-100);
		border-top: 2px solid var(--color-forest);
	}
	.card-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		margin-bottom: 28px;
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-ink-3);
	}
	#open-call-cards .call-cover {
		width: calc(100% + 2 * clamp(24px, 3vw, 36px));
		max-width: none;
		aspect-ratio: 1;
		object-fit: contain;
		margin: calc(-1 * clamp(24px, 3vw, 36px)) calc(-1 * clamp(24px, 3vw, 36px)) 28px;
		border-radius: 4px 4px 0 0;
	}
	.dialog-cover {
		width: 100%;
		height: auto;
		max-height: 60dvh;
		object-fit: contain;
		margin-bottom: 28px;
		border-radius: var(--radius-control);
	}
	h3 {
		max-width: 30ch;
		margin: 0 0 18px;
		font-size: clamp(21px, 2vw, 27px);
		font-weight: 500;
		line-height: 1.22;
		letter-spacing: -0.03em;
		text-wrap: balance;
	}
	.excerpt {
		max-width: 54ch;
		overflow-wrap: anywhere;
		margin: 0 0 30px;
		color: var(--color-ink-3);
		font-size: 14px;
		line-height: 1.65;
	}
	.card-footer {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		justify-content: space-between;
		gap: 20px;
		margin-top: auto;
		padding-top: 22px;
		border-top: 1px solid var(--rule);
	}
	.deadline {
		display: grid;
		gap: 5px;
	}
	.deadline > span {
		font-size: 10px;
		letter-spacing: 0.06em;
		color: var(--color-ink-3);
		text-transform: uppercase;
	}
	.deadline strong {
		font: 500 19px/1.2 var(--font-sans);
		letter-spacing: -0.03em;
	}
	.card-footer button {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 44px;
		cursor: pointer;
		font-size: 13px;
		font-weight: 500;
		white-space: nowrap;
	}
	.card-footer button::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
	}
	.card-footer button:focus-visible {
		outline: none;
	}
	.call-card:has(button:focus-visible) {
		outline: 2px solid var(--color-base-content);
		outline-offset: 4px;
	}
	.arrow {
		display: grid;
		place-items: center;
		width: 38px;
		height: 38px;
		border-radius: 50%;
		background: var(--color-base-200);
		font-size: 21px;
		transition:
			background 0.18s,
			color 0.18s;
	}
	.call-card:hover .arrow {
		background: var(--color-forest);
		color: white;
	}
	dialog {
		width: min(880px, calc(100% - 32px));
		max-height: calc(100dvh - 48px);
		margin: auto;
		padding: 0;
		border: 0;
		border-radius: 12px;
		background: var(--color-base-100);
		color: var(--color-base-content);
		box-shadow: 0 24px 90px #0004;
	}
	dialog::backdrop {
		background: #12121199;
		backdrop-filter: blur(5px);
	}
	.dialog-toolbar {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 24px;
		padding: 12px 24px;
		background: var(--color-base-100);
		border-bottom: 1px solid var(--rule);
	}
	.close-button {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		cursor: pointer;
		border-radius: 50%;
		background: var(--color-base-200);
	}
	.dialog-body {
		padding: clamp(24px, 4vw, 48px);
	}
	.dialog-body h2 {
		margin: 0;
		font-family: var(--font-sans);
		font-size: clamp(28px, 4vw, 40px);
		font-weight: 500;
		line-height: 1.15;
		letter-spacing: -0.035em;
	}
	.dialog-deadline {
		margin: 20px 0 32px;
		color: var(--color-vermillion-ink);
		font-size: 14px;
		font-weight: 500;
	}
	@media (max-width: 640px) {
		.card-top {
			margin-bottom: 22px;
		}
		h3 {
			max-width: none;
		}
		.card-footer {
			gap: 12px;
		}
		.deadline strong {
			font-size: 17px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.arrow {
			transition: none;
		}
	}
</style>
