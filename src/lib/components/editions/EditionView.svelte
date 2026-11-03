<script lang="ts">
	import { creditHref, creatorNames, readCredits } from '$lib/utils/credits';
	import ContentRenderer from '$lib/components/content/ContentRenderer.svelte';
	import SafeLink from '$lib/components/ui/SafeLink.svelte';
	import { base, resolve } from '$app/paths';
	import { onMount, tick, untrack } from 'svelte';
	import type { EditionViewData, ViewPreset } from './edition-view';
	import VoyagerViewer, {
		type VoyagerAPI,
		type VoyagerCapabilities,
		type VoyagerFeatureNeeds,
		type VoyagerPanel
	} from '$lib/components/voyager/VoyagerViewer.svelte';
	import EditionAnnotations from '$lib/components/voyager/EditionAnnotations.svelte';
	import EditionStories from '$lib/components/voyager/EditionStories.svelte';
	import EditionMetadata from '$lib/components/editions/EditionMetadata.svelte';
	import OriginalEditionViewer from '$lib/components/voyager/OriginalEditionViewer.svelte';
	import KompakktViewer from '$lib/components/kompakkt/KompakktViewer.svelte';
	import {
		canPreviewEditionViewer,
		editionViewerPreferenceKey
	} from '$lib/components/voyager/edition-viewer-experiment';
	import { cachePrefix } from '$lib/database/client';
	import { getEditionCoverUrl } from '$lib/utils/asset-urls';
	import FlaskConicalIcon from '~icons/lucide/flask-conical';
	import {
		createRuntimeScene,
		loadEditionScene,
		parseEditionScene,
		type LoadedEditionScene
	} from '$lib/components/voyager/edition-scene';
	import { rewriteSceneJson } from '$lib/utils/svx-uri-rewriter';
	import { localizedValue } from '$lib/components/voyager/edition-content';
	import ReviewFeedbackList from '$lib/components/workflow/ReviewFeedbackList.svelte';
	import FinalReviewProgress from '$lib/components/workflow/FinalReviewProgress.svelte';
	import ImagineModal from '$lib/components/ui/ImagineModal.svelte';
	import StatusBadge from '$lib/components/workflow/StatusBadge.svelte';
	import { authStore } from '$lib/database/stores/auth.svelte';
	import { EditionStatus, GlobalRole, Permission, type UserRoleContext } from '$lib/types/roles';
	import { hasPermission } from '$lib/utils/permissions';
	import { resolvePageContext } from '$lib/utils/page-permissions';
	import CircleHelpIcon from '~icons/lucide/circle-help';
	import BookOpenIcon from '~icons/lucide/book-open';
	import InfoIcon from '~icons/lucide/info';
	import FileTextIcon from '~icons/lucide/file-text';
	import MapIcon from '~icons/lucide/map';
	import EllipsisIcon from '~icons/lucide/ellipsis';
	import LanguagesIcon from '~icons/lucide/languages';
	import MessageCircleIcon from '~icons/lucide/message-circle';
	import PanelRightCloseIcon from '~icons/lucide/panel-right-close';
	import PanelRightOpenIcon from '~icons/lucide/panel-right-open';
	import RotateCcwIcon from '~icons/lucide/rotate-ccw';
	import RulerIcon from '~icons/lucide/ruler';
	import SparklesIcon from '~icons/lucide/sparkles';
	import SmartphoneIcon from '~icons/lucide/smartphone';
	import Volume2Icon from '~icons/lucide/volume-2';
	import WrenchIcon from '~icons/lucide/wrench';

	// Parsed description segment type
	interface DescriptionSegment {
		type: 'text' | 'view-link';
		content: string;
		viewName?: string;
	}

	let { data, embedded = false }: { data: EditionViewData; embedded?: boolean } = $props();
	let previewOwner = $state<string | null>(null);
	type ViewerChoice = 'original' | 'experimental' | 'kompakkt';
	let viewerPreference = $state<ViewerChoice>('original');
	const canPreview = $derived(canPreviewEditionViewer(authStore.globalRole, authStore.appUserId));
	const selectedViewer = $derived(
		canPreview && authStore.appUserId === previewOwner ? viewerPreference : 'original'
	);
	const useExperimentalLayout = $derived(selectedViewer === 'experimental');
	const useKompakkt = $derived(selectedViewer === 'kompakkt');

	$effect(() => {
		const owner = canPreview ? authStore.appUserId : null;
		previewOwner = null;
		viewerPreference = 'original';
		if (!owner) return;
		try {
			const saved = localStorage.getItem(editionViewerPreferenceKey(cachePrefix, owner));
			if (saved === 'experimental' || saved === 'kompakkt') viewerPreference = saved;
		} catch {
			// Browser storage is optional; the preview still works for the current page.
		}
		previewOwner = owner;
	});

	function selectViewer(viewer: ViewerChoice) {
		const owner = authStore.appUserId;
		if (!canPreview || !owner) return;
		voyagerAPI?.stopTour();
		voyagerAPI = null;
		activeVoyagerPanel = null;
		isFullWindow = false;
		previewOwner = owner;
		viewerPreference = viewer;
		try {
			localStorage.setItem(
				editionViewerPreferenceKey(cachePrefix, owner),
				viewer
			);
		} catch {
			// Do not let restricted storage prevent switching layouts.
		}
	}

	// Voyager API reference for controlling the viewer
	let voyagerAPI = $state<VoyagerAPI | null>(null);
	let activeVoyagerPanel = $state<VoyagerPanel | null>(null);
	let viewerLanguages = $state<string[]>([]);
	let activeViewerLanguage = $state('EN');
	let loadedScene = $state.raw<LoadedEditionScene | null>(null);
	let sceneLoading = $state(false);
	let sceneError = $state('');
	let sceneReload = $state(0);
	let activeAnnotationCategories = $state<string[]>([]);
	let selectedAnnotationId = $state<string | null>(null);
	let viewerSurface = $state<HTMLDivElement>();
	let readingPanel = $state<HTMLDivElement>();
	let viewerCapabilities = $state<VoyagerCapabilities>({
		annotations: false,
		reader: false,
		tours: false,
		tools: false,
		measurement: false,
		ar: false,
		reset: false,
		audio: false
	});
	let viewerFeatureNeeds = $state<VoyagerFeatureNeeds>({
		annotations: false,
		reader: false,
		tours: false,
		tools: true,
		measurement: true,
		ar: true,
		reset: true,
		audio: false
	});

	// Make these reactive so they update when data changes on navigation
	let edition = $derived(data.edition);
	let siblingEditions = $derived(data.siblingEditions ?? []);
	let viewerHelp = $derived(data.viewerHelp);
	let viewerHelpVideoUrl = $derived(data.viewerHelpVideoUrl);
	const editionCoverUrl = $derived(
		getEditionCoverUrl({ ...edition, collectionId: edition.collectionId ?? undefined })
	);

	// Get view presets from edition (if available)
	const viewPresets = $derived<ViewPreset[]>(edition.viewPresets || []);

	// The app owns the viewer chrome by default; an edition can explicitly restore Voyager's menu.
	const showVoyagerMenu = $derived(edition.showVoyagerMenu === true);

	// Custom controls are the inverse of Voyager menu visibility
	const showCustomControls = $derived(!showVoyagerMenu);

	/**
	 * Parse description text and extract view link markers
	 * Syntax: [[view:preset-name|display text]]
	 */
	function parseDescription(text: string): DescriptionSegment[] {
		const segments: DescriptionSegment[] = [];
		const regex = /\[\[view:([^\]|]+)\|([^\]]+)\]\]/g;
		let lastIndex = 0;
		let match;

		while ((match = regex.exec(text)) !== null) {
			// Add text before the match
			if (match.index > lastIndex) {
				segments.push({
					type: 'text',
					content: text.slice(lastIndex, match.index)
				});
			}

			// Add the view link
			segments.push({
				type: 'view-link',
				content: match[2], // display text
				viewName: match[1] // preset name
			});

			lastIndex = match.index + match[0].length;
		}

		// Add remaining text
		if (lastIndex < text.length) {
			segments.push({
				type: 'text',
				content: text.slice(lastIndex)
			});
		}

		return segments;
	}

	// Parsed description segments
	const descriptionSegments = $derived(parseDescription(edition.description || ''));
	const credits = $derived(readCredits(edition.credits));
	const creators = $derived(credits.filter((credit) => credit.role === 'creator'));

	/**
	 * Handle click on a view link - change camera position
	 */
	function handleViewClick(presetName: string) {
		if (!voyagerAPI) return;

		const preset = viewPresets.find((p) => p.name === presetName);
		if (preset) {
			voyagerAPI.setView({
				yaw: preset.yaw,
				pitch: preset.pitch,
				offsetX: preset.offsetX,
				offsetY: preset.offsetY,
				offsetZ: preset.offsetZ,
				animate: true,
				durationMs: 2200
			});
		}
	}

	// Convert YouTube URL to embed URL
	function getYouTubeEmbedUrl(url: string): string | null {
		if (!url) return null;
		// Handle various YouTube URL formats
		const patterns = [
			/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
			/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/
		];
		for (const pattern of patterns) {
			const match = url.match(pattern);
			if (match) return `https://www.youtube.com/embed/${match[1]}`;
		}
		return url; // Return as-is if already an embed URL or other format
	}

	const embedVideoUrl = $derived(getYouTubeEmbedUrl(viewerHelpVideoUrl || ''));

	let readingTab = $state<'overview' | 'stories' | 'details'>('overview');
	let detailsTab = $state<'metadata' | 'peer-review' | 'printables' | 'versions'>('metadata');
	let selectedStoryId = $state<string | null>(null);
	let activeTour = $state({ tourIndex: -1, stepIndex: -1 });
	let isSidebarCollapsed = $state(false);
	let helpModalOpen = $state(false);
	let imagineModalOpen = $state(false);
	let loadedModelSize = $state<number | null>(null);
	let isFullWindow = $state(false);

	// Version history & citation state
	let citationCopied = $state(false);

	const primaryDoi = $derived(
		(edition.dcDoi?.[0] || '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
	);

	// Format citation (Chicago style)
	const citationText = $derived.by(() => {
		const creatorStr = creatorNames(credits) || 'Unknown';
		const citationDate = edition.dcDatePublished || edition.created;
		const year = citationDate ? new Date(citationDate).getFullYear() : '';
		const title = edition.title;
		const pubNum = edition.pubNum;
		const doi = primaryDoi;
		return `${creatorStr}. ${title}. Pure 3D${pubNum ? `, ed. ${String(pubNum).padStart(2, '0')}` : ''}${year ? ` (${year})` : ''}.${doi ? ` doi:${doi}.` : ''}`;
	});

	// Build diff/changelog from dcAbstract comparison with previous edition
	const changelog = $derived.by(() => {
		if (!siblingEditions || siblingEditions.length === 0) return [];
		const prevEdition = siblingEditions.find((s) => s.pubNum < (edition.pubNum || 0));
		if (!prevEdition) return [];

		const diffs: Array<{ type: 'add' | 'mod' | 'del'; text: string }> = [];

		// Compare model size
		const currentModel = edition.modelSize || '';
		const prevModel = prevEdition.modelSize || '';
		if (currentModel && prevModel && currentModel !== prevModel) {
			diffs.push({ type: 'mod', text: `Model size: ${prevModel} → ${currentModel}` });
		} else if (currentModel && !prevModel) {
			diffs.push({ type: 'add', text: `Model data: ${currentModel}` });
		}

		// Compare description/abstract
		const currentDesc = edition.description || '';
		const prevDesc = prevEdition.dcAbstract || '';
		if (currentDesc !== prevDesc) {
			if (prevDesc && currentDesc) {
				diffs.push({ type: 'mod', text: 'Description updated' });
			} else if (currentDesc && !prevDesc) {
				diffs.push({ type: 'add', text: 'Description added' });
			}
		}

		// Provenance note
		const provenance = edition.dcProvenance || '';
		if (provenance) {
			diffs.push({ type: 'add', text: `Provenance: ${provenance}` });
		}

		if (diffs.length === 0) {
			diffs.push({ type: 'mod', text: 'Minor updates and refinements' });
		}
		return diffs;
	});

	async function copyDoi() {
		const doi = primaryDoi;
		if (!doi) return;
		try {
			await navigator.clipboard.writeText(`https://doi.org/${doi}`);
			citationCopied = true;
			setTimeout(() => (citationCopied = false), 2000);
		} catch {
			// Fallback
		}
	}

	async function copyCitation() {
		const text = citationText;
		try {
			await navigator.clipboard.writeText(text);
			citationCopied = true;
			setTimeout(() => (citationCopied = false), 2000);
		} catch {
			// Fallback
		}
	}

	// Determine if we have local assets available for direct mode
	const useDirectMode = $derived(!!edition.voyagerRoot);
	const needsPreparedScene = $derived(
		useExperimentalLayout || Object.keys(edition.uploadedAssetMap ?? {}).length > 0
	);

	function formatDate(dateStr: string): string {
		if (!dateStr) return '—';
		const date = new Date(dateStr);
		return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
	}

	function handleModelLoaded(totalBytes: number) {
		loadedModelSize = totalBytes;
	}

	function handleViewerReady(api: VoyagerAPI) {
		if (useKompakkt) return;
		voyagerAPI = api;
		activeVoyagerPanel = null;
		if (!useExperimentalLayout) return;
		viewerCapabilities = api.getCapabilities();
		viewerFeatureNeeds = api.getFeatureNeeds();
		api.setLanguage(activeViewerLanguage);
		const tour = sceneContent?.tours[activeTour.tourIndex];
		const step = tour?.steps[activeTour.stepIndex];
		if (tour && step) api.setTourStep(tour.sourceIndex, step.sourceIndex, false);
		api.setActiveTags(activeAnnotationCategories);
		if (selectedAnnotationId) api.setActiveAnnotation(selectedAnnotationId);
	}

	const sceneContent = $derived(loadedScene?.scene ?? null);
	const activeTourStep = $derived(
		sceneContent?.tours[activeTour.tourIndex]?.steps[activeTour.stepIndex] ?? null
	);
	const linkedTourArticleId = $derived(activeTourStep?.articleId ?? null);
	const runtimeSceneOverride = $derived.by(() =>
		loadedScene
			? [
					{
						url: loadedScene.url,
						content: JSON.stringify(
							useExperimentalLayout ? createRuntimeScene(loadedScene.source) : loadedScene.source
						)
					}
				]
			: undefined
	);

	function handleTourChange(tourIndex: number, stepIndex: number) {
		if (!voyagerAPI) return;
		if (tourIndex < 0) return;
		const index = sceneContent?.tours.findIndex((tour) => tour.sourceIndex === tourIndex) ?? -1;
		const step =
			sceneContent?.tours[index]?.steps.findIndex((item) => item.sourceIndex === stepIndex) ?? -1;
		if (index < 0 || step < 0 || (activeTour.tourIndex === index && activeTour.stepIndex === step))
			return;
		activeTour = { tourIndex: index, stepIndex: step };
		const target = sceneContent!.tours[index].steps[step];
		if (target.articleId) void revealStory(target.articleId, false);
	}

	function selectTourStep(tourIndex: number, stepIndex: number) {
		const step = sceneContent?.tours[tourIndex]?.steps[stepIndex];
		if (!step) return;
		activeTour = { tourIndex, stepIndex };
		selectedAnnotationId = null;
		activeAnnotationCategories = step.categories;
		voyagerAPI?.setTourStep(sceneContent!.tours[tourIndex].sourceIndex, step.sourceIndex, true);
		voyagerAPI?.setActiveTags(step.categories);
		if (step.articleId) void revealStory(step.articleId, false);
	}

	function exitTour() {
		voyagerAPI?.stopTour();
		activeTour = { tourIndex: -1, stepIndex: -1 };
	}

	function selectStory(id: string | null) {
		selectedStoryId = id;
		isSidebarCollapsed = false;
	}

	function selectCategories(categories: string[]) {
		activeAnnotationCategories = categories;
		voyagerAPI?.setActiveTags(categories);
	}

	function selectAnnotation(id: string) {
		selectedAnnotationId = id;
		if (voyagerAPI) openViewerContent(() => voyagerAPI?.setActiveAnnotation(id));
		else {
			const annotation = sceneContent?.annotations.find((item) => item.id === id);
			if (annotation?.articleId) void revealStory(annotation.articleId);
		}
	}

	async function revealStory(id: string | null, scroll = true) {
		if (!id) return;
		selectedStoryId = id;
		readingTab = 'stories';
		isSidebarCollapsed = false;
		await tick();
		if (scroll && !isFullWindow && window.matchMedia('(max-width: 1023px)').matches) {
			readingPanel?.scrollIntoView({ block: 'start' });
		}
	}

	function openViewerContent(action: () => void) {
		action();
		const bounds = viewerSurface?.getBoundingClientRect();
		if (bounds && (bounds.top < 80 || bounds.bottom > window.innerHeight)) {
			viewerSurface?.scrollIntoView({ block: 'start' });
		}
	}

	function closeVoyagerPanel() {
		if (!voyagerAPI || !activeVoyagerPanel) return;
		if (activeVoyagerPanel === 'annotations') voyagerAPI.toggleAnnotations();
		if (activeVoyagerPanel === 'reader') voyagerAPI.toggleReader();
		if (activeVoyagerPanel === 'tours') voyagerAPI.toggleTours();
		if (activeVoyagerPanel === 'tools') voyagerAPI.toggleTools();
	}

	function setViewerLanguage(code: string, event?: MouseEvent) {
		voyagerAPI?.setLanguage(code);
		activeViewerLanguage = code;
		(event?.currentTarget as HTMLElement | undefined)?.closest('details')?.removeAttribute('open');
	}

	$effect(() => {
		void edition.id;
		void selectedViewer;
		isFullWindow = false;
		isSidebarCollapsed = false;
		loadedScene = null;
		sceneError = '';
		activeAnnotationCategories = [];
		selectedAnnotationId = null;
		viewerLanguages = [];
		activeViewerLanguage = 'EN';
		voyagerAPI = null;
		selectedStoryId = null;
		readingTab = 'overview';
		detailsTab = 'metadata';
		activeTour = { tourIndex: -1, stepIndex: -1 };
	});

	$effect(() => {
		void sceneReload;
		void edition.id;
		void selectedViewer;
		const root = edition.voyagerRoot;
		const document = edition.sceneFile || 'scene.svx.json';
		if (useKompakkt || !root || !needsPreparedScene) {
			sceneLoading = false;
			return;
		}
		const controller = new AbortController();
		sceneLoading = true;
		sceneError = '';
		untrack(() => loadEditionScene(root, document, window.location.href, controller.signal))
			.then((scene) => {
				if (controller.signal.aborted) return;
				if (edition.uploadedAssetMap && Object.keys(edition.uploadedAssetMap).length) {
					const source = rewriteSceneJson(scene.source as object, edition.uploadedAssetMap);
					scene = { ...scene, source, scene: parseEditionScene(source) };
				}
				loadedScene = scene;
				viewerLanguages = scene.scene.languages;
				activeViewerLanguage = scene.scene.defaultLanguage;
				activeAnnotationCategories = scene.scene.initialCategories;
				if (useExperimentalLayout) voyagerAPI?.setActiveTags(scene.scene.initialCategories);
			})
			.catch((reason: unknown) => {
				if (!controller.signal.aborted)
					sceneError = reason instanceof Error ? reason.message : 'The scene could not load.';
			})
			.finally(() => {
				if (!controller.signal.aborted) sceneLoading = false;
			});
		return () => controller.abort();
	});

	function toggleSidebar() {
		isSidebarCollapsed = !isSidebarCollapsed;
	}

	type OriginalTab = 'description' | 'metadata' | 'peer-review' | 'versions' | 'printables';
	const originalTab = $derived<OriginalTab>(readingTab === 'overview' ? 'description' : detailsTab);
	const originalTabs: { id: OriginalTab; label: string }[] = [
		{ id: 'description', label: 'Description' },
		{ id: 'metadata', label: 'Metadata' },
		{ id: 'peer-review', label: 'Peer Review' }
	];

	function selectOriginalTab(tab: OriginalTab) {
		if (tab === 'description') readingTab = 'overview';
		else {
			readingTab = 'details';
			detailsTab = tab;
		}
	}

	async function showMetadata() {
		selectOriginalTab('metadata');
		isSidebarCollapsed = false;
		await tick();
		if (window.innerWidth < 1024) readingPanel?.scrollIntoView({ block: 'start' });
	}

	function handleReadingTabKey(event: KeyboardEvent) {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		const current = event.currentTarget as HTMLButtonElement;
		const tabs = Array.from(
			current.closest('[role="tablist"]')!.querySelectorAll<HTMLButtonElement>('[role="tab"]')
		);
		const index = tabs.indexOf(current);
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? tabs.length - 1
					: (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
		event.preventDefault();
		tabs[next].click();
		tabs[next].focus();
	}

	function toggleFullWindow() {
		isFullWindow = !isFullWindow;
	}

	// Format peer review content - add spacing between reviewers
	function formatPeerReviewContent(content: string | null): string {
		if (!content) return '';
		// First, make all "Reviewer X:" bold
		let formatted = content.replace(/(Reviewer\s+\d+:)/gi, '<strong>$1</strong>');
		// Then add line breaks before all except the first one
		formatted = formatted.replace(/(?<!^)(<strong>Reviewer\s+\d+:<\/strong>)/gi, '<br><br>$1');
		return formatted;
	}

	const formattedPeerReview = $derived(formatPeerReviewContent(edition.peerReviewContent));
	const demoReviewFeedback = $derived(edition.demoReviewFeedback || []);
	const printables = $derived(edition.printables || []);

	// Handle escape key to exit full window mode
	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && isFullWindow) {
			event.preventDefault();
			event.stopPropagation();
			isFullWindow = false;
		}
	}

	// --- Manage link visibility ---
	let permissionContext = $state<UserRoleContext>({ globalRole: GlobalRole.User });
	let canManagePage = $derived(hasPermission(permissionContext, Permission.EditionEdit));

	onMount(async () => {
		if (edition.id === 'demo') return;

		if (!authStore.isAuthenticated || !authStore.appUserId) {
			permissionContext = { globalRole: authStore.globalRole };
			return;
		}

		permissionContext = await resolvePageContext({
			globalRole: authStore.globalRole,
			userProfileId: authStore.appUserId,
			collectionId: (edition as unknown as { collectionId?: string }).collectionId || null,
			editionId: edition.id
		});
	});
</script>

<svelte:window onkeydowncapture={handleKeydown} />

<svelte:head>
	<title>{edition.title} | Pure 3D</title>
	<meta name="description" content={edition.description} />

	<!-- Preconnect to Voyager API for faster loading -->
	<link rel="preconnect" href="https://3d-api.si.edu" crossorigin="anonymous" />
	<link rel="dns-prefetch" href="https://3d-api.si.edu" />
</svelte:head>

<div id="edition-view" class="min-h-[calc(100vh-4rem)] bg-base-100">
	<div class="container mx-auto max-w-7xl px-4 py-8">
		{#if !embedded || canPreview}
			<div class="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
				{#if !embedded}
					<!-- Breadcrumbs -->
					<nav class="breadcrumbs max-w-full min-w-0 text-sm">
						<ul>
							<li>
								<a href={resolve('/')} data-sveltekit-preload-data="hover" class="link link-hover"
									>Home</a
								>
							</li>
							<li>
								<a
									href={resolve('/editions')}
									data-sveltekit-preload-data="hover"
									class="link link-hover">Editions</a
								>
							</li>
							<li class="text-base-content/70">{edition.title}</li>
						</ul>
					</nav>
				{/if}
				{#if canPreview}
					<fieldset
						class="edition-viewer-switch ml-auto shrink-0"
						title="Admin-only viewer preview"
					>
						<legend class="sr-only">Viewer · admin preview</legend>
						<div role="group" aria-label="Viewer">
							<button
								type="button"
								aria-pressed={selectedViewer === 'original'}
								onclick={() => selectViewer('original')}>Original</button
							>
							<button
								type="button"
								aria-pressed={useExperimentalLayout}
								onclick={() => selectViewer('experimental')}
								><FlaskConicalIcon class="h-3.5 w-3.5" aria-hidden="true" />Experimental</button
							>
							<button
								type="button"
								aria-pressed={useKompakkt}
								onclick={() => selectViewer('kompakkt')}>Kompakkt</button
							>
						</div>
					</fieldset>
				{/if}
			</div>
		{/if}

		<!-- Title and Authors -->
		<div class="mb-8 flex items-start justify-between gap-6">
			<div class="min-w-0 flex-1">
				{#if !useExperimentalLayout && (edition.hasPeerReview || edition.isPublished === false || (edition.id !== 'demo' && edition.status === EditionStatus.Draft))}
					<div
						class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[10px] tracking-[0.12em] text-base-content/50 uppercase"
					>
						{#if edition.hasPeerReview}<span
								class="rounded-full bg-base-200 px-2.5 py-1 text-base-content/70"
								>Peer reviewed</span
							>{/if}
						{#if edition.isPublished === false}<span
								class="rounded-full bg-error px-2.5 py-1 text-error-content"
								title="This edition is hidden and not visible to public visitors">Not public</span
							>{/if}
						{#if edition.id !== 'demo' && edition.status === EditionStatus.Draft}<StatusBadge
								status={EditionStatus.Draft}
								size="sm"
							/>{/if}
					</div>
				{/if}
				<h1 class="max-w-5xl text-3xl leading-tight font-bold md:text-4xl lg:text-5xl">
					{edition.title}
				</h1>
				<p class="mt-3 text-base-content/70">
					{#each creators as credit, index (credit)}
						{@const href = creditHref(credit, base)}
						{#if href}<a
								{href}
								class="link link-hover"
								rel={credit.userId ? undefined : 'external noopener noreferrer'}>{credit.name}</a
							>{:else}{credit.name}{/if}{index < creators.length - 1 ? '; ' : ''}
					{/each}
				</p>
				<!-- Institution -->
				{#if edition.dcInstitution?.length}
					<p class="mt-1 text-sm text-base-content/45">
						{edition.dcInstitution.join(', ')}
					</p>
				{/if}
			</div>
			<div class="flex shrink-0 flex-col gap-2">
				{#if canManagePage}
					<a
						href={resolve('/editions/[slug]/workflow', { slug: edition.id })}
						class="btn btn-sm btn-primary"
					>
						Manage
					</a>
				{/if}
			</div>
		</div>

		<!-- Main Content Grid -->
		<div
			class="relative flex flex-col gap-8 transition-all duration-300 lg:flex-row lg:items-start"
		>
			<!-- Left Column - 3D Viewer -->
			<div class="min-w-0 flex-1 space-y-6">
				<!-- Voyager 3D Viewer -->
				<div
					class="ds-card-frame viewer-frame p-3 transition-all duration-300"
					class:full-window-viewer={isFullWindow}
				>
					{#key `${edition.id}:${selectedViewer}`}
						{#if useKompakkt}
							<KompakktViewer {edition} />
						{:else if !useExperimentalLayout}
							{#key loadedScene ?? edition.id}
								{#if needsPreparedScene && useDirectMode && !loadedScene}
									<div
										class="flex h-[495px] items-center justify-center text-sm text-base-content/60"
									>
										{sceneLoading ? 'Loading edition…' : '3D preview unavailable.'}
									</div>
								{:else}
									<OriginalEditionViewer
										{edition}
										{isFullWindow}
										doi={primaryDoi}
										coverUrl={editionCoverUrl}
										hasHelp={!!(viewerHelp || viewerHelpVideoUrl)}
										fetchOverrides={runtimeSceneOverride}
										onReady={handleViewerReady}
										onModelLoaded={handleModelLoaded}
										onHelp={() => (helpModalOpen = true)}
										onMetadata={showMetadata}
									/>
								{/if}
							{/key}
						{:else}
							<div
								bind:this={viewerSurface}
								class="relative scroll-mt-24 overflow-hidden rounded-lg bg-base-200"
							>
								{#key loadedScene ?? edition.id}
									{#if useDirectMode && !loadedScene}
										<div
											class="flex h-[495px] items-center justify-center text-sm text-base-content/60"
										>
											{sceneLoading
												? 'Loading edition content…'
												: '3D preview unavailable until edition content loads.'}
										</div>
									{:else}
										<VoyagerViewer
											url={useDirectMode ? edition.voyagerRoot : edition.voyagerUrl}
											document={edition.sceneFile}
											title={edition.title}
											coverUrl={editionCoverUrl}
											direct={useDirectMode}
											voyagerVersion={edition.voyagerVersion}
											resourceRoot={edition.voyagerResourceRoot}
											uiMode={showVoyagerMenu ? 'menu|title|language' : 'none'}
											fetchOverrides={runtimeSceneOverride}
											companionAssets={edition.uploadedAssetMap
												? { baseDir: edition.voyagerRoot, byBasename: edition.uploadedAssetMap }
												: undefined}
											onModelLoaded={handleModelLoaded}
											onReady={handleViewerReady}
											onAnnotationCategoriesChange={(categories) => {
												if (voyagerAPI) activeAnnotationCategories = categories;
											}}
											onActiveArticleChange={revealStory}
											onTourChange={(tourIndex, stepIndex) =>
												handleTourChange(tourIndex, stepIndex)}
											onPanelVisibilityChange={(panel) => (activeVoyagerPanel = panel)}
											onFullWindowToggle={toggleFullWindow}
											externalContent={useDirectMode}
											height={isFullWindow ? '100%' : '495px'}
											{isFullWindow}
											{showVoyagerMenu}
										/>
									{/if}
								{/key}

								<!-- Top right controls -->
								<div
									class="absolute right-3 z-10 flex gap-2 transition-all duration-300"
									class:top-3={!isFullWindow}
									class:top-20={isFullWindow}
								>
									{#if activeVoyagerPanel}
										<button
											type="button"
											class="viewer-glass-action viewer-glass-action-icon"
											onclick={closeVoyagerPanel}
											aria-label={`Close ${activeVoyagerPanel}`}
											title={`Close ${activeVoyagerPanel}`}
										>
											<svg
												xmlns="http://www.w3.org/2000/svg"
												fill="none"
												viewBox="0 0 24 24"
												stroke-width="2"
												stroke="currentColor"
												class="h-5 w-5"
												aria-hidden="true"
											>
												<path stroke-linecap="round" d="M6 6l12 12M18 6 6 18" />
											</svg>
										</button>
									{/if}
								</div>

								<!-- Custom command bar - only visible when enabled and API ready -->
								{#if showCustomControls && voyagerAPI && !activeVoyagerPanel}
									<div class="viewer-command-bar" role="toolbar" aria-label="3D viewer controls">
										{#if viewerFeatureNeeds.annotations}
											<button
												type="button"
												class="viewer-command-item"
												onclick={() => voyagerAPI?.toggleAnnotations()}
												disabled={!viewerCapabilities.annotations}
												aria-label="Toggle annotations"
											>
												<MessageCircleIcon class="h-5 w-5" aria-hidden="true" />
												<span class="viewer-command-label"
													>{viewerCapabilities.annotations
														? 'Annotations'
														: 'Annotations unavailable'}</span
												>
											</button>
										{/if}

										<button
											type="button"
											class="viewer-command-item"
											onclick={toggleFullWindow}
											aria-label={isFullWindow ? 'Exit full window' : 'Full window'}
										>
											{#if isFullWindow}
												<svg
													xmlns="http://www.w3.org/2000/svg"
													fill="none"
													viewBox="0 0 24 24"
													stroke-width="2"
													stroke="currentColor"
													class="h-5 w-5"
													aria-hidden="true"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25"
													/>
												</svg>
											{:else}
												<svg
													xmlns="http://www.w3.org/2000/svg"
													fill="none"
													viewBox="0 0 24 24"
													stroke-width="2"
													stroke="currentColor"
													class="h-5 w-5"
													aria-hidden="true"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
													/>
												</svg>
											{/if}
											<span class="viewer-command-label"
												>{isFullWindow ? 'Exit full screen' : 'Full screen'}</span
											>
										</button>

										<details class="viewer-more">
											<summary class="viewer-command-item" aria-label="More viewer controls">
												<EllipsisIcon class="h-5 w-5" aria-hidden="true" />
												<span class="viewer-command-label">More</span>
											</summary>

											<div class="viewer-more-menu">
												<button
													type="button"
													onclick={() => (imagineModalOpen = true)}
													title="Generate an AI image from this view"
												>
													<SparklesIcon class="h-5 w-5" aria-hidden="true" />
													<span>Imagine</span>
												</button>
												{#if viewerHelp || viewerHelpVideoUrl}
													<button type="button" onclick={() => (helpModalOpen = true)}>
														<CircleHelpIcon class="h-5 w-5" aria-hidden="true" />
														<span>Viewer help</span>
													</button>
												{/if}
												<button
													type="button"
													onclick={() => voyagerAPI?.toggleTools()}
													disabled={!viewerCapabilities.tools}
													title={viewerCapabilities.tools
														? 'Toggle tools'
														: 'Unavailable in this Voyager API version'}
												>
													<WrenchIcon class="h-5 w-5" aria-hidden="true" />
													<span>Tools</span>
												</button>
												<button
													type="button"
													onclick={() => voyagerAPI?.toggleMeasurement()}
													disabled={!viewerCapabilities.measurement}
													title={viewerCapabilities.measurement
														? 'Toggle measurement'
														: 'Unavailable in this Voyager API version'}
												>
													<RulerIcon class="h-5 w-5" aria-hidden="true" />
													<span>Measure</span>
												</button>
												<button
													type="button"
													onclick={() => voyagerAPI?.enableAR()}
													disabled={!viewerCapabilities.ar}
													title={viewerCapabilities.ar
														? 'View in AR (supported devices only)'
														: 'AR is not available on this device or browser'}
												>
													<SmartphoneIcon class="h-5 w-5" aria-hidden="true" />
													<span>View in AR</span>
												</button>
												<button
													type="button"
													onclick={() => voyagerAPI?.resetViewer()}
													disabled={!viewerCapabilities.reset}
													title={viewerCapabilities.reset
														? 'Reset viewer'
														: 'Unavailable in this Voyager API version'}
												>
													<RotateCcwIcon class="h-5 w-5" aria-hidden="true" />
													<span>Reset view</span>
												</button>
												{#if viewerFeatureNeeds.audio}
													<button
														type="button"
														disabled={!viewerCapabilities.audio}
														title="Audio controls are not exposed by the Voyager Explorer API"
													>
														<Volume2Icon class="h-5 w-5" aria-hidden="true" />
														<span>Audio · API unavailable</span>
													</button>
												{/if}

												{#if viewerLanguages.length > 1}
													<div class="viewer-language-options">
														<span>Language</span>
														<div>
															{#each viewerLanguages as language (language)}
																<button
																	type="button"
																	class:active={language === activeViewerLanguage}
																	onclick={(event) => setViewerLanguage(language, event)}
																>
																	<LanguagesIcon class="h-4 w-4" aria-hidden="true" />
																	{language.toUpperCase()}
																</button>
															{/each}
														</div>
													</div>
												{/if}
											</div>
										</details>
									</div>
								{/if}
							</div>

							{#if useDirectMode && !isFullWindow && sceneContent && (sceneContent.tours.length || sceneContent.annotations.length)}
								<div class="viewer-card-footer mt-3 rounded-md bg-base-200 p-3">
									{#if sceneContent.tours.length}
										{@const tour = sceneContent.tours[activeTour.tourIndex]}
										<div class="tour-navigator" aria-label="Guided tour">
											<label>
												<span class="section-label"
													><MapIcon class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Guided tour</span
												>
												<select
													value={activeTour.tourIndex}
													onchange={(event) => {
														const tourIndex = Number(event.currentTarget.value);
														if (tourIndex < 0) exitTour();
														else selectTourStep(tourIndex, 0);
													}}
												>
													<option value={-1}>Explore freely</option>
													{#each sceneContent.tours as item, index (item.sourceIndex)}
														<option value={index}
															>{localizedValue(
																item,
																'title',
																'titles',
																activeViewerLanguage
															)}</option
														>
													{/each}
												</select>
											</label>
											{#if activeTour.tourIndex >= 0 && tour?.steps.length}
												<div class="tour-actions">
													<button
														type="button"
														onclick={() =>
															selectTourStep(activeTour.tourIndex, activeTour.stepIndex - 1)}
														disabled={activeTour.stepIndex <= 0}
														aria-label="Previous tour step">‹</button
													>
													<span>{activeTour.stepIndex + 1} / {tour.steps.length}</span>
													<span class="tour-step-title"
														>{localizedValue(
															tour.steps[activeTour.stepIndex],
															'title',
															'titles',
															activeViewerLanguage
														)}</span
													>
													<button
														type="button"
														onclick={() =>
															selectTourStep(activeTour.tourIndex, activeTour.stepIndex + 1)}
														disabled={activeTour.stepIndex >= tour.steps.length - 1}
														aria-label="Next tour step">›</button
													>
													<button type="button" class="tour-exit" onclick={exitTour}
														>Exit tour</button
													>
												</div>
											{/if}
										</div>
									{/if}
									{#if sceneContent.annotations.length}
										<div
											class="viewer-card-details"
											class:with-tour={sceneContent.tours.length > 0}
										>
											<EditionAnnotations
												annotations={sceneContent.annotations}
												language={activeViewerLanguage}
												activeCategories={activeAnnotationCategories}
												onCategories={selectCategories}
												onAnnotation={selectAnnotation}
											/>
										</div>
									{/if}
								</div>
							{/if}

							{#if useDirectMode && isFullWindow && sceneContent}
								<aside class="fullwindow-reading" aria-label="Edition reading">
									{#if viewerLanguages.length > 1}
										<div class="edition-language">
											<select
												aria-label="Edition language"
												value={activeViewerLanguage}
												onchange={(event) => setViewerLanguage(event.currentTarget.value)}
												>{#each viewerLanguages as language (language)}<option value={language}
														>{language}</option
													>{/each}</select
											>
										</div>
									{/if}
									{#if sceneContent.tours.length}
										{@const tour = sceneContent.tours[activeTour.tourIndex]}
										<div class="tour-navigator">
											<label>
												<span class="section-label"
													><MapIcon class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Guided tour</span
												>
												<select
													value={activeTour.tourIndex}
													onchange={(event) => {
														const tourIndex = Number(event.currentTarget.value);
														if (tourIndex < 0) exitTour();
														else selectTourStep(tourIndex, 0);
													}}
												>
													<option value={-1}>Explore freely</option>
													{#each sceneContent.tours as item, index (item.sourceIndex)}
														<option value={index}
															>{localizedValue(
																item,
																'title',
																'titles',
																activeViewerLanguage
															)}</option
														>
													{/each}
												</select>
											</label>
											{#if activeTour.tourIndex >= 0 && tour?.steps.length}
												<div class="tour-actions">
													<button
														type="button"
														onclick={() =>
															selectTourStep(activeTour.tourIndex, activeTour.stepIndex - 1)}
														disabled={activeTour.stepIndex <= 0}
														aria-label="Previous tour step">‹</button
													>
													<span>{activeTour.stepIndex + 1} / {tour.steps.length}</span>
													<button
														type="button"
														onclick={() =>
															selectTourStep(activeTour.tourIndex, activeTour.stepIndex + 1)}
														disabled={activeTour.stepIndex >= tour.steps.length - 1}
														aria-label="Next tour step">›</button
													>
													<button type="button" class="tour-exit" onclick={exitTour}>Exit</button>
												</div>
											{/if}
										</div>
									{/if}
									{#if sceneContent.articles.length}
										<EditionStories
											articles={sceneContent.articles}
											editionId={edition.id}
											language={activeViewerLanguage}
											root={edition.voyagerRoot || ''}
											activeArticleId={selectedStoryId}
											linkedArticleId={linkedTourArticleId}
											onArticle={selectStory}
										/>
									{/if}
									{#if sceneContent.annotations.length}
										<details class="fullwindow-annotations">
											<summary>Explore details</summary>
											<EditionAnnotations
												annotations={sceneContent.annotations}
												language={activeViewerLanguage}
												activeCategories={activeAnnotationCategories}
												onCategories={selectCategories}
												onAnnotation={selectAnnotation}
											/>
										</details>
									{/if}
								</aside>
							{/if}
						{/if}
					{/key}
				</div>
			</div>

			<!-- Right Column - Tabs and Content -->
			{#if !isFullWindow}
				<div
					class="shrink-0 transition-all duration-300 ease-in-out"
					class:lg:w-96={!isSidebarCollapsed}
					class:lg:w-12={isSidebarCollapsed}
				>
					<div bind:this={readingPanel} class="scroll-mt-24 lg:sticky lg:top-24">
						{#if isSidebarCollapsed}
							<button
								type="button"
								class="ds-card-frame hidden h-12 w-12 items-center justify-center lg:flex"
								onclick={toggleSidebar}
								aria-label="Show edition details"
								title="Show edition details"
							>
								<PanelRightOpenIcon class="h-4 w-4" aria-hidden="true" />
							</button>
						{/if}
						<div
							class="ds-card-frame w-full p-3 transition-all duration-300 lg:w-96"
							class:lg:hidden={isSidebarCollapsed}
						>
							<div class="overflow-hidden rounded-lg bg-base-200">
								{#if useExperimentalLayout}
									<div class="edition-reading-tabs">
										<button
											type="button"
											class="sidebar-close hidden lg:flex"
											onclick={toggleSidebar}
											aria-label="Hide edition details"
											title="Hide edition details"
										>
											<PanelRightCloseIcon class="h-4 w-4" aria-hidden="true" />
										</button>
										<div class="reading-tabs" role="tablist" aria-label="Edition reading">
											<button
												role="tab"
												id="reading-tab-overview"
												aria-controls="reading-content"
												tabindex={readingTab === 'overview' ? 0 : -1}
												onkeydown={handleReadingTabKey}
												aria-selected={readingTab === 'overview'}
												onclick={() => (readingTab = 'overview')}
											>
												<InfoIcon class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Overview
											</button>
											{#if useDirectMode && sceneContent?.articles.length}
												<button
													role="tab"
													id="reading-tab-stories"
													aria-controls="reading-content"
													tabindex={readingTab === 'stories' ? 0 : -1}
													onkeydown={handleReadingTabKey}
													aria-selected={readingTab === 'stories'}
													onclick={() => (readingTab = 'stories')}
												>
													<BookOpenIcon class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Stories
													<span>{sceneContent.articles.length}</span>
												</button>
											{/if}
											<button
												role="tab"
												id="reading-tab-details"
												aria-controls="reading-content"
												tabindex={readingTab === 'details' ? 0 : -1}
												onkeydown={handleReadingTabKey}
												aria-selected={readingTab === 'details'}
												onclick={() => (readingTab = 'details')}
											>
												<FileTextIcon class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Edition
												details
											</button>
										</div>
									</div>
								{:else}
									<!-- Original edition record header and tabs: aedd633, 2026-09-09. -->
									<div
										class="flex min-h-11 items-center justify-between gap-3 bg-base-100 px-3 py-2"
									>
										<span
											class="font-mono text-[9px] tracking-[0.12em] text-base-content/45 uppercase"
											>Edition record</span
										>
										<button
											type="button"
											class="hidden h-8 w-8 items-center justify-center rounded-md text-base-content/50 transition-colors hover:bg-base-200 hover:text-base-content lg:flex"
											onclick={toggleSidebar}
											aria-label="Hide edition details"
											title="Hide edition details"
											><PanelRightCloseIcon class="h-4 w-4" aria-hidden="true" /></button
										>
									</div>
									<div
										role="tablist"
										aria-label="Edition record"
										class="scrollbar-hide flex overflow-x-auto border-b border-base-300 bg-base-100 px-2"
									>
										{#each originalTabs.filter((tab) => tab.id !== 'versions' || siblingEditions.length > 0) as tab (tab.id)}
											<button
												type="button"
												role="tab"
												id="original-tab-{tab.id}"
												aria-controls="reading-content"
												aria-selected={originalTab === tab.id}
												tabindex={originalTab === tab.id ? 0 : -1}
												onkeydown={handleReadingTabKey}
												class="min-h-11 shrink-0 grow border-b-2 px-3 text-xs whitespace-nowrap transition-colors {originalTab ===
												tab.id
													? 'border-accent text-base-content'
													: 'border-transparent text-base-content/50 hover:text-base-content'}"
												onclick={() => selectOriginalTab(tab.id)}>{tab.label}</button
											>
										{/each}
									</div>
								{/if}

								<div
									id="reading-content"
									role="tabpanel"
									aria-labelledby={useExperimentalLayout
										? `reading-tab-${readingTab}`
										: `original-tab-${originalTab}`}
									class="prose prose-sm max-h-[75vh] max-w-none overflow-y-auto p-5"
								>
									{#if useExperimentalLayout && viewerLanguages.length > 1}
										<div class="edition-language not-prose">
											<label
												>Language <select
													aria-label="Edition language"
													value={activeViewerLanguage}
													onchange={(event) => setViewerLanguage(event.currentTarget.value)}
													>{#each viewerLanguages as language (language)}<option value={language}
															>{language}</option
														>{/each}</select
												></label
											>
										</div>
									{/if}
									{#if sceneError}
										<div
											class="not-prose mb-4 space-y-3 rounded-lg border border-dashed border-base-300 p-3 text-sm"
										>
											<p>{sceneError}</p>
											<button
												type="button"
												class="btn btn-outline btn-sm"
												onclick={() => (sceneReload += 1)}
											>
												Retry edition content
											</button>
										</div>
									{/if}
									{#if readingTab === 'overview'}
										{#if useExperimentalLayout}
											<div class="leading-relaxed text-base-content/80">
												{#each descriptionSegments as segment, index (index)}
													{#if segment.type === 'text'}
														<ContentRenderer className="contents" content={segment.content} />
													{:else if segment.type === 'view-link'}
														<button
															type="button"
															class="link cursor-pointer font-semibold link-primary hover:link-secondary"
															onclick={() => handleViewClick(segment.viewName || '')}
															title="Click to change view"
														>
															{segment.content}
														</button>
													{/if}
												{/each}
											</div>
										{:else}
											<p class="leading-relaxed text-base-content/80">
												{#each descriptionSegments as segment, index (index)}
													{#if segment.type === 'text'}{segment.content}{:else}
														<button
															type="button"
															class="link cursor-pointer font-semibold link-primary hover:link-secondary"
															onclick={() => handleViewClick(segment.viewName || '')}
															title="Click to change view">{segment.content}</button
														>
													{/if}
												{/each}
											</p>
										{/if}

										<!-- Tags -->
										<div class="mt-6">
											<h3 class="mb-2 text-sm font-semibold">Tags</h3>
											<div class="flex flex-wrap gap-2">
												{#each edition.tags as tag (tag)}
													<span class="badge border badge-ghost border-base-300">{tag}</span>
												{/each}
											</div>
										</div>

										<!-- Links Section (Orange boxes from wireframe) -->
										<div class="not-prose mt-6">
											<h3 class="mb-3 text-sm font-semibold">Links to scene (deeplink)</h3>
											<div class="space-y-2">
												<div class="">
													<span class="text-sm opacity-80">
														(Voyager API id to the step/scene) add it to the url for sharing and
														cite.
													</span>
												</div>
											</div>
										</div>
									{:else if useExperimentalLayout && readingTab === 'stories' && sceneContent}
										<EditionStories
											articles={sceneContent.articles}
											editionId={edition.id}
											language={activeViewerLanguage}
											root={edition.voyagerRoot || ''}
											activeArticleId={selectedStoryId}
											linkedArticleId={linkedTourArticleId}
											onArticle={selectStory}
										/>
									{:else}
										{#if useExperimentalLayout}
											<label class="details-select">
												<span>View</span>
												<select bind:value={detailsTab}>
													<option value="metadata">Metadata</option>
													<option value="peer-review">Peer Review</option>
												</select>
											</label>
										{/if}
										{#if detailsTab === 'metadata'}
											<EditionMetadata
												edition={{ ...edition, credits }}
												{loadedModelSize}
												{primaryDoi}
												{citationCopied}
												{citationText}
												oncopydoi={copyDoi}
											/>
										{:else if detailsTab === 'peer-review'}
											{#if edition.isPublished}<FinalReviewProgress
													editionId={edition.id}
													publicView
												/>{/if}
											{#if edition.hasPeerReview}
												<div class="not-prose space-y-6">
													<!-- Peer Reviewed Badge -->
													<div class="flex justify-center">
														<img
															src="{base}/images/peer-reviewed-badge.svg"
															alt="PURE 3D Peer Reviewed"
															class="h-24 w-24"
														/>
													</div>

													<!-- Review Type -->
													{#if edition.peerReviewKind}
														<div class="rounded-lg bg-base-300 p-4">
															<h3 class="mb-2 text-base font-bold">
																Peer review ({edition.peerReviewKind})
															</h3>
															<!-- Review Content -->
															{#if edition.peerReviewContent}
																<div class="prose prose-sm max-w-none text-base-content/80">
																	<ContentRenderer
																		className="contents"
																		content={formattedPeerReview}
																	/>
																</div>
															{/if}
														</div>
													{/if}
												</div>

												<!-- Detailed feedback items -->
												{#if demoReviewFeedback.length > 0}
													<div class="mt-4">
														<h3 class="mb-2 text-sm font-semibold">Detailed Feedback</h3>
														<div class="not-prose space-y-2">
															{#each demoReviewFeedback as item (item.id)}
																<div class="rounded-lg border border-base-300 p-3">
																	<div class="flex flex-wrap items-center gap-2">
																		<span class="badge badge-sm capitalize badge-info"
																			>{item.category}</span
																		>
																		<span class="text-xs font-medium text-base-content/60"
																			>{item.targetLabel}</span
																		>
																		<span class="ml-auto text-xs text-base-content/40">
																			{item.reviewer} · {formatDate(item.created)}
																		</span>
																	</div>
																	<p class="mt-1 text-sm">{item.comment}</p>
																	{#if item.resolved}
																		<span class="mt-2 badge inline-block badge-sm badge-success"
																			>Resolved</span
																		>
																	{/if}
																</div>
															{/each}
														</div>
													</div>
												{:else if edition.id}
													<div class="mt-4">
														<h3 class="mb-2 text-sm font-semibold">Detailed Feedback</h3>
														<ReviewFeedbackList editionId={edition.id} />
													</div>
												{/if}
											{:else}
												<div
													class="not-prose rounded-lg border border-dashed border-base-300 bg-base-100 p-5 text-sm"
												>
													<div class="mb-2 flex items-center gap-2">
														<span class="badge badge-outline badge-sm">Status</span>
														<h3 class="font-semibold">
															{edition.peerReviewRequested
																? 'Peer review requested'
																: 'Not peer reviewed yet'}
														</h3>
													</div>
													<p class="text-base-content/70">
														{#if edition.peerReviewRequested}
															This edition is marked for peer review. Review details and feedback
															will appear here when they are available.
														{:else}
															Peer review is an optional trust signal for Pure 3D editions. If
															requested for this edition, review information will appear here.
														{/if}
													</p>
													{#if canManagePage && !edition.peerReviewRequested}
														<a
															class="btn mt-4 btn-outline btn-xs"
															href={resolve('/editions/[slug]/workflow', { slug: edition.id })}
														>
															Request peer review
														</a>
													{/if}
												</div>
											{/if}
										{:else if detailsTab === 'printables'}
											{#if printables.length > 0}
												<div class="not-prose space-y-3">
													{#each printables as item (item.title)}
														<article class="rounded-lg border border-base-300 bg-base-100 p-4">
															<div class="flex items-start justify-between gap-3">
																<div>
																	<h3 class="font-semibold">{item.title}</h3>
																	<p class="mt-1 text-sm text-base-content/70">
																		{item.description}
																	</p>
																</div>
																<span class="badge shrink-0 badge-outline">{item.type}</span>
															</div>
															<div class="mt-3 flex items-center justify-between gap-3">
																<p class="text-xs text-base-content/50">{item.size}</p>
																{#if item.url}
																	<SafeLink
																		class="btn btn-outline btn-xs"
																		href={item.url}
																		download={item.filename || true}
																	>
																		Download
																	</SafeLink>
																{/if}
															</div>
														</article>
													{/each}
												</div>
											{:else}
												<div
													class="not-prose rounded-lg border border-dashed border-base-300 bg-base-100 p-5 text-sm"
												>
													<div class="mb-2 flex items-center gap-2">
														<span class="badge badge-outline badge-sm">Not provided</span>
														<h3 class="font-semibold">No printables uploaded</h3>
													</div>
													<p class="text-base-content/70">
														Contributors can upload downloadable worksheets, fabrication files,
														lesson materials, or reference sheets for an edition. None have been
														provided for this edition.
													</p>
													{#if canManagePage}
														<a
															class="btn mt-4 btn-outline btn-xs"
															href={resolve('/editions/[slug]/workflow', { slug: edition.id })}
														>
															Manage edition assets
														</a>
													{/if}
												</div>
											{/if}
										{:else if detailsTab === 'versions'}
											<div class="space-y-4">
												<!-- Citation Block -->
												<div class="rounded-lg bg-base-300 p-4">
													<h3 class="mb-2 text-sm font-semibold">Citation</h3>
													<div class="text-sm leading-relaxed text-base-content/80">
														{citationText}
													</div>
													<div class="mt-2 flex gap-2">
														<button class="btn btn-xs btn-secondary" onclick={copyCitation}>
															{#if citationCopied}
																Copied!
															{:else}
																Copy citation
															{/if}
														</button>
														{#if primaryDoi}
															<button class="btn btn-ghost btn-xs" onclick={copyDoi}>
																Copy DOI
															</button>
														{/if}
													</div>
												</div>

												<!-- Diff / Changelog -->
												{#if changelog.length > 0}
													<div class="rounded-lg bg-base-300 p-4">
														<h3 class="mb-2 text-sm font-semibold">
															Changes from previous edition
														</h3>
														<div class="space-y-1">
															{#each changelog as change, index (index)}
																<div
																	class="flex items-start gap-2 rounded px-2 py-1 text-xs {change.type ===
																	'add'
																		? 'bg-success/10'
																		: change.type === 'mod'
																			? 'bg-warning/10'
																			: 'bg-error/10'}"
																>
																	<span
																		class="mt-px font-mono font-bold {change.type === 'add'
																			? 'text-success'
																			: change.type === 'mod'
																				? 'text-warning'
																				: 'text-error'}"
																	>
																		{change.type === 'add'
																			? '+'
																			: change.type === 'mod'
																				? '~'
																				: '−'}
																	</span>
																	<span>{change.text}</span>
																</div>
															{/each}
														</div>
													</div>
												{/if}

												<!-- Version History Timeline -->
												<div>
													<h3 class="mb-3 text-sm font-semibold">Version History</h3>
													<div class="space-y-0">
														<!-- Current edition -->
														<article class="flex gap-3 rounded-lg bg-success/5 p-3">
															<div class="flex flex-col items-center">
																<div class="h-3 w-3 rounded-full bg-success"></div>
																<div class="w-px flex-1 bg-base-300"></div>
															</div>
															<div class="flex-1 pb-2">
																<div class="flex items-center gap-2">
																	<span class="font-mono text-xs font-semibold"
																		>Ed. {String(edition.pubNum || 1).padStart(2, '0')}</span
																	>
																	<span class="badge badge-xs badge-success">Current</span>
																</div>
																<div class="text-sm font-medium">{edition.title}</div>
																{#if primaryDoi}
																	<div class="font-mono text-[10px] text-base-content/50">
																		{primaryDoi}
																	</div>
																{/if}
															</div>
														</article>
														<!-- Sibling editions (version history) -->
														{#each siblingEditions as sibling (sibling.id)}
															<article
																class="flex gap-3 rounded-lg p-3 transition-colors hover:bg-base-300/50"
															>
																<div class="flex flex-col items-center">
																	<div class="h-2.5 w-2.5 rounded-full bg-base-content/30"></div>
																	<div class="w-px flex-1 bg-base-300"></div>
																</div>
																<a
																	href={resolve('/editions/[slug]', { slug: sibling.slug })}
																	data-sveltekit-preload-data="hover"
																	class="flex-1 pb-2 no-underline"
																>
																	<div class="flex items-center gap-2">
																		<span class="font-mono text-xs font-semibold"
																			>Ed. {String(sibling.pubNum).padStart(2, '0')}</span
																		>
																		{#if sibling.status}
																			<span class="badge badge-ghost badge-xs"
																				>{sibling.status}</span
																			>
																		{/if}
																	</div>
																	<div
																		class="text-sm font-medium text-base-content/80 transition-colors hover:text-primary"
																	>
																		{sibling.title}
																	</div>
																	{#if sibling.dcDoi?.length}
																		<div class="font-mono text-[10px] text-base-content/50">
																			{sibling.dcDoi[0]}
																		</div>
																	{/if}
																	{#if sibling.modelSize}
																		<div class="text-[10px] text-base-content/50">
																			{sibling.modelSize}
																		</div>
																	{/if}
																</a>
															</article>
														{/each}
													</div>
												</div>
											</div>
										{/if}
									{/if}
								</div>
							</div>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- Viewer Help Modal -->
	{#if viewerHelp || viewerHelpVideoUrl}
		<dialog class="modal" class:modal-open={helpModalOpen}>
			<div class="modal-box max-w-2xl">
				<h3 class="mb-4 text-lg font-bold">How to use the 3D Viewer</h3>

				<!-- Video embed -->
				{#if embedVideoUrl}
					<div class="mb-4 aspect-video w-full">
						<iframe
							src={embedVideoUrl}
							title="3D Viewer Tutorial"
							class="h-full w-full rounded-lg"
							frameborder="0"
							allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
							allowfullscreen
						></iframe>
					</div>
				{/if}

				<!-- Text content -->
				{#if viewerHelp}
					<div class="prose prose-sm max-w-none">
						<ContentRenderer className="contents" content={viewerHelp} />
					</div>
				{/if}

				<div class="modal-action">
					<button type="button" class="btn" onclick={() => (helpModalOpen = false)}>Close</button>
				</div>
			</div>
			<form method="dialog" class="modal-backdrop">
				<button type="button" onclick={() => (helpModalOpen = false)}>close</button>
			</form>
		</dialog>
	{/if}

	<!-- Imagine AI Modal -->
	<ImagineModal
		bind:open={imagineModalOpen}
		edition={{
			...edition,
			dcCoveragePeriod:
				typeof edition.dcCoveragePeriod === 'string'
					? [edition.dcCoveragePeriod]
					: (edition.dcCoveragePeriod ?? [])
		}}
		onclose={() => (imagineModalOpen = false)}
	/>
</div>

<style>
	.edition-viewer-switch {
		border: 0;
		padding: 0;
		font-size: 0.75rem;
	}
	.edition-viewer-switch [role='group'] {
		display: flex;
		padding: 0.1875rem;
		gap: 0.1875rem;
		border: 1px solid var(--color-base-300);
		border-radius: 0.5rem;
	}
	.edition-viewer-switch button {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		min-height: 2rem;
		padding: 0.25rem 0.625rem;
		border-radius: 0.3125rem;
		cursor: pointer;
	}
	.edition-viewer-switch button[aria-pressed='true'] {
		background: var(--color-base-200);
		font-weight: 600;
	}
	.edition-viewer-switch button:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}
	.scrollbar-hide {
		scrollbar-width: none;
	}
	.scrollbar-hide::-webkit-scrollbar {
		display: none;
	}
	.section-label {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}
	.viewer-card-footer > .tour-navigator {
		padding: 0 0.25rem;
	}

	.viewer-card-details.with-tour {
		margin-top: 1rem;
		border-top: 1px solid var(--color-base-300);
		padding-top: 1rem;
	}

	.edition-language {
		display: flex;
		justify-content: flex-end;
		margin-bottom: 0.75rem;
		font-size: 0.75rem;
	}
	.edition-language select {
		border: 1px solid var(--color-base-300);
		border-radius: 0.375rem;
		padding: 0.375rem;
		background: var(--color-base-100);
	}
	/* Full window mode for the 3D viewer */
	.full-window-viewer {
		position: fixed !important;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 80; /* Keep fullscreen controls above the site header. */
		border-radius: 0 !important;
		border: 0 !important;
		padding: 0 !important;
		background: #000 !important;
		box-shadow: none !important;
		margin: 0 !important;
		max-height: none !important;
		height: auto !important;
	}

	.full-window-viewer > div {
		height: 100%;
		border-radius: 0 !important;
	}

	.fullwindow-reading {
		position: absolute;
		top: 4.25rem;
		right: 0.75rem;
		z-index: 21;
		width: min(22rem, calc(100% - 1.5rem));
		max-height: calc(100% - 5rem);
		overflow-y: auto;
		border: 1px solid rgb(255 255 255 / 16%);
		border-radius: 0.75rem;
		background: rgb(8 14 17 / 78%);
		box-shadow: 0 1rem 2.5rem rgb(0 0 0 / 32%);
		backdrop-filter: blur(18px) saturate(165%);
		color: white;
	}

	.fullwindow-reading :global(#edition-stories) {
		padding: 0.75rem;
	}

	.fullwindow-reading :global(#edition-annotations) {
		padding: 0.75rem;
	}

	.fullwindow-annotations {
		border-top: 1px solid rgb(255 255 255 / 16%);
	}

	.fullwindow-annotations summary {
		cursor: pointer;
		padding: 0.75rem;
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.tour-navigator {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.75rem 0.5rem 0.25rem;
		font-size: 0.75rem;
	}

	.tour-navigator label {
		display: grid;
		min-width: 0;
		gap: 0.125rem;
	}

	.tour-navigator label span,
	.details-select > span {
		font-family: var(--font-mono);
		font-size: 0.5625rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: color-mix(in oklch, var(--color-base-content) 52%, transparent);
	}

	.tour-navigator select,
	.details-select select {
		min-width: 0;
		max-width: 100%;
		border: 0;
		background: transparent;
		font-size: 0.75rem;
		font-weight: 600;
	}

	.tour-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.tour-actions button {
		min-width: 1.875rem;
		height: 1.875rem;
		border: 1px solid var(--color-base-300);
		border-radius: 0.375rem;
		font-size: 1.125rem;
	}

	.tour-actions button:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}
	.tour-actions .tour-exit {
		min-width: auto;
		padding: 0 0.5rem;
		font-size: 0.6875rem;
	}

	.edition-reading-tabs {
		display: flex;
		align-items: stretch;
		border-bottom: 1px solid var(--color-base-300);
		background: var(--color-base-100);
	}

	.reading-tabs {
		display: flex;
		flex: 1;
		min-width: 0;
		overflow-x: auto;
	}

	.edition-reading-tabs button:focus-visible,
	.tour-actions button:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: -2px;
	}

	@media (max-width: 640px) {
		.tour-navigator {
			flex-wrap: wrap;
		}
		.tour-navigator label {
			width: 100%;
		}
		.tour-actions {
			margin-left: auto;
		}
	}

	.edition-reading-tabs button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		min-height: 2.75rem;
		flex: 1;
		border-bottom: 2px solid transparent;
		padding: 0 0.625rem;
		font-size: 0.75rem;
		white-space: nowrap;
		color: color-mix(in oklch, var(--color-base-content) 58%, transparent);
	}

	.edition-reading-tabs button[aria-selected='true'] {
		border-color: var(--color-accent);
		color: var(--color-base-content);
	}

	.edition-reading-tabs button span {
		margin-left: 0.2rem;
		font-size: 0.625rem;
		opacity: 0.65;
	}

	.edition-reading-tabs .sidebar-close {
		flex: 0 0 2rem;
		padding: 0;
	}

	.details-select {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--color-base-300);
	}

	.viewer-glass-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		min-height: 2.5rem;
		padding: 0 0.8rem;
		border: 1px solid rgb(255 255 255 / 16%);
		border-radius: 0.75rem;
		background:
			linear-gradient(145deg, rgb(255 255 255 / 13%), rgb(255 255 255 / 3%)), rgb(10 17 20 / 30%);
		box-shadow:
			0 0.5rem 1.5rem rgb(0 0 0 / 22%),
			inset 0 1px 0 rgb(255 255 255 / 28%),
			inset 0 -1px 0 rgb(0 0 0 / 18%);
		-webkit-backdrop-filter: blur(14px) saturate(165%);
		backdrop-filter: blur(14px) saturate(165%);
		color: white;
		font-size: 0.75rem;
		font-weight: 600;
		transition:
			border-color 160ms ease,
			background 160ms ease,
			transform 160ms ease;
	}

	.viewer-glass-action:hover,
	.viewer-glass-action:focus-visible {
		border-color: rgb(130 170 140 / 75%);
		background: rgb(35 63 48 / 88%);
		outline: none;
		transform: translateY(-1px);
	}

	.viewer-glass-action-icon {
		width: 2.5rem;
		padding: 0;
	}

	.viewer-command-bar {
		position: absolute;
		top: 50%;
		left: 0.75rem;
		z-index: 20;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		width: 3.25rem;
		max-height: calc(100% - 1.5rem);
		padding: 0.25rem;
		border: 1px solid rgb(255 255 255 / 16%);
		border-radius: 1.1rem;
		background:
			linear-gradient(145deg, rgb(255 255 255 / 13%), rgb(255 255 255 / 3%) 52%), rgb(8 14 17 / 30%);
		box-shadow:
			0 0.75rem 2rem rgb(0 0 0 / 28%),
			inset 0 1px 0 rgb(255 255 255 / 14%),
			inset 0 -1px 0 rgb(0 0 0 / 22%);
		-webkit-backdrop-filter: blur(14px) saturate(165%);
		backdrop-filter: blur(14px) saturate(165%);
		transform: translateY(-50%);
		animation: viewer-command-in 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	.viewer-command-item {
		position: relative;
		display: flex;
		flex: 0 0 2.75rem;
		min-width: 0;
		width: 2.75rem;
		min-height: 2.75rem;
		align-items: center;
		justify-content: center;
		padding: 0;
		border-radius: 0.85rem;
		color: rgb(255 255 255 / 82%);
		transition:
			background 160ms ease,
			color 160ms ease;
	}

	.viewer-command-label {
		position: absolute;
		top: 50%;
		left: calc(100% + 0.7rem);
		z-index: 30;
		width: max-content;
		max-width: 12rem;
		padding: 0.42rem 0.6rem;
		border: 1px solid rgb(255 255 255 / 14%);
		border-radius: 0.6rem;
		background: rgb(8 14 17 / 66%);
		box-shadow:
			0 0.5rem 1.25rem rgb(0 0 0 / 26%),
			inset 0 1px 0 rgb(255 255 255 / 18%);
		-webkit-backdrop-filter: blur(12px) saturate(160%);
		backdrop-filter: blur(12px) saturate(160%);
		color: white;
		font-size: 0.6875rem;
		font-weight: 550;
		line-height: 1;
		opacity: 0;
		pointer-events: none;
		transform: translate(-0.2rem, -50%) scale(0.96);
		transform-origin: left center;
		transition:
			opacity 130ms ease,
			transform 130ms ease;
	}

	.viewer-command-item:hover > .viewer-command-label,
	.viewer-command-item:focus-visible > .viewer-command-label {
		opacity: 1;
		transform: translate(0, -50%) scale(1);
	}

	.viewer-more[open] > .viewer-command-item > .viewer-command-label {
		opacity: 0;
	}

	.viewer-command-item:hover,
	.viewer-command-item:focus-visible,
	.viewer-more[open] > .viewer-command-item {
		background: linear-gradient(145deg, rgb(104 154 119 / 58%), rgb(45 84 60 / 44%));
		box-shadow: inset 0 1px 0 rgb(255 255 255 / 22%);
		color: white;
		outline: none;
	}

	.viewer-command-item:disabled,
	.viewer-command-item:disabled:hover {
		cursor: not-allowed;
		background: transparent;
		color: rgb(255 255 255 / 28%);
		filter: grayscale(1);
	}

	.viewer-more {
		position: relative;
		display: flex;
		flex: 0 0 2.75rem;
		min-width: 0;
	}

	.viewer-more > .viewer-command-item {
		flex: 1;
	}

	.viewer-more > summary {
		width: 100%;
		list-style: none;
		cursor: pointer;
	}

	.viewer-more > summary::-webkit-details-marker {
		display: none;
	}

	.viewer-more-menu {
		position: absolute;
		bottom: 0;
		left: calc(100% + 0.75rem);
		display: grid;
		width: 12rem;
		padding: 0.45rem;
		border: 1px solid rgb(255 255 255 / 16%);
		border-radius: 0.9rem;
		background:
			linear-gradient(145deg, rgb(255 255 255 / 13%), rgb(255 255 255 / 3%)), rgb(8 14 17 / 52%);
		box-shadow:
			0 1rem 2.5rem rgb(0 0 0 / 32%),
			inset 0 1px 0 rgb(255 255 255 / 12%);
		-webkit-backdrop-filter: blur(18px) saturate(165%);
		backdrop-filter: blur(18px) saturate(165%);
		color: white;
		transform-origin: left bottom;
		animation: viewer-menu-in 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	@keyframes viewer-command-in {
		from {
			opacity: 0;
			transform: translate(-0.4rem, -50%) scale(0.98);
		}
	}

	@keyframes viewer-menu-in {
		from {
			opacity: 0;
			transform: translateX(-0.35rem) scale(0.98);
		}
	}

	.viewer-more-menu > button {
		display: flex;
		min-height: 2.65rem;
		align-items: center;
		gap: 0.65rem;
		padding: 0 0.7rem;
		border-radius: 0.6rem;
		font-size: 0.78rem;
		font-weight: 550;
	}

	.viewer-more-menu > button:hover,
	.viewer-more-menu > button:focus-visible {
		background: rgb(61 101 74 / 78%);
		outline: none;
	}

	.viewer-more-menu > button:disabled,
	.viewer-more-menu > button:disabled:hover {
		cursor: not-allowed;
		background: transparent;
		color: rgb(255 255 255 / 30%);
		filter: grayscale(1);
	}

	.viewer-language-options {
		margin-top: 0.35rem;
		padding: 0.65rem 0.7rem 0.3rem;
		border-top: 1px solid rgb(255 255 255 / 12%);
		font-size: 0.65rem;
		color: rgb(255 255 255 / 58%);
	}

	.viewer-language-options > div {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-top: 0.45rem;
	}

	.viewer-language-options button {
		display: inline-flex;
		min-height: 1.9rem;
		align-items: center;
		gap: 0.25rem;
		padding: 0 0.45rem;
		border-radius: 0.45rem;
		background: rgb(255 255 255 / 7%);
		color: white;
	}

	.viewer-language-options button:hover,
	.viewer-language-options button:focus-visible,
	.viewer-language-options button.active {
		background: rgb(61 101 74 / 78%);
		outline: none;
	}

	@media (max-width: 480px) {
		.viewer-glass-action {
			width: 2.35rem;
			min-height: 2.35rem;
			padding: 0;
		}

		.viewer-command-bar {
			left: 0.5rem;
		}

		.viewer-more-menu {
			width: min(12rem, calc(100vw - 5rem));
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.viewer-command-bar,
		.viewer-more-menu {
			animation: none;
		}
	}

	.full-window-viewer :global(.voyager-viewer-shell),
	.full-window-viewer :global(.voyager-container),
	.full-window-viewer :global(voyager-explorer),
	.full-window-viewer :global(iframe) {
		height: 100% !important;
		max-height: none !important;
		aspect-ratio: unset !important;
	}

	/* Hide body scrollbar in fullscreen mode */
	:global(body:has(.full-window-viewer)) {
		overflow: hidden !important;
	}
</style>
