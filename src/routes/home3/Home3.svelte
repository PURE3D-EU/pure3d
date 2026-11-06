<script lang="ts">
	import { onMount } from 'svelte';
	import { base, resolve } from '$app/paths';
	import CollectionCard from '$lib/components/cards/CollectionCard.svelte';
	import HomeOpenCalls from '$lib/components/content/HomeOpenCalls.svelte';
	import NewsletterSignup from '$lib/components/ui/NewsletterSignup.svelte';
	import { pb } from '$lib/database/client';
	import { homeStore, fetchHomeData, isStale } from '$lib/stores/data.store';
	import ParticleHero from './ParticleHero.svelte';
	import type { GlyphSource } from './particle-field';

	// /home4 renders this component with letters instead of dots; /home3 passes nothing.
	let { glyphs }: { glyphs?: GlyphSource } = $props();

	let homeLoading = $state(true);
	let newsLoading = $state(true);
	let news = $state<
		Array<{ id: string; title: string; slug: string; summary: string; publishedAt: string }>
	>([]);
	const collections = $derived($homeStore.collections.slice(0, 4));
	const hasCachedHome = $derived(
		$homeStore.editions.length > 0 || $homeStore.collections.length > 0
	);
	const statsPending = $derived(homeLoading && !hasCachedHome);

	async function loadHome() {
		try {
			if (!hasCachedHome || isStale($homeStore.lastFetched)) await fetchHomeData();
		} catch {
			// Cached figures stay visible when the catalogue cannot be refreshed.
		} finally {
			homeLoading = false;
		}
	}

	async function loadNews() {
		try {
			const result = await pb.collection('content').getList(1, 2, {
				filter: 'kind = "post" && isPublished = true',
				sort: '-publishedAt,-created',
				fields: 'id,title,slug,summary,publishedAt',
				$autoCancel: false
			});
			news = result.items.map((item) => ({
				id: item.id,
				title: String(item.title || ''),
				slug: String(item.slug || ''),
				summary: String(item.summary || ''),
				publishedAt: String(item.publishedAt || '')
			}));
		} catch {
			news = [];
		} finally {
			newsLoading = false;
		}
	}

	onMount(() => {
		void loadHome();
		void loadNews();
	});

	function reveal(node: HTMLElement, delay = 0) {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return {};
		node.style.setProperty('--reveal-delay', `${delay}ms`);
		node.classList.add('reveal-pending');
		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry.isIntersecting || entry.intersectionRatio < 0.18) return;
				node.classList.add('reveal-visible');
				observer.disconnect();
			},
			{ threshold: 0.18, rootMargin: '0px 0px -48px 0px' }
		);
		observer.observe(node);
		return { destroy: () => observer.disconnect() };
	}

	let storyIndex = $state(0);
	const storySteps = [
		{
			kicker: 'Conceptualise',
			title: 'Build the narrative.',
			description: 'A 3D scholarly edition begins with a model and a story to tell.',
			image: '/images/landing/akua-object.webp',
			alt: 'Close-up of the wooden Akua’ba child figure in the published 3D edition',
			caption: 'Begin with an object and a question.'
		},
		{
			kicker: 'Implement',
			title: 'Author using interface.',
			description:
				'Harnessing the affordances of interface, curate an interactive experience that details model sources, evidence and interpretation.',
			image: '/images/landing/akua-annotated.webp',
			alt: 'The real Akua’ba edition with an eyebrow annotation and its supporting interpretation open',
			caption: 'Connect the model to its interpretation.'
		},
		{
			kicker: 'Publish',
			title: 'Revise from feedback.',
			description:
				'The two stage review process collects input on the technical and conceptual implementation.',
			image: '/images/landing/akua-published.webp',
			alt: 'The published Akua’ba child figure edition with its 3D viewer, description and edition record',
			caption: 'Bring the research together in an edition.'
		}
	];
	const selectedStory = $derived(storySteps[storyIndex]);
	const workflow = ['Proposal', 'Proposal review', 'Alpha review', 'Final review', 'Publication'];
	const promiseCards = [
		{
			title: '3D Scholars',
			text: 'Researchers and professionals from different fields who are currently unable to publish their 3D models in a contextualised environment.'
		},
		{
			title: 'GLAM Institutions',
			text: 'Galleries, libraries, archives and museums who want to enrich their digital collections with guided storytelling and public engagement.'
		},
		{
			title: 'Educators',
			text: 'Secondary and higher education instructors who want to use 3D in their teaching practice.'
		}
	];
	const partnerLogos = [
		{
			name: 'Maastricht University',
			href: 'https://www.maastrichtuniversity.nl',
			image: '/images/logos/maastricht-university-logo-png-transparent.webp'
		},
		{
			name: 'Platform Digital Infrastructure',
			href: 'https://pdi-ssh.nl',
			image: '/images/logos/PDI_SSH_LOGO_B.webp'
		},
		{
			name: 'NWO',
			href: 'https://www.nwo.nl',
			image: '/images/landing/supporters/nwo-mark.png'
		},
		{
			name: 'Open Science NL',
			href: 'https://www.openscience.nl',
			image: '/images/landing/supporters/open-science-nl.png'
		},
		{
			name: 'Netherlands eScience Center',
			href: 'https://www.esciencecenter.nl',
			image: '/images/landing/supporters/netherlands-escience-center.svg'
		},
		{
			name: 'Lorentz Center',
			href: 'https://www.lorentzcenter.nl',
			image: '/images/landing/supporters/lorentz-center.jpg'
		},
		{
			name: 'SSHOC-NL',
			href: 'https://sshoc.nl/',
			image: '/images/sshoc-nl.png'
		}
	];
</script>

<svelte:head>
	<title>PURE3D | Explore 3D Scholarly Editions</title>
	<meta
		name="description"
		content="PURE3D is an infrastructure for publishing, preserving, and exploring interactive 3D Scholarly Editions."
	/>
</svelte:head>

<div id="home3">
	{#snippet heroCopy()}
		<h1 id="home3-title" class="rise" style="--i: 1">
			<span class="hero-copy-desktop"
				>An infrastructure for the publication and preservation of <em>3D scholarship.</em></span
			>
			<span class="hero-copy-mobile">Publish and preserve <em>3D scholarship.</em></span>
		</h1>
		<p class="lede rise" style="--i: 2">
			<span class="hero-copy-desktop">
				PURE3D is an infrastructure for publishing, preserving, and exploring interactive 3D
				Scholarly Editions. These editions bring together 3D models and the evidence,
				interpretation, and paradata that make them meaningful, creating annotated, reviewable, and
				citable records that remain accessible for the long term.
			</span>
			<span class="hero-copy-mobile"
				>Explore interactive 3D Scholarly Editions, bringing models, evidence, and interpretation
				together in lasting, citable records.</span
			>
		</p>
		<div class="actions rise" style="--i: 3">
			<a href={resolve('/editions')} class="button button-primary">
				Browse editions <span aria-hidden="true">→</span>
			</a>
			<a href={resolve('/documentation')} class="button button-on-ink"> Publish with us </a>
		</div>
	{/snippet}

	{#snippet catalogueStats()}
		<dl class="catalogue-stats" use:reveal={120}>
			<div class="stat">
				<dt>3D Editions</dt>
				<dd>
					<a href={resolve('/editions')}>{statsPending ? '—' : $homeStore.editionTotal}</a>
				</dd>
			</div>
			<div class="stat">
				<dt>Collections</dt>
				<dd>
					<a href={resolve('/collections')}>{statsPending ? '—' : $homeStore.collectionTotal}</a>
				</dd>
			</div>
			<div class="stat">
				<dt>Authors trained</dt>
				<dd>100+</dd>
			</div>
			<div class="stat">
				<dt>Presentations & workshops</dt>
				<dd>45</dd>
			</div>
		</dl>
	{/snippet}

	<section class="hero" aria-labelledby="home3-title">
		<ParticleHero copy={heroCopy} {glyphs} minimal />
	</section>

	<HomeOpenCalls />
	{@render latestNews()}

	<section class="evidence" aria-labelledby="home3-evidence">
		<div class="shell">
			<header class="section-head evidence-head">
				<div>
					<h2 id="home3-evidence" use:reveal>Narrative-driven 3D models</h2>
					<p class="section-sub" use:reveal={80}>
						A 3D Scholarly Edition combines a 3D model with annotation and interaction to
						contextualise its historical, cultural and social significance.
					</p>
				</div>
				{@render catalogueStats()}
			</header>
			<div class="edition-story" use:reveal>
				<figure class="story-media" id="home3-story-media">
					<div class="story-image">
						{#each storySteps as step, i (step.kicker)}
							<img
								src={`${base}${step.image}`}
								alt={step.alt}
								hidden={storyIndex !== i}
								loading="lazy"
								decoding="async"
							/>
						{/each}
					</div>
					<figcaption aria-live="polite">
						<span>{selectedStory.caption}</span>
						<a href={resolve('/editions/[slug]', { slug: '4ze4q66v8wbs87n' })}>
							Akua’ba child figure <span aria-hidden="true">↗</span>
						</a>
					</figcaption>
				</figure>
				<ol class="story-steps" aria-label="Explore the three stages of an edition">
					{#each storySteps as step, i (step.kicker)}
						<li>
							<button
								type="button"
								aria-pressed={storyIndex === i}
								aria-controls="home3-story-media"
								onclick={() => (storyIndex = i)}
							>
								<span class="story-step-head">
									<span class="kicker">0{i + 1} / {step.kicker}</span>
									<span class="story-arrow" aria-hidden="true">↗</span>
								</span>
								<span class="story-title">{step.title}</span>
								<span class="story-description">{step.description}</span>
							</button>
						</li>
					{/each}
				</ol>
				<div class="story-mobile-copy">
					<h3>{selectedStory.title}</h3>
					<p>{selectedStory.description}</p>
				</div>
			</div>
		</div>
	</section>

	<section class="workflow" aria-labelledby="home3-workflow">
		<div class="shell">
			<header class="section-head" use:reveal>
				<h2 id="home3-workflow">From proposal to 3D Scholarly Editions</h2>
				<p class="section-sub">
					PURE3D provides a supportive environment for authors to publish their 3D research,
					including training and mentorship throughout the publishing process.
				</p>
			</header>
			<ol class="track">
				{#each workflow as item, i (item)}
					<li use:reveal={i * 80}>
						<span class="node">{String(i + 1).padStart(2, '0')}</span>
						<span class="step">{item}</span>
					</li>
				{/each}
			</ol>
		</div>
	</section>

	<section class="collections" aria-labelledby="home3-collections">
		<div class="shell">
			<header class="section-head split" use:reveal>
				<div>
					<h2 id="home3-collections">Collections as <em>scholarly contexts</em></h2>
					<p class="section-sub">
						Collections organise 3D scholarly editions by theme, period, provenance, institution, or
						material context.
					</p>
				</div>
				<a class="more" href={resolve('/collections')}>
					All collections <span aria-hidden="true">↗</span>
				</a>
			</header>
			{#if collections.length > 0}
				<div class="collection-grid">
					{#each collections as collection, i (collection.id)}
						<div use:reveal={i * 80}>
							<CollectionCard {collection} showDescription={false} imageLoading="lazy" />
						</div>
					{/each}
				</div>
			{:else if statsPending}
				<div class="collection-grid" aria-hidden="true">
					{#each [0, 1, 2, 3] as i (i)}
						<div class="placeholder"></div>
					{/each}
				</div>
			{:else}
				<p class="empty" use:reveal>No collections available yet.</p>
			{/if}
		</div>
	</section>

	<section class="promises" aria-labelledby="home3-promises">
		<div class="shell">
			<header class="section-head" use:reveal>
				<h2 id="home3-promises"><em>PURE3D</em> centres on community</h2>
				<p class="section-sub">
					The infrastructure serves diverse 3D communities, including scholars, educators, cultural
					heritage professionals, students and the broader public.
				</p>
			</header>
			<div class="promise-grid">
				{#each promiseCards as card, i (card.title)}
					<article class="promise" use:reveal={i * 80}>
						<span class="kicker">{String(i + 1).padStart(2, '0')} /</span>
						<h3>{card.title}</h3>
						<p>{card.text}</p>
					</article>
				{/each}
			</div>
		</div>
	</section>

	{#snippet latestNews()}
		<section class="news" aria-labelledby="home3-news">
			<div class="shell">
				<header class="section-head split" use:reveal>
					<div>
						<h2 id="home3-news">Latest news</h2>
						<p class="section-sub">Calls, workshops and announcements from the PURE3D community.</p>
					</div>
					<a class="more" href={resolve('/resources')}
						>All news <span aria-hidden="true">↗</span></a
					>
				</header>
				{#if news.length > 0}
					<div class="news-grid">
						{#each news as item, i (item.id)}
							<article class="news-card" use:reveal={i * 80}>
								{#if item.publishedAt}
									<time datetime={item.publishedAt}>
										{new Date(item.publishedAt).toLocaleDateString('en-GB', {
											day: 'numeric',
											month: 'long',
											year: 'numeric'
										})}
									</time>
								{/if}
								<h3>
									<a href={resolve('/resources/[slug]', { slug: item.slug })}>{item.title}</a>
								</h3>
								{#if item.summary}<p>{item.summary}</p>{/if}
								<a class="more" href={resolve('/resources/[slug]', { slug: item.slug })}>
									Read more <span aria-hidden="true">→</span>
								</a>
							</article>
						{/each}
					</div>
				{:else if newsLoading}
					<div class="news-grid" aria-hidden="true">
						<div class="news-placeholder"></div>
						<div class="news-placeholder"></div>
					</div>
				{/if}
			</div>
		</section>
	{/snippet}

	<section class="call" aria-labelledby="home3-call">
		<div class="shell">
			<div class="call-plate" use:reveal>
				<div>
					<h2 id="home3-call">Propose your own <em>3D Scholarly Edition.</em></h2>
				</div>
				<div>
					<p>
						PURE3D provides the infrastructure and tools to publish interactive 3D research. Join
						our growing community of edition authors.
					</p>
					<div class="actions">
						<a href={resolve('/documentation')} class="button button-primary">
							Get started <span aria-hidden="true">→</span>
						</a>
						<a
							href={resolve('/documentation/[slug]', { slug: 'calls' })}
							class="button button-on-ink"
						>
							Open calls
						</a>
					</div>
				</div>
			</div>
		</div>
	</section>

	<section class="newsletter" aria-label="Newsletter">
		<div class="shell">
			<NewsletterSignup id="home-newsletter" framed />
		</div>
	</section>

	<section class="partners" aria-labelledby="home3-partners">
		<div class="shell">
			<h2 id="home3-partners" class="partners-head" use:reveal>Supported by</h2>
			<ul class="partner-list">
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				{#each partnerLogos as partner, i (partner.name)}
					<li use:reveal={i * 80}>
						<a
							href={partner.href}
							class:nwo-partner={partner.name === 'NWO'}
							target="_blank"
							rel="noreferrer"
						>
							<img src={`${base}${partner.image}`} alt={partner.name} loading="lazy" />
						</a>
					</li>
				{/each}
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</ul>
		</div>
	</section>
</div>

<style>
	#home3 {
		--rule: color-mix(in srgb, var(--color-base-content) 12%, transparent);
		--rule-strong: color-mix(in srgb, var(--color-base-content) 22%, transparent);
		--ease-out: cubic-bezier(0.2, 0.7, 0.1, 1);
		overflow-x: clip;
		background: var(--color-base-100);
		color: var(--color-base-content);
		font-family: var(--font-sans);
	}
	#home3 :global(em) {
		font-family: var(--font-serif);
		font-style: italic;
		font-weight: 400;
		color: var(--color-vermillion-ink);
	}
	#home3 :global(a:focus-visible),
	#home3 :global(button:focus-visible) {
		outline: 2px solid var(--color-vermillion);
		outline-offset: 3px;
	}

	.shell {
		max-width: 1320px;
		margin: 0 auto;
		padding: 0 clamp(20px, 4vw, 48px);
	}

	.button {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		min-height: 48px;
		padding: 12px 20px;
		border: 1px solid transparent;
		border-radius: var(--radius-control);
		font: 500 15px/1.2 var(--font-sans);
		text-decoration: none;
		transition:
			background 0.18s ease,
			border-color 0.18s ease,
			translate 0.18s ease;
	}
	.button:hover {
		translate: 0 -1px;
	}
	.button-primary {
		background: var(--color-primary);
		color: var(--color-primary-content);
	}
	.button-primary:hover {
		background: var(--color-forest-hover);
	}
	.button-on-ink {
		border-color: color-mix(in srgb, var(--color-panel-content) 35%, transparent);
		color: var(--color-panel-content);
	}
	.button-on-ink:hover {
		border-color: var(--color-panel-content);
		background: color-mix(in srgb, var(--color-panel-content) 8%, transparent);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
	}
	.more {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		font: 500 14px/1 var(--font-sans);
		color: var(--color-ink-2);
		text-decoration: underline;
		text-decoration-color: var(--rule-strong);
		text-underline-offset: 5px;
	}
	.more:hover {
		text-decoration-color: var(--color-vermillion);
	}

	/* ---------- hero ---------- */
	.hero-copy-mobile {
		display: none;
	}
	@media (max-width: 640px) {
		.hero-copy-desktop {
			display: none;
		}
		.hero-copy-mobile {
			display: inline;
		}
	}
	/* The hero is a full-bleed ink field; the artwork or the edition viewer sits inside it. */
	.hero {
		--on-ink: color-mix(in srgb, var(--color-hero-content) 80%, transparent);
		--on-ink-muted: color-mix(in srgb, var(--color-hero-content) 64%, transparent);
		--on-ink-rule: color-mix(in srgb, var(--color-hero-content) 16%, transparent);
		position: relative;
		isolation: isolate;
		overflow: hidden;
		border-bottom: 1px solid var(--rule);
		background: var(--color-hero-bg);
		color: var(--color-hero-content);
	}
	#home3 .hero em {
		font-family: inherit;
		font-style: normal;
		color: var(--color-hero-accent);
	}
	h1 {
		margin: 0;
		font-family: 'Times New Roman', Times, serif;
		font-weight: 400;
		font-size: clamp(42px, 5.3vw, 80px);
		line-height: 0.98;
		letter-spacing: -0.035em;
		text-wrap: balance;
		color: var(--color-hero-content);
	}
	.lede {
		margin: 0;
		max-width: 46ch;
		font-family: var(--font-sans);
		font-size: clamp(17px, 1.4vw, 20px);
		line-height: 1.6;
		color: var(--on-ink);
		text-wrap: pretty;
	}
	.hero .button-primary {
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-hero-content) 18%, transparent);
	}
	.hero .button-on-ink {
		color: var(--color-hero-content);
		border-color: color-mix(in srgb, var(--color-hero-content) 35%, transparent);
	}
	.hero .button-on-ink:hover {
		background: color-mix(in srgb, var(--color-hero-content) 8%, transparent);
	}
	.section-head.evidence-head {
		max-width: none;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		align-items: center;
		gap: 48px;
	}
	.evidence-head > div {
		display: grid;
		gap: 16px;
	}
	.catalogue-stats {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 16px;
		margin: 0;
		padding-block: 24px;
		border-block: 1px solid var(--rule);
	}
	.stat {
		display: grid;
		align-content: start;
		gap: 8px;
		padding: 0;
		min-width: 0;
		border: 0;
		white-space: normal;
	}
	.stat:has(a) {
		position: relative;
		width: fit-content;
		justify-self: start;
	}
	.stat a {
		color: inherit;
		text-decoration: none;
	}
	.stat a::after {
		position: absolute;
		inset: -8px;
		border-radius: 8px;
		content: '';
		transition: background-color 0.18s ease;
	}
	.stat a:hover::after,
	.stat a:focus-visible::after {
		background-color: color-mix(in srgb, currentColor 6%, transparent);
	}
	.stat dt {
		order: 2;
		font-family: var(--font-mono);
		font-size: 10.5px;
		line-height: 1.3;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-ink-3);
	}
	.stat dd {
		order: 1;
		margin: 0;
		font-size: clamp(38px, 4vw, 56px);
		font-weight: 500;
		line-height: 1;
		letter-spacing: -0.025em;
		font-variant-numeric: tabular-nums;
		transition: color 0.18s ease;
	}

	/* ---------- shared section chrome ---------- */
	section:not(.hero) {
		padding: clamp(80px, 10vw, 136px) 0;
		border-bottom: 1px solid var(--rule);
	}
	.section-head {
		display: grid;
		gap: 16px;
		max-width: 60ch;
		margin-bottom: clamp(40px, 6vw, 72px);
	}
	.section-head.split {
		max-width: none;
		grid-template-columns: minmax(0, 60ch) auto;
		justify-content: space-between;
		align-items: end;
	}
	.section-head.split > div {
		display: grid;
		gap: 16px;
	}
	h2 {
		margin: 0;
		font-weight: 500;
		font-size: clamp(30px, 4vw, 52px);
		line-height: 1.04;
		letter-spacing: -0.028em;
		text-wrap: balance;
	}
	h3 {
		margin: 0;
		font-weight: 500;
		letter-spacing: -0.02em;
	}
	.section-sub {
		margin: 0;
		font-family: var(--font-serif);
		font-size: 18px;
		line-height: 1.5;
		color: var(--color-ink-2);
		text-wrap: pretty;
	}
	.kicker {
		font-family: var(--font-mono);
		font-size: 11.5px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-vermillion-ink);
	}

	/* ---------- real-edition walkthrough ---------- */
	.edition-story {
		display: grid;
		grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
		align-items: start;
		gap: 40px;
	}
	.story-media {
		margin: 0;
	}
	.story-image {
		aspect-ratio: 4 / 3;
		overflow: hidden;
		border-radius: var(--radius-surface);
		background: var(--color-paper-2);
	}
	.story-image img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.story-image img[hidden] {
		display: none;
	}
	.story-media figcaption {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 8px 24px;
		padding-top: 16px;
		font-size: 12px;
		line-height: 1.5;
		color: var(--color-ink-3);
	}
	.story-media figcaption a {
		color: var(--color-ink-2);
		text-underline-offset: 4px;
	}
	.story-steps {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.story-steps li + li {
		border-top: 1px solid var(--rule);
	}
	.story-steps button {
		display: grid;
		gap: 12px;
		width: 100%;
		padding: 24px;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}
	.story-steps button:hover,
	.story-steps button[aria-pressed='true'] {
		background: var(--color-paper-2);
	}
	.story-step-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}
	.story-arrow {
		color: var(--color-ink-3);
		opacity: 0;
	}
	.story-steps button[aria-pressed='true'] .story-arrow,
	.story-steps button:hover .story-arrow,
	.story-steps button:focus-visible .story-arrow {
		opacity: 1;
	}
	.story-title {
		font-size: 24px;
		font-weight: 500;
		line-height: 1.08;
		letter-spacing: -0.02em;
	}
	.story-description {
		font-family: var(--font-serif);
		font-size: 16px;
		line-height: 1.5;
		color: var(--color-ink-3);
	}
	.story-mobile-copy {
		display: none;
	}

	/* ---------- workflow track ---------- */
	.workflow {
		position: relative;
		overflow: hidden;
		background: var(--color-panel-bg);
		color: var(--color-panel-content);
	}
	.workflow h2 {
		color: var(--color-panel-content);
	}
	.workflow .section-sub {
		color: color-mix(in srgb, var(--color-panel-content) 76%, transparent);
	}
	.track {
		position: relative;
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 12px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.track::before {
		content: '';
		position: absolute;
		top: 21px;
		right: 8%;
		left: 8%;
		height: 1px;
		background: linear-gradient(
			90deg,
			color-mix(in srgb, var(--color-panel-content) 20%, transparent),
			var(--color-vermillion) 85%,
			var(--color-vermillion)
		);
	}
	.track li {
		position: relative;
		display: grid;
		justify-items: center;
		gap: 14px;
		text-align: center;
	}
	.node {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border: 1px solid color-mix(in srgb, var(--color-panel-content) 30%, transparent);
		border-radius: 50%;
		background: var(--color-panel-bg);
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 0.06em;
	}
	.track li:last-child .node {
		border-color: var(--color-vermillion);
		background: var(--color-vermillion);
		color: var(--color-accent-content);
	}
	.step {
		font-size: 15px;
		font-weight: 500;
		line-height: 1.3;
	}

	/* ---------- collections ---------- */
	.collections {
		background: var(--color-base-200);
	}
	.collection-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 16px;
	}
	.placeholder {
		height: 24rem;
		border-radius: var(--radius-surface);
		background: var(--color-base-300);
	}
	.empty {
		margin: 0;
		padding: 48px 0;
		text-align: center;
		font: italic 400 17px/1.5 var(--font-serif);
		color: var(--color-ink-4);
	}

	/* ---------- promises ---------- */
	.promise-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 32px;
	}
	.promise {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 24px 0 0;
		border-top: 1px solid var(--rule-strong);
	}
	.promise h3 {
		margin-top: 16px;
		font-size: clamp(22px, 2.4vw, 30px);
		line-height: 1.08;
	}
	.promise p {
		margin: 0;
		font-family: var(--font-serif);
		font-size: 17px;
		line-height: 1.5;
		color: var(--color-ink-2);
	}

	/* ---------- latest news ---------- */
	.news {
		background: var(--color-base-200);
	}
	.news-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 16px;
	}
	.news-card {
		display: grid;
		align-content: start;
		gap: 16px;
		min-height: 280px;
		padding: clamp(24px, 3vw, 40px);
		border-radius: var(--radius-surface);
		background: var(--color-paper);
	}
	.news-card time {
		font: 11px/1.4 var(--font-mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-ink-4);
	}
	.news-card h3 {
		font-size: clamp(22px, 2.5vw, 32px);
		line-height: 1.12;
	}
	.news-card h3 a {
		color: inherit;
		text-decoration: none;
	}
	.news-card h3 a:hover {
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-underline-offset: 5px;
	}
	.news-card p {
		display: -webkit-box;
		overflow: hidden;
		margin: 0;
		font: 17px/1.5 var(--font-serif);
		color: var(--color-ink-2);
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
	}
	.news-card > .more {
		align-self: end;
		justify-self: start;
		margin-top: auto;
	}
	.news-placeholder {
		height: 280px;
		border-radius: var(--radius-surface);
		background: var(--color-base-300);
	}

	/* ---------- call for editions ---------- */
	.call-plate {
		position: relative;
		overflow: hidden;
		display: grid;
		grid-template-columns: 1.1fr 1fr;
		gap: clamp(32px, 5vw, 64px);
		align-items: end;
		padding: clamp(40px, 6vw, 80px) clamp(28px, 5vw, 64px);
		border-radius: var(--radius-surface);
		background: var(--color-panel-bg);
		color: var(--color-panel-content);
	}
	.call-plate > div {
		display: grid;
		gap: 24px;
	}
	.call-plate h2 {
		color: var(--color-panel-content);
	}
	#home3 .call-plate h2 :global(em) {
		color: var(--color-panel-content);
	}
	.call-plate p {
		margin: 0;
		max-width: 50ch;
		font-family: var(--font-serif);
		font-size: 18px;
		line-height: 1.5;
		color: color-mix(in srgb, var(--color-panel-content) 80%, transparent);
	}

	/* ---------- partners ---------- */
	section.partners {
		padding: 64px 0 80px;
		border-bottom: 0;
	}
	.partners-head {
		margin-bottom: 24px;
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 400;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		text-align: center;
		color: var(--color-ink-4);
	}
	.partner-list {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 16px;
		max-width: 808px;
		margin: 0 auto;
		padding: 0;
		list-style: none;
	}
	.partner-list a {
		display: grid;
		place-items: center;
		width: 100%;
		height: 88px;
		padding: 18px;
		border: 1px solid var(--rule);
		border-radius: var(--radius-surface);
		background: var(--color-paper);
		transition: border-color 0.18s ease;
	}
	.partner-list a:hover {
		border-color: var(--rule-strong);
	}
	.partner-list img {
		max-width: 100%;
		max-height: 48px;
		object-fit: contain;
	}
	.partner-list a.nwo-partner {
		padding: 14px;
	}
	.partner-list .nwo-partner img {
		max-height: 60px;
	}
	/* ---------- motion ---------- */
	@media (prefers-reduced-motion: no-preference) {
		.rise {
			animation: rise 0.9s var(--ease-out) both;
			animation-delay: calc(var(--i, 0) * 90ms + 60ms);
		}
		#home3 :global(.reveal-pending) {
			opacity: 0;
			translate: 0 24px;
		}
		#home3 :global(.reveal-visible),
		#home3 :global(.reveal-pending:focus-within) {
			opacity: 1;
			translate: 0 0;
			transition:
				opacity 0.8s var(--ease-out) var(--reveal-delay, 0ms),
				translate 0.8s var(--ease-out) var(--reveal-delay, 0ms);
		}
	}
	@keyframes rise {
		from {
			opacity: 0;
			translate: 0 24px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.button,
		.stat dd,
		.partner-list a {
			transition: none;
		}
		.button:hover {
			translate: none;
		}
	}

	/* ---------- responsive ---------- */
	@media (max-width: 600px) {
		.partner-list {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 1100px) {
		.collection-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.track {
			grid-template-columns: repeat(3, minmax(0, 1fr));
			row-gap: 32px;
		}
		.track::before {
			display: none;
		}
	}
	@media (max-width: 960px) {
		.section-head.evidence-head {
			grid-template-columns: minmax(0, 1fr);
			gap: 28px;
		}
		.call-plate {
			grid-template-columns: 1fr;
		}
		.edition-story,
		.promise-grid {
			grid-template-columns: 1fr;
		}
		.edition-story {
			gap: 24px;
		}
		.story-steps {
			order: -1;
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			border-bottom: 1px solid var(--rule);
		}
		.story-steps li + li {
			border-top: 0;
		}
		.story-steps button {
			height: 100%;
			padding: 16px;
			align-content: start;
		}
		.story-steps .story-title {
			font-size: 20px;
		}
		.story-description,
		.story-arrow {
			display: none;
		}
		.story-mobile-copy {
			display: grid;
			gap: 12px;
		}
		.story-mobile-copy h3 {
			font-size: 24px;
		}
		.story-mobile-copy p {
			margin: 0;
			font-family: var(--font-serif);
			font-size: 17px;
			line-height: 1.5;
			color: var(--color-ink-3);
		}
		.promise {
			min-height: 0;
		}
	}
	@media (max-width: 640px) {
		.catalogue-stats {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			row-gap: 24px;
		}
		.section-head.split {
			grid-template-columns: 1fr;
		}
		.collection-grid {
			grid-template-columns: 1fr;
		}
		.news-grid {
			grid-template-columns: 1fr;
		}
		.story-steps .story-title {
			display: none;
		}
		.story-steps button {
			padding: 16px 8px;
		}
		.story-steps .kicker {
			font-size: 10px;
		}
		.track {
			grid-template-columns: 1fr;
			justify-items: start;
		}
		.track li {
			grid-auto-flow: column;
			justify-items: start;
			align-items: center;
			text-align: left;
		}
	}
</style>
