<script lang="ts">
	import { onMount, setContext } from 'svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { resolve } from '$app/paths';
	import { authStore } from '$lib/database/stores/auth.svelte';
	import { EditionStatus, GlobalRole } from '$lib/types/roles';
	import { pb } from '$lib/database/client';
	import FileTextIcon from '~icons/lucide/file-text';
	import ImagesIcon from '~icons/lucide/images';
	import NewspaperIcon from '~icons/lucide/newspaper';
	import TagsIcon from '~icons/lucide/tags';

	let { children } = $props();

	let sidebarOpen = $state(false);
	let submissionCount = $state(0);
	async function refreshSubmissionCount() {
		if (!authStore.isAuthenticated || authStore.globalRole !== GlobalRole.Admin) return;
		try {
			const result = await pb.collection('editions').getList(1, 1, {
				filter: pb.filter('status = {:status}', { status: EditionStatus.ConceptSubmitted }),
				fields: 'id',
				requestKey: 'admin-submission-count'
			});
			submissionCount = result.totalItems;
		} catch (error) {
			if (!(error as { isAbort?: boolean }).isAbort)
				console.error('Could not load submission count', error);
		}
	}
	afterNavigate(() => {
		void refreshSubmissionCount();
	});
	onMount(() => {
		if (!authStore.isAuthenticated || authStore.globalRole !== GlobalRole.Admin) return;
		let disposed = false;
		let unsubscribe: (() => Promise<void>) | undefined;
		void pb
			.collection('editions')
			.subscribe('*', () => {
				void refreshSubmissionCount();
			})
			.then((cleanup) => {
				if (disposed) void cleanup();
				else unsubscribe = cleanup;
			})
			.catch((error) => console.error('Could not subscribe to workflow updates', error));
		return () => {
			disposed = true;
			void unsubscribe?.();
		};
	});
	let createContent: (() => void) | null = null;
	setContext('admin-content-actions', {
		register(action: (() => void) | null) {
			createContent = action;
		}
	});

	const navItems = [
		{
			label: 'Content',
			href: '/admin/pages',
			separatorBefore: false,
			icon: 'M4 3h16v18H4zM8 7h8M8 11h8M8 15h5'
		},
		{
			label: 'Users',
			href: '/admin/users',
			separatorBefore: false,
			icon: 'M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z'
		},
		{
			label: 'Open Calls',
			href: '/admin/open-calls',
			separatorBefore: false,
			icon: 'm3 11 18-5v12L3 14v-3Zm3.2 3.8L8 21h5l-1.4-4.2M8 6.8v8.4'
		},
		{
			label: 'Workflow',
			href: '/admin/workflow',
			icon: 'M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m8.9-4.414c.376.023.75.05 1.124.08 1.131.094 1.976 1.057 1.976 2.192V16.5A2.25 2.25 0 0 1 18 18.75h-2.25m-7.5-10.5H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V18.75m-7.5-10.5h6.375c.621 0 1.125.504 1.125 1.125v9.375m-8.25-3 1.5 1.5 3-3.75',
			separatorBefore: true
		},
		{
			label: 'Collections',
			href: '/admin/collections',
			separatorBefore: false,
			icon: 'M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z'
		},
		{
			label: 'Editions',
			href: '/admin/editions',
			separatorBefore: false,
			icon: 'M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25'
		},
		{
			label: 'Storage',
			href: '/admin/storage',
			separatorBefore: false,
			icon: 'M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v4.125c0 2.278-3.694 4.125-8.25 4.125S3.75 12.778 3.75 10.5V6.375m16.5 4.125v4.125c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V10.5m16.5 4.125v3c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125v-3'
		},
		{
			label: 'Feedback',
			href: '/admin/feedback',
			icon: 'M7.5 8.25h9m-9 3h6m-8.25 8.25 3.674-3.674A2.25 2.25 0 0 1 10.515 15H19.5A2.25 2.25 0 0 0 21.75 12.75v-6A2.25 2.25 0 0 0 19.5 4.5h-15A2.25 2.25 0 0 0 2.25 6.75v6A2.25 2.25 0 0 0 4.5 15h.75v4.5Z',
			separatorBefore: true
		},
		{
			label: 'Audit Log',
			href: '/admin/audit',
			separatorBefore: false,
			icon: 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z'
		}
	] as const;
	const contentTabs = [
		{ label: 'Pages', href: '/admin/pages', icon: FileTextIcon },
		{ label: 'Materials', href: '/admin/pages', icon: FileTextIcon, filter: 'learning-materials' },
		{ label: 'Posts', href: '/admin/posts', icon: NewspaperIcon },
		{ label: 'Categories', href: '/admin/categories', icon: TagsIcon },
		{ label: 'Media', href: '/admin/media', icon: ImagesIcon }
	] as const;

	function isContentTabActive(tab: (typeof contentTabs)[number]): boolean {
		return (
			$page.url.pathname.startsWith(resolve(tab.href)) &&
			(tab.href !== '/admin/pages' ||
				($page.url.searchParams.get('filter') || '') === ('filter' in tab ? tab.filter : ''))
		);
	}

	function isContentRoute(): boolean {
		return contentTabs.some((tab) => $page.url.pathname.startsWith(resolve(tab.href)));
	}

	function isNavActive(href: (typeof navItems)[number]['href']): boolean {
		if (href === '/admin/pages') return isContentRoute();
		return $page.url.pathname.startsWith(resolve(href));
	}

	$effect(() => {
		if (!authStore.isAuthenticated) {
			goto(resolve('/'));
			return;
		}
		if (authStore.globalRole !== GlobalRole.Admin) {
			goto(resolve('/'));
			return;
		}
	});
</script>

<div id="admin-layout" class="flex min-h-[calc(100vh-4rem)] lg:pl-64">
	{#if authStore.isAuthenticated && authStore.globalRole === GlobalRole.Admin}
		<!-- Sidebar -->
		<aside
			class="fixed inset-y-0 left-0 z-40 w-64 shrink-0 transform overflow-y-auto border-r border-base-300 bg-base-200 pt-20 transition-transform duration-200 lg:top-[76px] lg:translate-x-0 lg:pt-0"
			class:translate-x-0={sidebarOpen}
			class:-translate-x-full={!sidebarOpen}
		>
			<div class="p-4">
				<h2 class="mb-4 text-lg font-bold">Admin</h2>
				<ul class="menu w-full gap-1">
					{#each navItems as item (item.href)}
						<li
							class:mt-1={item.separatorBefore}
							class:border-t={item.separatorBefore}
							class:border-base-300={item.separatorBefore}
							class:pt-2={item.separatorBefore}
						>
							<a
								href={resolve(item.href)}
								class="flex items-center gap-3"
								class:bg-base-300={isNavActive(item.href)}
								class:font-semibold={isNavActive(item.href)}
								onclick={() => (sidebarOpen = false)}
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									fill="none"
									viewBox="0 0 24 24"
									stroke-width="1.5"
									stroke="currentColor"
									class="size-5"
								>
									<path stroke-linecap="round" stroke-linejoin="round" d={item.icon} />
								</svg>
								{item.label}
								{#if item.href === '/admin/workflow' && submissionCount > 0}
									<span
										class="ml-auto badge badge-sm badge-neutral"
										aria-label={`${submissionCount} pending submissions`}>{submissionCount}</span
									>
								{/if}
							</a>
						</li>
					{/each}
				</ul>
			</div>
		</aside>

		<!-- Backdrop for mobile -->
		{#if sidebarOpen}
			<button
				class="fixed inset-0 z-30 cursor-default border-none bg-black/50 lg:hidden"
				onclick={() => (sidebarOpen = false)}
				aria-label="Close sidebar"
			></button>
		{/if}

		<!-- Main content -->
		<main class="min-w-0 flex-1 p-4 lg:p-8">
			<button
				class="btn mb-4 gap-2 btn-outline lg:hidden"
				onclick={() => (sidebarOpen = !sidebarOpen)}
				aria-label="Toggle admin sidebar"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
					stroke-width="1.5"
					stroke="currentColor"
					class="size-5"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
					/>
				</svg>
				Admin menu
			</button>
			{#if isContentRoute()}
				<div class="mb-8 flex flex-wrap items-center justify-between gap-4">
					<nav
						class="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-neutral p-1"
						aria-label="Content sections"
					>
						{#each contentTabs as tab (tab.label)}
							{@const Icon = tab.icon}
							<!-- eslint-disable svelte/no-navigation-without-resolve -- Resolve the typed route before appending its query string. -->
							<a
								class="flex shrink-0 items-center gap-2 rounded-md px-5 py-2.5 text-sm font-semibold transition-colors"
								class:bg-base-100={isContentTabActive(tab)}
								class:shadow-sm={isContentTabActive(tab)}
								style:color={isContentTabActive(tab)
									? 'var(--color-base-content)'
									: 'var(--color-neutral-content)'}
								href={`${resolve(tab.href)}${'filter' in tab ? `?filter=${tab.filter}` : ''}`}
								aria-current={isContentTabActive(tab) ? 'page' : undefined}
							>
								<Icon class="size-4" aria-hidden="true" />
								{tab.label}
							</a>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						{/each}
					</nav>
					{#if $page.url.pathname.startsWith(resolve('/admin/pages')) || $page.url.pathname.startsWith(resolve('/admin/posts'))}
						<button class="btn shrink-0 btn-primary" onclick={() => createContent?.()}>
							+ New {$page.url.pathname.startsWith(resolve('/admin/posts')) ? 'post' : 'page'}
						</button>
					{/if}
				</div>
			{/if}
			{@render children?.()}
		</main>
	{/if}
</div>
