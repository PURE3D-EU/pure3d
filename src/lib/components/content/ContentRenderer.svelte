<script lang="ts">
	import { mount, unmount } from 'svelte';
	import ContentEditionGrid from './ContentEditionGrid.svelte';
	import ContentOpenCalls from './ContentOpenCalls.svelte';
	import { cleanContent } from '$lib/utils/content-html';
	import { parseEditionIds, parseOpenCallIds } from '$lib/utils/content-components';

	interface Props {
		content?: string;
		className?: string;
		imported?: boolean;
		team?: boolean;
		renderOpenCalls?: boolean;
	}

	let {
		content = '',
		className = 'prose max-w-none',
		imported = false,
		team = false,
		renderOpenCalls = true
	}: Props = $props();
	let element = $state<HTMLElement>();
	let prepared = $derived.by(() => {
		const safeHtml = cleanContent(content);
		if (!imported || typeof window === 'undefined') return { html: safeHtml, sections: [] };
		const document = new DOMParser().parseFromString(`<main>${safeHtml}</main>`, 'text/html');
		const root = document.querySelector('main')!;
		const sections = Array.from(root.querySelectorAll('h2')).map((heading, index) => {
			const id = `section-${index + 1}`;
			heading.id = id;
			return { id, title: heading.textContent?.trim() || `Section ${index + 1}` };
		});
		// WordPress used a bullet character in separate paragraphs instead of list markup.
		let lastGeneratedList: Element | null = null;
		for (const paragraph of Array.from(root.querySelectorAll('p'))) {
			if (!paragraph.textContent?.trimStart().startsWith('•')) continue;
			let list = paragraph.previousElementSibling;
			if (!list || list !== lastGeneratedList) {
				list = document.createElement('ul');
				paragraph.before(list);
			}
			lastGeneratedList = list;
			const first = paragraph.firstChild;
			if (first?.nodeType === Node.TEXT_NODE)
				first.textContent = first.textContent?.replace(/^\s*•\s*/, '') || '';
			const item = document.createElement('li');
			item.append(...Array.from(paragraph.childNodes));
			list.append(item);
			paragraph.remove();
		}
		const menu = root.firstElementChild;
		if (menu?.tagName === 'H4' && menu.textContent?.trim() === 'Menu') {
			const links = menu.nextElementSibling;
			if (links?.tagName === 'UL') {
				const details = document.createElement('details');
				const summary = document.createElement('summary');
				summary.textContent = 'Explore related pages';
				details.append(summary, links);
				menu.replaceWith(details);
			}
		}
		if (team) {
			for (const link of Array.from(root.querySelectorAll('a:has(> img)'))) {
				if (link.querySelector('img')?.getAttribute('alt')) continue;
				try {
					link.setAttribute(
						'aria-label',
						`Visit ${new URL(link.getAttribute('href') || '').hostname.replace(/^www\./, '')}`
					);
				} catch {
					// The sanitizer has already rejected unsafe destinations.
				}
			}
			for (const heading of Array.from(root.querySelectorAll('h2'))) {
				if (!/^(Meet Our Team|Past Members)$/i.test(heading.textContent?.trim() || '')) continue;
				const grid = document.createElement('div');
				grid.className = 'import-team-grid';
				heading.after(grid);
				let card: HTMLElement | null = null;
				let current = grid.nextElementSibling;
				while (current && current.tagName !== 'H2') {
					const next = current.nextElementSibling;
					if (current.tagName === 'IMG') {
						card = document.createElement('div');
						card.className = 'import-team-card';
						grid.append(card);
					}
					if (card) card.append(current);
					current = next;
				}
			}
		}
		return { html: root.innerHTML, sections };
	});
	let html = $derived(prepared.html);

	$effect(() => {
		void html;
		if (!element) return;
		const editionComponents = Array.from(
			element.querySelectorAll<HTMLElement>('[data-cms-editions]')
		).flatMap((target) => {
			const ids = parseEditionIds(target.dataset.cmsEditions || '');
			return ids.length ? [mount(ContentEditionGrid, { target, props: { ids } })] : [];
		});
		const openCallComponents = renderOpenCalls
			? Array.from(
					element.querySelectorAll<HTMLElement>('[data-cms-open-calls="true"][data-open-call-ids]')
				).flatMap((target) => {
					const ids = parseOpenCallIds(target.dataset.openCallIds || '');
					return ids.length ? [mount(ContentOpenCalls, { target, props: { ids } })] : [];
				})
			: [];
		const mounted = [...editionComponents, ...openCallComponents];
		return () => mounted.forEach((component) => void unmount(component));
	});
</script>

<article id="content-renderer" bind:this={element} class={className} class:imported>
	{#if prepared.sections.length >= 4}<nav
			aria-label="On this page"
			class="not-prose mb-12 rounded-lg border border-base-300 bg-base-200/60 p-5 md:p-7"
		>
			<p class="mb-4 text-xs font-semibold tracking-[.15em] text-primary uppercase">On this page</p>
			<ul class="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
				{#each prepared.sections as section (section.id)}<li>
						<a
							class="underline decoration-base-300 underline-offset-4 hover:decoration-primary"
							href={`#${section.id}`}>{section.title}</a
						>
					</li>{/each}
			</ul>
		</nav>{/if}
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- cleanContent uses a strict allowlist before rendering. -->
	{@html html}
</article>

<style>
	#content-renderer :global([data-cms-callout]) {
		margin: 1.5rem 0;
		padding: 1rem 1.25rem;
		border-left: 0.25rem solid var(--color-info);
		border-radius: var(--radius-box);
		background: color-mix(in oklch, var(--color-info) 10%, transparent);
	}
	#content-renderer :global([data-cms-callout='success']) {
		border-color: var(--color-success);
		background: color-mix(in oklch, var(--color-success) 10%, transparent);
	}
	#content-renderer :global([data-cms-callout='warning']) {
		border-color: var(--color-warning);
		background: color-mix(in oklch, var(--color-warning) 12%, transparent);
	}
	#content-renderer :global([data-cms-actions='true']) {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin: 1.5rem 0;
	}
	#content-renderer :global([data-cms-action]) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.75rem;
		padding: 0.5rem 1rem;
		border: 1px solid var(--color-base-content);
		border-radius: var(--radius-field);
		font-weight: 600;
		text-decoration: none;
	}
	#content-renderer :global([data-cms-action='primary']) {
		background: var(--color-base-content);
		color: var(--color-base-100);
	}
	#content-renderer :global([data-cms-expandable]) {
		margin: 1.5rem 0;
		padding: 1rem;
		border: 1px solid var(--color-base-300);
		border-radius: var(--radius-box);
	}
	#content-renderer :global([data-cms-expandable] > summary) {
		cursor: pointer;
		font-weight: 600;
	}
	#content-renderer :global([data-cms-columns]) {
		display: grid;
		grid-template-columns: repeat(var(--cms-columns, 2), minmax(0, 1fr));
		gap: clamp(1rem, 3vw, 2rem);
		margin: 1.5rem 0;
	}
	#content-renderer :global([data-cms-columns='2']) {
		--cms-columns: 2;
	}
	#content-renderer :global([data-cms-columns='3']) {
		--cms-columns: 3;
	}
	#content-renderer :global([data-cms-columns='4']) {
		--cms-columns: 4;
	}
	#content-renderer :global([data-cms-column]) {
		min-width: 0;
	}
	#content-renderer :global([data-cms-profiles]) {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
		gap: 1.25rem;
		margin: 1.5rem 0;
	}
	#content-renderer :global([data-cms-profile]) {
		display: grid;
		gap: 1rem;
		padding: 1.25rem;
		border: 1px solid var(--color-base-300);
		border-radius: var(--radius-surface);
		background: var(--color-base-100);
	}
	#content-renderer :global([data-cms-profile] > img) {
		width: 5rem;
		height: 5rem;
		margin: 0;
		border-radius: 50%;
		object-fit: cover;
	}
	#content-renderer :global([data-cms-profile] h3),
	#content-renderer :global([data-cms-profile] p) {
		margin: 0.25rem 0;
	}
	#content-renderer :global([data-cms-profile-links]) {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	#content-renderer :global([data-cms-profile-link]) {
		font-size: 0.875rem;
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	#content-renderer :global([data-cms-logo-grid]) {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr));
		gap: 1rem;
		margin: 1.5rem 0;
	}
	#content-renderer :global([data-cms-logo]) {
		display: grid;
		min-height: 7rem;
		place-items: center;
		gap: 0.75rem;
		margin: 0;
		padding: 1rem;
		border: 1px solid var(--color-base-300);
		border-radius: var(--radius-box);
	}
	#content-renderer :global([data-cms-logo] img) {
		width: auto;
		max-width: 100%;
		height: 3rem;
		margin: 0;
		object-fit: contain;
	}
	#content-renderer :global([data-cms-logo] figcaption),
	#content-renderer :global([data-cms-logo] > p) {
		font-size: 0.875rem;
		text-align: center;
	}
	#content-renderer :global([data-cms-project-facts]) {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
		gap: 1rem;
		margin: 1.5rem 0;
	}
	#content-renderer :global([data-cms-project-fact]) {
		padding: 1rem;
		border-left: 0.2rem solid var(--color-primary);
		background: var(--color-base-200);
	}
	#content-renderer :global([data-cms-project-fact] dt) {
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	#content-renderer :global([data-cms-project-fact] dd) {
		margin: 0.35rem 0 0;
	}
	#content-renderer :global(figure[data-content-image]) {
		margin: 1.5rem 0;
	}
	#content-renderer :global(figure[data-content-image] figcaption) {
		margin-top: 0.75rem;
		font-size: 0.875rem;
		line-height: 1.5;
		color: color-mix(in oklch, var(--color-base-content) 72%, transparent);
	}
	#content-renderer :global(img) {
		max-width: 100%;
		height: auto;
		border-radius: var(--radius-control);
	}
	#content-renderer :global(iframe) {
		width: 100%;
		aspect-ratio: 16/9;
		border: 0;
	}
	#content-renderer :global(table) {
		display: block;
		overflow-x: auto;
	}
	#content-renderer :global(a) {
		overflow-wrap: anywhere;
	}
	#content-renderer.imported {
		--tw-prose-body: var(--color-ink-2);
		--tw-prose-headings: var(--color-ink);
		--tw-prose-links: var(--color-forest);
		line-height: 1.75;
	}
	#content-renderer.imported > :global(h2) {
		margin-top: 3.5rem;
		padding-top: 1.25rem;
		border-top: 1px solid var(--color-base-300);
		font-family: var(--font-serif);
		font-size: clamp(1.75rem, 3vw, 2.5rem);
		font-weight: 400;
		line-height: 1.2;
	}
	#content-renderer.imported :global(h3) {
		font-family: var(--font-serif);
		font-weight: 500;
	}
	#content-renderer.imported :global(img) {
		display: block;
		max-height: 34rem;
		margin-inline: auto;
		object-fit: contain;
	}
	#content-renderer.imported :global([data-cms-profile] > img) {
		object-fit: cover;
	}
	#content-renderer.imported :global(img:has(+ img)),
	#content-renderer.imported :global(img + img) {
		display: inline-block;
		width: auto;
		max-width: min(100%, 12rem);
		max-height: 6rem;
		margin: 0.75rem 1.5rem 0.75rem 0;
		vertical-align: middle;
	}
	#content-renderer.imported :global(p:has(> a > img):not(:has(> :not(a, img, br)))) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1.5rem;
		padding: 1.5rem;
		border: 1px solid var(--color-base-300);
		border-radius: var(--radius-surface);
		background: var(--color-base-100);
	}
	#content-renderer.imported :global(p:has(> a > img):not(:has(> :not(a, img, br))) a) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		max-width: min(100%, 12rem);
		min-height: 5rem;
	}
	#content-renderer.imported :global(p:has(> a > img):not(:has(> :not(a, img, br))) img) {
		max-height: 6rem;
		width: auto;
		margin: 0;
	}
	#content-renderer.imported :global(blockquote) {
		border-color: var(--color-primary);
		font-family: var(--font-serif);
		font-weight: 400;
	}
	#content-renderer.imported :global(.import-team-grid) {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
		gap: 1.25rem;
		margin-top: 1.5rem;
	}
	#content-renderer.imported :global(.import-team-card) {
		padding: 1.5rem;
		border: 1px solid var(--color-base-300);
		border-radius: var(--radius-surface);
		background: var(--color-base-100);
	}
	#content-renderer.imported :global(.import-team-card > img) {
		width: 7rem;
		height: 7rem;
		margin: 0 0 1.25rem;
		border-radius: 50%;
		object-fit: cover;
	}
	#content-renderer.imported :global(.import-team-card p) {
		margin: 0.35rem 0;
	}
	#content-renderer.imported :global(.import-team-card a:has(img)) {
		display: inline-flex;
		margin: 1rem 0.6rem 0 0;
		vertical-align: middle;
	}
	#content-renderer.imported :global(.import-team-card a img) {
		width: auto;
		max-width: 5rem;
		height: 1.75rem;
		margin: 0;
		object-fit: contain;
	}
	@media (min-width: 641px) and (max-width: 1024px) {
		#content-renderer :global([data-cms-columns='3']),
		#content-renderer :global([data-cms-columns='4']) {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 640px) {
		#content-renderer :global([data-cms-columns]) {
			grid-template-columns: 1fr;
		}
		#content-renderer.imported > :global(h2) {
			margin-top: 2.5rem;
		}
		#content-renderer.imported :global(p:has(> a > img):not(:has(> :not(a, img, br)))) {
			gap: 1rem;
			padding: 1rem;
		}
	}
</style>
