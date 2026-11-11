<script lang="ts">
	import { prepareVoyagerArticle } from './edition-reader';
	import { normalizeVoyagerArticles, resolveVoyagerAssetUrl } from './edition-content';

	interface Props {
		articles: unknown[];
		editionId: string;
		language: string;
		root: string;
		assets?: Record<string, string>;
		activeArticleId: string | null;
		linkedArticleId: string | null;
		onArticle: (id: string | null) => void;
	}

	let {
		articles,
		editionId,
		language,
		root,
		assets = {},
		activeArticleId,
		linkedArticleId,
		onArticle
	}: Props = $props();
	let content = $state('');
	let loading = $state(false);
	let error = $state('');
	let reload = $state(0);
	const storyItems = $derived(normalizeVoyagerArticles(articles, language));
	const selected = $derived(storyItems.find((item) => item.id === activeArticleId) ?? null);
	const selectedIndex = $derived(storyItems.findIndex((item) => item.id === activeArticleId));

	$effect(() => {
		void reload;
		void editionId;
		const article = selected;
		const url = article && resolveVoyagerAssetUrl(root, article.uri, window.location.href);
		content = '';
		error = '';
		if (!article || !url) {
			loading = false;
			if (article && !url) error = 'This story has no usable article URL.';
			return;
		}
		const controller = new AbortController();
		loading = true;
		fetch(url, { signal: controller.signal })
			.then((response) => {
				if (!response.ok) throw new Error(`Story request failed (${response.status})`);
				return response.text();
			})
			.then((html) => {
				if (!controller.signal.aborted)
					content = prepareVoyagerArticle(html, url, article.title, assets);
			})
			.catch((reason: unknown) => {
				if (
					!controller.signal.aborted &&
					!(reason instanceof DOMException && reason.name === 'AbortError')
				) {
					error = reason instanceof Error ? reason.message : 'Story request failed.';
				}
			})
			.finally(() => {
				if (!controller.signal.aborted) loading = false;
			});
		return () => controller.abort();
	});

	function select(id: string) {
		onArticle(id);
	}

	function allStories() {
		onArticle(null);
	}
</script>

<section id="edition-stories" aria-label="Edition stories">
	{#if !selected}
		<div class="story-list">
			{#each storyItems as story (story.id)}
				<button type="button" onclick={() => select(story.id)}>
					<strong>{story.title}</strong>
				</button>
			{/each}
		</div>
	{:else}
		<div class="story-header">
			<button type="button" onclick={allStories}>← All stories</button>
			<span>{selectedIndex + 1} of {storyItems.length}</span>
		</div>
		{#if linkedArticleId === selected.id}<p class="linked">Linked to this tour step</p>{/if}
		<h2>{selected.title}</h2>
		{#if loading}<p class="status">Loading story…</p>{/if}
		{#if error}
			<p class="status">{error}</p>
			<button type="button" class="retry" onclick={() => (reload += 1)}>Retry</button>
		{:else if content}
			<div class="story-content">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- prepared with DOMPurify before relative asset URLs are resolved -->
				{@html content}
			</div>
		{/if}
		{#if selectedIndex >= 0 && selectedIndex < storyItems.length - 1}
			<button type="button" class="next" onclick={() => select(storyItems[selectedIndex + 1].id)}>
				Next story <span>{storyItems[selectedIndex + 1].title} →</span>
			</button>
		{/if}
	{/if}
</section>

<style>
	#edition-stories {
		min-height: 8rem;
		overflow-wrap: anywhere;
	}
	button {
		cursor: pointer;
	}
	.story-list {
		display: grid;
	}
	.story-list button {
		min-height: 3.25rem;
		border-bottom: 1px solid var(--color-base-300);
		padding: 0.75rem 0;
		text-align: left;
		font-size: 0.8125rem;
	}
	.story-list button:first-child {
		padding-top: 0;
	}
	.story-list button:hover {
		color: var(--color-primary);
	}
	.story-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.25rem;
		color: color-mix(in oklch, var(--color-base-content) 65%, transparent);
		font-size: 0.75rem;
	}
	.story-header button {
		min-height: 36px;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.linked {
		margin: 0 0 0.5rem;
		color: #52614c;
		font-size: 0.625rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	#edition-stories h2 {
		margin: 0 0 1rem;
		font-size: 1.5rem;
		line-height: 1.15;
	}
	.status {
		color: color-mix(in oklch, var(--color-base-content) 65%, transparent);
		font-size: 0.8125rem;
	}
	.retry {
		margin-top: 0.5rem;
		font-size: 0.75rem;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.story-content :global(p),
	.story-content :global(li),
	.story-content :global(td),
	.story-content :global(th) {
		font-size: 0.875rem;
		line-height: 1.7;
	}
	.story-content :global(img) {
		height: auto;
		max-width: 100%;
	}
	.story-content :global(table) {
		display: block;
		max-width: 100%;
		overflow-x: auto;
	}
	.story-content :global(a) {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.story-content :global(pre) {
		max-width: 100%;
		overflow-x: auto;
	}
	.next {
		display: flex;
		width: 100%;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 1.5rem;
		border-top: 1px solid var(--color-base-300);
		padding-top: 1rem;
		font-size: 0.75rem;
		text-align: left;
	}
	.next span {
		color: var(--color-base-content);
	}
	button:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 3px;
	}
</style>
