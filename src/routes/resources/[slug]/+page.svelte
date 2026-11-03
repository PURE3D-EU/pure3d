<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- The resolved admin route appends the record ID as a query parameter. */
	import { resolve } from '$app/paths';
	import { kindLabels } from '$lib/content';
	import ContentRenderer from '$lib/components/content/ContentRenderer.svelte';
	import ContactPage from '$lib/components/content/ContactPage.svelte';
	import { contentPath } from '$lib/cms';
	import { base } from '$app/paths';
	import { authStore } from '$lib/database/stores/auth.svelte';
	import { localContentAssetUrl } from '$lib/utils/local-content-asset';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	let item = $derived(data.item);
	let isImported = $derived(Boolean(item.sourceId));
</script>

<svelte:head
	><title>{item.title} | PURE3D</title><meta
		name="description"
		content={item.summary}
	/>{#if !item.isPublished}<meta name="robots" content="noindex,nofollow" />{/if}</svelte:head
>
{#if item.slug === 'contact'}
	<ContactPage
		content={item.body || ''}
		imported={isImported}
		isPublished={item.isPublished}
		editHref={`${resolve('/admin/pages')}?edit=${item.id}`}
	/>
{:else}
	<main id="resource-page" class="pb-20">
	<div
		class="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm md:px-10"
	>
		<a href={resolve('/resources')}>← All resources</a>{#if authStore.globalRole === 'admin'}<a
				class="btn btn-outline btn-sm"
				href={`${item.kind === 'post' ? resolve('/admin/posts') : resolve('/admin/pages')}?edit=${item.id}`}
				>Edit {item.kind === 'post' ? 'post' : 'page'}</a
			>{/if}
	</div>
	<div class="mx-auto max-w-7xl px-5 md:px-10">
		{#if !item.isPublished}<div
				class="mb-8 rounded-lg border border-base-300 bg-base-200 p-4 text-sm"
			>
				<strong>Draft preview</strong> · Only admins can view this page.
			</div>{/if}
	</div>
	<header class="border-y border-base-300 bg-base-200/50">
		<div class="mx-auto max-w-7xl px-5 py-12 md:px-10 md:py-18">
			{#if item.expand?.parent}<a
					class="mb-5 inline-block text-sm underline underline-offset-4"
					href={`${base}${contentPath(item.expand.parent)}`}>← {item.expand.parent.title}</a
				>{/if}
			<p class="mb-6 text-xs font-semibold tracking-[.2em] text-primary uppercase">
				{#if Array.isArray(item.expand?.categoryIds) && item.expand.categoryIds.length}
					{#each item.expand.categoryIds as category, index (category.id)}{#if index}
							·
						{/if}<a href={`${base}/resources?category=${category.slug}`}>{category.name}</a>{/each}
				{:else}{kindLabels[item.kind] || 'Page'}{/if}
			</p>
			<h1
				class="max-w-5xl font-serif text-5xl leading-[1.12] font-normal tracking-tight md:text-7xl"
			>
				{item.title}
			</h1>
			{#if item.summary && !isImported}<p
					class="mt-7 max-w-3xl text-lg leading-relaxed text-base-content/70 md:text-xl"
				>
					{item.summary}
				</p>{/if}
			<p class="mt-8 text-sm text-base-content/60">
				{item.author}{item.author && item.publishedAt ? ' · ' : ''}{item.publishedAt
					? new Date(item.publishedAt).toLocaleDateString('en-GB', {
							day: 'numeric',
							month: 'long',
							year: 'numeric'
						})
					: ''}
			</p>
		</div>
	</header>
	<div class="mx-auto max-w-7xl px-5 md:px-10">
		{#if item.kind !== 'post' && item.coverUrl}<img
				class="mt-10 max-h-[560px] w-full rounded-lg bg-base-200 object-contain"
				src={localContentAssetUrl(item.coverUrl)}
				alt=""
			/>{/if}
		<div class="mx-auto max-w-6xl pt-10 md:pt-16">
			<ContentRenderer
				content={item.body || ''}
				imported={isImported}
				team={isImported && item.slug === 'team'}
				className="prose prose-lg max-w-none"
			/>
			{#if data.children.length}<nav
					aria-label="Child pages"
					class="mt-12 border-t border-base-300 pt-6"
				>
					<h2 class="mb-4 font-semibold">In this section</h2>
					<ul class="space-y-3">
						{#each data.children as child (child.id)}<li>
								<a class="underline" href={`${base}${contentPath(child)}`}
									>{child.title}{!child.isPublished ? ' · Draft' : ''}</a
								>
							</li>{/each}
					</ul>
				</nav>{/if}
		</div>
	</div>
	</main>
{/if}

<style>
	#resource-page
		:global(
			#content-renderer
				> :is(p, h2, h3, h4, ul, ol, blockquote, pre, table, details, nav, aside, figure, iframe)
		) {
		max-width: 48rem;
		margin-inline: auto;
	}
</style>
