<script lang="ts">
	/**
	 * VoyagerViewer Component
	 *
	 * This component provides two modes for displaying Voyager 3D content:
	 *
	 * 1. IFRAME MODE (default): Uses Smithsonian's hosted Voyager
	 *    - Simple embedding via iframe
	 *    - No programmatic control (cross-origin restrictions)
	 *    - Best for displaying Smithsonian collection items
	 *
	 * 2. DIRECT MODE: Embeds Voyager component directly
	 *    - Full API access for programmatic control
	 *    - Requires self-hosted or CORS-enabled content
	 *    - Enables camera control, annotation management, etc.
	 */

	import { onMount, tick } from 'svelte';
	import { mountAnimationControls } from '../../../../static/voyager/animation-controls.js';
	import type { AnimationApplication } from '../../../../static/voyager/animation-controls.js';
	import { SvelteSet, SvelteURLSearchParams } from 'svelte/reactivity';
	import { installViewerFetch } from './viewer-fetch';
	import {
		ViewerResources,
		captureViewerErrors,
		retainCanvasCapture,
		ensureViewerScript,
		repairLegacyAudioLoading,
		type VoyagerAudioReader
	} from './viewer-resources';
	import type { VoyagerElement, VoyagerItem, VoyagerTour } from './viewer-runtime';
	import { base } from '$app/paths';
	import toast from 'svelte-french-toast';
	import FloatingSelect from '$lib/components/ui/FloatingSelect.svelte';
	import { parseAnnotationCategories } from './edition-content';
	import { DEFAULT_VOYAGER_VERSION, getVoyagerResourceRoot } from '$lib/utils/asset-urls';
	import { isEmptySceneDocument, isRuntimeSceneReady, SceneLoadingTracker } from './scene-loading';

	interface Props {
		/** URL for iframe mode OR root path for direct mode */
		url: string;
		/** Document path (only for direct mode) */
		document?: string;
		/** Model path (direct mode) — loads a glTF/GLB file directly without a scene document. Ignored when `document` is set. */
		model?: string;
		/** Geometry path (direct mode) — loads a raw mesh (OBJ/PLY). Ignored when `document` or `model` is set. */
		geometry?: string;
		/** Fetch overrides — when Voyager fetches one of these URLs, return the provided content instead. Used to serve rewritten scene JSON at a real HTTP URL. */
		fetchOverrides?: Array<{ url: string; content: string; contentType?: string }>;
		/**
		 * Companion asset redirection. When Voyager fetches a URL under `baseDir`, the request's basename
		 * is looked up in `byBasename` (after normalization) and the original fetch is replaced with one
		 * against the mapped URL. Used to serve GLTF/OBJ companion files that PocketBase stores under
		 * normalized names without subdirectories.
		 */
		companionAssets?: { baseDir: string; byBasename: Record<string, string> };
		/** Title for accessibility */
		title: string;
		/** Edition cover shown until the scene and its assets are ready */
		coverUrl?: string | null;
		/** Use direct embedding instead of iframe */
		direct?: boolean;
		/** Show control toolbar (only available in direct mode) */
		showControls?: boolean;
		/** UI mode - controls which UI elements are visible initially (e.g., "none", "none|title", "all") */
		uiMode?: string;
		/** Enable/disable camera controls */
		enableControls?: boolean;
		/** Show/hide interaction prompt */
		showPrompt?: boolean;
		/** Voyager version (e.g., "0.56.2") - determines which Voyager script to load */
		voyagerVersion?: string;
		/** Resource root path for Voyager assets (fonts, css, images, language) */
		resourceRoot?: string;
		/** Callback when model finishes loading, receives total bytes loaded */
		onModelLoaded?: (totalBytes: number) => void;
		/** Whether the viewer is in full window mode */
		isFullWindow?: boolean;
		/** Callback when viewer is ready, provides API methods */
		onReady?: (api: VoyagerAPI) => void;
		/** Callback when scene content becomes available or refreshes */
		onContentChange?: (content: VoyagerContent) => void;
		/** Keep external categories in sync with native tag buttons and tour changes */
		onAnnotationCategoriesChange?: (categories: string[]) => void;
		/** Keep an external article reader in sync with Voyager article selections */
		onActiveArticleChange?: (id: string | null) => void;
		/** Keep an external tour navigator in sync with Voyager tour changes */
		onTourChange?: (tourIndex: number, stepIndex: number) => void;
		/** Hide Voyager's reader, tour, and tag chrome in favour of external content controls */
		externalContent?: boolean;
		/** Callback when Voyager's native annotations, reader, tours, or tools UI changes */
		onPanelVisibilityChange?: (panel: VoyagerPanel | null) => void;
		/** Callback to toggle full-window mode from the embedded editor controls */
		onFullWindowToggle?: () => void;
		/** Height of the viewer (e.g., "500px", "60vh", "100%"). Defaults to aspect-ratio 4/3 with max-height 90dvh */
		height?: string;
		/** Show Voyager's built-in menu (sv-main-menu). Defaults to false (hidden) */
		showVoyagerMenu?: boolean;
		/** Show a Viewer/Editor switch below the Voyager surface */
		showEditorSwitch?: boolean;
		/** URL for Voyager Story editor. Defaults to locally hosted Voyager Story wrapper. */
		editorUrl?: string;
	}

	export interface VoyagerAPI {
		toggleAnnotations: () => void;
		toggleReader: () => void;
		toggleTours: () => void;
		stopTour: () => void;
		toggleTools: () => void;
		toggleMeasurement: () => void;
		enableAR: () => void;
		setLanguage: (code: string) => void;
		getLanguages: () => string[];
		getActiveLanguage: () => string;
		getCapabilities: () => VoyagerCapabilities;
		getFeatureNeeds: () => VoyagerFeatureNeeds;
		resetCamera: () => void;
		resetViewer: () => void;
		getAnnotations: () => VoyagerItem[];
		getArticles: () => VoyagerItem[];
		getTours: () => VoyagerTour[];
		getActiveTags: () => string[];
		setActiveTags: (categories: string[]) => void;
		setActiveAnnotation: (id: string) => void;
		setActiveArticle: (id: string) => void;
		setTourStep: (tourIdx: number, stepIdx: number, interpolate?: boolean) => void;
		/** Set camera orbit position (yaw in degrees, pitch in degrees) */
		setCameraOrbit: (yaw: number, pitch: number) => void;
		/** Set camera offset position */
		setCameraOffset: (x: number, y: number, z: number) => void;
		/** Set camera to a preset view with optional animation */
		setView: (options: {
			yaw?: number;
			pitch?: number;
			offsetX?: number;
			offsetY?: number;
			offsetZ?: number;
			animate?: boolean;
			durationMs?: number;
		}) => void;
	}

	export interface VoyagerContent {
		annotations: unknown[];
		articles: unknown[];
		tours: unknown[];
	}

	export interface VoyagerTourState {
		tourIndex: number;
		stepIndex: number;
	}

	interface RuntimeOutput<T> {
		value: T;
		on?: (event: 'value', listener: () => void, owner: unknown) => void;
		off?: (event: 'value', listener: () => void, owner: unknown) => void;
	}

	interface CategoryViewer extends VoyagerElement {
		application?: {
			system?: {
				components?: {
					get?: (type: string) => {
						audioReader?: VoyagerAudioReader;
						outs?: {
							sceneLoaded?: RuntimeOutput<boolean>;
							sceneContentLoaded?: RuntimeOutput<boolean>;
							assetPath?: RuntimeOutput<string>;
							busy?: RuntimeOutput<boolean>;
						};
					};
				};
			};
		};
		viewer?: {
			node?: {
				setup?: {
					reader?: {
						ins: {
							enabled: { value: boolean; setValue: (value: boolean) => void };
							articleId: { value: string; setValue: (value: string) => void };
						};
					};
					tape?: {
						ins: { visible: { value: boolean } };
					};
					tours?: {
						ins: { enabled: { value: boolean } };
						outs: { tourIndex: { value: number }; stepIndex: { value: number } };
					};
				};
			};
			ins?: {
				activeTags?: { value: unknown };
				annotationsVisible?: { value: boolean };
			};
		};
		setActiveTags?: (tags: string) => void;
		toggleTools?: () => void;
	}

	export type VoyagerPanel = 'annotations' | 'reader' | 'tours' | 'tools';

	export interface VoyagerCapabilities {
		annotations: boolean;
		reader: boolean;
		tours: boolean;
		tools: boolean;
		measurement: boolean;
		ar: boolean;
		reset: boolean;
		audio: false;
	}

	export interface VoyagerFeatureNeeds {
		annotations: boolean;
		reader: boolean;
		tours: boolean;
		tools: true;
		measurement: true;
		ar: true;
		reset: true;
		audio: boolean;
	}

	let {
		url,
		document: documentPath,
		model,
		geometry,
		fetchOverrides,
		companionAssets,
		title,
		coverUrl,
		direct = false,
		showControls = false,
		uiMode = 'none',
		enableControls = true,
		showPrompt = false,
		voyagerVersion = DEFAULT_VOYAGER_VERSION,
		resourceRoot,
		onModelLoaded,
		isFullWindow = false,
		onReady,
		onContentChange,
		onAnnotationCategoriesChange,
		onActiveArticleChange,
		onTourChange,
		externalContent = false,
		onPanelVisibilityChange,
		onFullWindowToggle,
		height,
		showVoyagerMenu = false,
		showEditorSwitch = false,
		editorUrl
	}: Props = $props();

	// Compute the container style based on height prop
	const containerStyle = $derived(
		height ? `height: ${height};` : 'aspect-ratio: 4/3; max-height: 90dvh;'
	);

	let voyagerElement: CategoryViewer | undefined = $state();
	let animationHost: HTMLDivElement;
	let iframeElement: HTMLIFrameElement | undefined = $state();
	let isScriptLoaded = $state(false);
	let iframeLoaded = $state(false);
	let coverImageError = $state(false);
	let hasError = $state(false);
	let errorMessage = $state('');
	let annotations = $state<VoyagerItem[]>([]);
	let articles = $state<VoyagerItem[]>([]);
	let tours = $state<VoyagerTour[]>([]);

	// Loading progress state
	let loadingProgress = $state(0);
	let loadingPhase = $state<'script' | 'document' | 'downloading' | 'preparing' | 'complete'>(
		'script'
	);
	let totalBytes = $state(0);
	let loadedBytes = $state(0);
	let cleanupFetchInterceptor: (() => void) | null = null;
	let chromeObserver: MutationObserver | null = null;
	let toolsVisibilityFrame: number | null = null;
	let lastVisiblePanel: VoyagerPanel | null = null;
	let lastActiveCategories: string | null = null;
	let lastActiveArticleId: string | null = null;
	let disposed = false;
	const resources = new ViewerResources();
	let contentResources: ViewerResources | null = null;
	let lastTourState: VoyagerTourState = { tourIndex: -1, stepIndex: -1 };
	let arAvailable = false;
	let sceneFeatureNeeds = {
		annotations: false,
		reader: false,
		tours: false,
		audio: false
	};
	let sceneLoading = new SceneLoadingTracker();
	let sceneReady = $state(false);
	let firstModelVisible = $state(false);
	let completeScene: (() => Promise<void>) | null = null;
	const unknownDownloadIds = new SvelteSet<number>();
	let emptySceneDocument = false;
	let iframeReadyTimer: ReturnType<typeof setTimeout> | undefined;
	const IFRAME_READY_TIMEOUT_MS = 60_000;

	// Camera orbit state
	let cameraYaw = $state(0);
	let cameraPitch = $state(-25);

	// Camera offset state
	let cameraOffsetX = $state(0);
	let cameraOffsetY = $state(0);
	let cameraOffsetZ = $state(0);
	let cameraAnimationFrame: number | null = null;

	// Language state
	let selectedLanguage = $state('EN');

	// UI visibility toggle
	let showVoyagerUI = $state(false);
	let activeMode = $state<'viewer' | 'editor'>('viewer');
	const resolvedResourceRoot = $derived(resourceRoot || getVoyagerResourceRoot(voyagerVersion));
	const resolvedEditorUrl = $derived.by(() => {
		if (editorUrl) return editorUrl;

		const params = new SvelteURLSearchParams();
		params.set('version', voyagerVersion);
		params.set('root', url);
		params.set('resourceRoot', resolvedResourceRoot);

		if (geometry) {
			params.set('geometry', geometry);
		} else if (model) {
			params.set('model', model);
		} else {
			params.set('document', documentPath || 'scene.svx.json');
		}

		return `${base}/voyager/story.html?${params.toString()}`;
	});

	function installFetchInterceptor() {
		return installViewerFetch(window, {
			root: () => new URL(url, window.location.href).href,
			sceneDocument: () =>
				model || geometry
					? undefined
					: new URL(documentPath || 'scene.svx.json', new URL(url, window.location.href)).href,
			documentLoaded: (source) => {
				emptySceneDocument = isEmptySceneDocument(source);
				const json = JSON.stringify(source);
				sceneFeatureNeeds = {
					annotations: /"annotations"\s*:\s*\[\s*\{/.test(json),
					reader: /"articles"\s*:\s*\[\s*\{/.test(json),
					tours: /"tours"\s*:\s*\[\s*\{/.test(json),
					audio: /"audio"\s*:\s*\[\s*\{/.test(json)
				};
			},
			overrides: () => fetchOverrides,
			companions: () => companionAssets,
			progress: (total, loaded) => {
				if (disposed || loadingPhase === 'complete') return;
				if (loadingPhase === 'document') loadingPhase = 'downloading';
				totalBytes += total;
				loadedBytes += loaded;
				loadingProgress = totalBytes > 0 ? Math.round((loadedBytes / totalBytes) * 100) : 0;
			},
			assetRequest: (event) => {
				if (disposed || sceneReady) return;
				if (event.type === 'start') {
					unknownDownloadIds.add(event.id);
					sceneLoading.downloadStarted();
				} else if (event.type === 'response') {
					if (event.total) {
						unknownDownloadIds.delete(event.id);
					}
				} else {
					unknownDownloadIds.delete(event.id);
					sceneLoading.downloadFinished();
				}
				updateSceneLoadingPhase();
			}
		});
	}

	function initializeViewer() {
		if (disposed) return;
		emptySceneDocument = false;
		sceneLoading = new SceneLoadingTracker();
		isScriptLoaded = true;
		loadingPhase = 'document';
		void tick().then(loadContent);
	}

	const viewerReady = $derived(direct ? sceneReady : iframeLoaded);
	const coverRevealed = $derived(firstModelVisible || viewerReady);
	const downloadPercentage = $derived(
		direct && loadingPhase === 'downloading' && totalBytes > 0 && !unknownDownloadIds.size
			? Math.min(100, Math.max(0, loadingProgress))
			: undefined
	);
	const loadingLabel = $derived(
		firstModelVisible
			? 'Refining details…'
			: loadingPhase === 'downloading'
				? 'Downloading model…'
				: loadingPhase === 'preparing'
					? 'Preparing model…'
					: 'Loading 3D viewer…'
	);

	function waitForIframeScene(startedAt = performance.now()) {
		if (disposed || !iframeElement) return;
		let iframeDocument: Document | null;
		try {
			iframeDocument = iframeElement.contentDocument;
		} catch {
			// Cross-origin iframe runtimes cannot be inspected; the document load is the best signal.
			iframeLoaded = true;
			return;
		}
		if (!iframeDocument) {
			// Browsers expose a null document for cross-origin frames.
			iframeLoaded = true;
			return;
		}
		const runtime = iframeDocument.querySelector('voyager-explorer') as CategoryViewer | null;
		const components = runtime?.application?.system?.components;
		const sceneLoaded = components?.get?.('CVViewer')?.outs?.sceneLoaded?.value;
		if (components?.get?.('CVViewer')?.outs?.sceneContentLoaded?.value === true) {
			firstModelVisible = true;
		}
		const assetsBusy = components?.get?.('CVAssetManager')?.outs?.busy?.value;
		if (sceneLoaded === true && assetsBusy === false) {
			iframeLoaded = true;
			return;
		}
		if (performance.now() - startedAt >= IFRAME_READY_TIMEOUT_MS) {
			handleVoyagerError({ message: 'The 3D scene is taking too long to load.' });
			return;
		}
		iframeReadyTimer = setTimeout(() => waitForIframeScene(startedAt), 200);
	}

	function handleIframeLoad() {
		clearTimeout(iframeReadyTimer);
		hasError = false;
		errorMessage = '';
		iframeLoaded = false;
		firstModelVisible = false;
		waitForIframeScene();
	}

	function updateSceneLoadingPhase() {
		if (disposed || hasError || sceneReady) return;
		if (sceneLoading.phase === 'complete') {
			void completeScene?.();
			return;
		}
		loadingPhase = sceneLoading.phase;
	}

	onMount(() => {
		disposed = false;
		if (direct) {
			// Reset progress state
			loadingProgress = 0;
			totalBytes = 0;
			loadedBytes = 0;
			loadingPhase = 'script';
			sceneLoading = new SceneLoadingTracker();
			sceneReady = false;
			firstModelVisible = false;
			unknownDownloadIds.clear();

			resources.defer(retainCanvasCapture(HTMLCanvasElement.prototype));

			// Install fetch interceptor before loading Voyager
			cleanupFetchInterceptor = installFetchInterceptor();
			resources.defer(() => {
				disposed = true;
				contentResources?.dispose();
				cancelCameraAnimation();
				cleanupChromeObserver();
				cleanupFetchInterceptor?.();
				cleanupFetchInterceptor = null;
			});

			// Compute script URL based on resourceRoot or voyagerVersion
			const scriptUrl = `${resolvedResourceRoot}js/voyager-explorer.min.js`;

			void ensureViewerScript(document, customElements, scriptUrl)
				.then(() => {
					if (disposed) return;
					void initializeViewer();
				})
				.catch(handleVoyagerError);
			return () => resources.dispose();
		}
		return () => {
			disposed = true;
			clearTimeout(iframeReadyTimer);
		};
	});

	function loadContent() {
		if (disposed || !voyagerElement) return;
		contentResources?.dispose();
		const contentScope = new ViewerResources();
		contentResources = contentScope;
		contentScope.defer(() => {
			if (contentResources === contentScope) completeScene = null;
		});
		const audioReader =
			voyagerElement.application?.system?.components?.get?.('CVAssetReader')?.audioReader;
		if (audioReader) {
			contentScope.defer(repairLegacyAudioLoading(audioReader, voyagerVersion));
		}

		// Fix Voyager modal z-index to appear above sticky header (Shadow DOM)
		fixVoyagerModalZIndex();
		observeVoyagerChrome();

		completeScene = async () => {
			if (disposed || contentScope.disposed || sceneReady || hasError) return;
			sceneReady = true;
			hasError = false;
			loadingPhase = 'complete';
			loadingProgress = 100;
			if (animationHost && voyagerElement?.application) {
				const animations = mountAnimationControls(
					voyagerElement.application as AnimationApplication,
					animationHost
				);
				contentScope.defer(() => animations.dispose());
			}

			// Private assets and scene overrides still need their resolver for later requests.
			if (cleanupFetchInterceptor && !fetchOverrides?.length && !companionAssets) {
				cleanupFetchInterceptor();
				cleanupFetchInterceptor = null;
			}

			// Notify parent of total bytes loaded
			if (onModelLoaded && totalBytes > 0) {
				onModelLoaded(totalBytes);
			}

			const ar = await supportsAR();
			if (disposed || contentScope.disposed) return;
			arAvailable = ar;

			// Expose API to parent
			if (onReady) {
				onReady({
					toggleAnnotations,
					toggleReader,
					toggleTours,
					stopTour,
					toggleTools,
					toggleMeasurement,
					enableAR,
					setLanguage,
					getLanguages: () => voyagerElement?.getLanguages?.() ?? [],
					getActiveLanguage: () => voyagerElement?.getActiveLanguage?.() ?? selectedLanguage,
					getCapabilities,
					getFeatureNeeds,
					resetCamera,
					resetViewer,
					getAnnotations: () => annotations,
					getArticles: () => articles,
					getTours: () => tours,
					getActiveTags,
					setActiveTags,
					setActiveAnnotation,
					setActiveArticle,
					setTourStep,
					setCameraOrbit: setCameraOrbitValues,
					setCameraOffset,
					setView
				});
			}
		};

		// Listen for Voyager error events
		contentScope.listen(voyagerElement, 'error', handleVoyagerError);
		contentScope.listen(voyagerElement, 'load-error', handleVoyagerError);
		// Hidden models also emit model-load. They must not uncover an empty viewport.
		contentScope.listen(voyagerElement, 'model-load', () => {
			if (disposed || hasError) return;
			const components = (voyagerElement as CategoryViewer | undefined)?.application?.system
				?.components as
				| {
						getArray?: (type: string) => {
							activeDerivative?: { model?: unknown };
							object3D?: { visible?: boolean };
						}[];
				  }
				| undefined;
			if (
				components
					?.getArray?.('CVModel2')
					.some((model) => model.activeDerivative?.model && model.object3D?.visible)
			)
				firstModelVisible = true;
			// Standalone meshes do not set CVViewer.sceneLoaded (only SVX scenes do).
			const busy = (
				voyagerElement as CategoryViewer | undefined
			)?.application?.system?.components?.get?.('CVAssetManager')?.outs?.busy;
			if (!documentPath && (model || geometry) && busy?.value === false) handleRuntimeSceneLoaded();
		});

		// Also listen for global errors that might come from Voyager
		contentScope.defer(captureViewerErrors((message) => handleVoyagerError({ message })));
		watchRuntimeSceneLoaded(contentScope);
	}

	function handleRuntimeSceneLoaded() {
		if (disposed || sceneReady || hasError) return;
		sceneLoading.sceneLoaded();
		getContent();
		updateSceneLoadingPhase();
	}

	function watchRuntimeSceneLoaded(scope: ViewerResources) {
		if (scope.disposed || disposed || hasError || sceneReady) return;
		const components = (voyagerElement as CategoryViewer | undefined)?.application?.system
			?.components;
		const sceneLoaded = components?.get?.('CVViewer')?.outs?.sceneLoaded;
		const sceneDocument = components?.get?.('CVDocument');
		const assetPath = sceneDocument?.outs?.assetPath;
		const busy = components?.get?.('CVAssetManager')?.outs?.busy;
		if (!sceneLoaded || !assetPath || !busy) {
			scope.timeout(() => watchRuntimeSceneLoaded(scope), 50);
			return;
		}
		const update = () => {
			if (
				isRuntimeSceneReady({
					sceneLoaded:
						sceneLoaded.value || (!documentPath && !!(model || geometry) && firstModelVisible),
					documentLoaded: !!assetPath.value,
					emptyDocument: emptySceneDocument,
					assetsBusy: busy.value
				})
			)
				handleRuntimeSceneLoaded();
		};
		update();
		if (sceneReady || scope.disposed) return;
		const outputs = [sceneLoaded, assetPath, busy];
		if (outputs.every((output) => output.on && output.off)) {
			for (const output of outputs) {
				output.on?.('value', update, scope);
				scope.defer(() => output.off?.('value', update, scope));
			}
		} else {
			scope.timeout(() => watchRuntimeSceneLoaded(scope), 50);
		}
	}

	$effect(() => {
		// Voyager 0.59 does not stop its animation pulse when the element is detached.
		// Stop only this viewer's pulse before replacing one layout with the other.
		const pulse = (
			voyagerElement as
				| (HTMLElement & {
						application?: {
							system?: { components?: { get?: (type: string) => { stop?: () => void } } };
						};
				  })
				| undefined
		)?.application?.system?.components?.get?.('CPulse');
		return () => pulse?.stop?.();
	});

	let fullWindowStyleElement = $state<HTMLStyleElement | null>(null);

	function fixVoyagerModalZIndex() {
		if (!voyagerElement) return;

		const shadowRoot = voyagerElement.shadowRoot;
		if (shadowRoot) {
			// Inject styles into Shadow DOM to contain modal within viewer
			const style = document.createElement('style');
			style.textContent = `
				/* Contain modal within the viewer instead of full viewport */
				.ff-modal-plane {
					position: absolute !important;
				}
				/* Ensure popup appears above the modal backdrop */
				.ff-popup,
				.sv-splash,
				.ff-popup.sv-splash {
					z-index: 1001 !important;
				}
			`;
			shadowRoot.appendChild(style);

			// Create a separate style element for fullscreen mode that we can update
			fullWindowStyleElement = document.createElement('style');
			fullWindowStyleElement.id = 'full-window-styles';
			shadowRoot.appendChild(fullWindowStyleElement);
		}
	}

	function cleanupChromeObserver() {
		chromeObserver?.disconnect();
		chromeObserver = null;
		if (toolsVisibilityFrame !== null) cancelAnimationFrame(toolsVisibilityFrame);
		toolsVisibilityFrame = null;
	}

	function notifyActiveArticle() {
		const reader = (voyagerElement as CategoryViewer)?.viewer?.node?.setup?.reader;
		const id = reader?.ins.enabled.value ? reader.ins.articleId.value || null : null;
		if (externalContent && id && reader) {
			reader.ins.enabled.setValue(false);
			reader.ins.articleId.setValue('');
		}
		if (id === lastActiveArticleId) return;
		lastActiveArticleId = id;
		onActiveArticleChange?.(id || null);
	}

	function notifyTourState(state?: VoyagerTourState) {
		const tours = (voyagerElement as CategoryViewer)?.viewer?.node?.setup?.tours;
		const tourIndex =
			state?.tourIndex ?? (tours?.ins.enabled.value ? tours.outs.tourIndex.value : -1);
		const stepIndex =
			state?.stepIndex ?? (tours?.ins.enabled.value ? tours.outs.stepIndex.value : -1);
		if (!Number.isInteger(tourIndex) || !Number.isInteger(stepIndex)) return;
		if (tourIndex === lastTourState.tourIndex && stepIndex === lastTourState.stepIndex) return;
		lastTourState = { tourIndex, stepIndex };
		onTourChange?.(tourIndex, stepIndex);
	}

	function observeVoyagerChrome() {
		const shadowRoot = voyagerElement?.shadowRoot;
		if (
			!shadowRoot ||
			(!onPanelVisibilityChange &&
				!onAnnotationCategoriesChange &&
				!onActiveArticleChange &&
				!onTourChange)
		)
			return;

		cleanupChromeObserver();
		const notify = () => {
			toolsVisibilityFrame = null;
			notifyAnnotationCategories();
			notifyActiveArticle();
			notifyTourState();
			const panel: VoyagerPanel | null = externalContent
				? shadowRoot.querySelector('.sv-tool-bar-container')
					? 'tools'
					: null
				: shadowRoot.querySelector('.sv-reader-container')
					? 'reader'
					: shadowRoot.querySelector('.sv-tour-menu, .sv-tour-navigator')
						? 'tours'
						: shadowRoot.querySelector('.sv-bottom-bar-container')
							? 'annotations'
							: shadowRoot.querySelector('.sv-tool-bar-container')
								? 'tools'
								: null;
			if (panel === lastVisiblePanel) return;
			lastVisiblePanel = panel;
			onPanelVisibilityChange?.(panel);
		};
		chromeObserver = new MutationObserver(() => {
			if (toolsVisibilityFrame === null) toolsVisibilityFrame = requestAnimationFrame(notify);
		});
		chromeObserver.observe(shadowRoot, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ['class', 'style']
		});
		notify();
	}

	// Optionally hide Voyager's built-in UI via CSS injection
	// Note: Voyager API doesn't support runtime UI toggling for menu/title,
	// only the uiMode attribute at initial render. We use Shadow DOM CSS injection
	// to hide the UI after the model loads.
	$effect(() => {
		if (fullWindowStyleElement && loadingPhase === 'complete') {
			const hideStandardChrome = showVoyagerMenu
				? ''
				: `
					/* Hide all Voyager UI elements - using custom controls */
					.sv-main-menu,
					.sv-main-menu-wrapper,
					.sv-content-view > .ff-title-bar,
					.sv-title-bar,
					.ff-title-bar,
					.sv-menu,
					.sv-nav-container,
					.sv-top-bar-container {
						display: none !important;
					}`;
			const hideExternalChrome = externalContent
				? `
					.sv-reader-view,
					.sv-reader,
					.sv-reader-container,
					.sv-tour-menu,
					.sv-tour-navigator,
					.sv-bottom-bar-container:not(.sv-tour-navigator):not(.sv-tool-bar) {
						display: none !important;
					}`
				: '';
			fullWindowStyleElement.textContent = `${hideStandardChrome}${hideExternalChrome}`;
		}
	});

	function handleVoyagerError(e: unknown) {
		if (disposed) return;
		const error = e as { detail?: { message?: unknown }; message?: unknown } | null;
		const value = error?.detail?.message || error?.message;
		const message = typeof value === 'string' ? value : 'Failed to load 3D model';
		hasError = true;
		errorMessage = message;
		cleanupFetchInterceptor?.();
		cleanupFetchInterceptor = null;
		toast.error(message, {
			duration: 5000,
			position: 'bottom-center',
			style: 'background: #1f2937; color: #f9fafb; border-radius: 0.5rem;'
		});
	}

	function getContent() {
		if (disposed || !voyagerElement || typeof voyagerElement.getAnnotations !== 'function') return;

		try {
			const annots = voyagerElement.getAnnotations();
			const arts = voyagerElement.getArticles?.();
			const toursData = voyagerElement.getTours?.();
			annotations = Array.isArray(annots) ? [...annots] : [];
			articles = Array.isArray(arts) ? [...arts] : [];
			tours = Array.isArray(toursData) ? [...toursData] : [];
			onContentChange?.({ annotations, articles, tours });
			notifyAnnotationCategories();
		} catch (err) {
			console.error('Error loading content:', err);
		}
	}

	function getCapabilities(): VoyagerCapabilities {
		const element = voyagerElement;

		return {
			annotations: typeof element?.toggleAnnotations === 'function',
			reader: typeof element?.toggleReader === 'function',
			tours: typeof element?.toggleTours === 'function',
			tools: typeof element?.toggleTools === 'function',
			measurement: typeof element?.toggleMeasurement === 'function',
			ar: arAvailable && typeof element?.enableAR === 'function',
			reset: typeof element?.resetViewer === 'function',
			audio: false
		};
	}

	function getFeatureNeeds(): VoyagerFeatureNeeds {
		return {
			annotations: annotations.length > 0 || sceneFeatureNeeds.annotations,
			reader: articles.length > 0 || sceneFeatureNeeds.reader,
			tours: tours.length > 0 || sceneFeatureNeeds.tours,
			tools: true,
			measurement: true,
			ar: true,
			reset: true,
			audio: sceneFeatureNeeds.audio
		};
	}

	// API Methods - Camera Control
	function setCameraOrbitInternal() {
		if (!voyagerElement) return;
		cancelCameraAnimation();
		voyagerElement.setCameraOrbit?.(cameraYaw, cameraPitch);
	}

	/** Set camera orbit with explicit yaw/pitch values (for external API) */
	function setCameraOrbitValues(yaw: number, pitch: number) {
		if (!voyagerElement) return;
		cancelCameraAnimation();
		cameraYaw = yaw;
		cameraPitch = pitch;
		voyagerElement.setCameraOrbit?.(yaw, pitch);
	}

	function cancelCameraAnimation() {
		if (cameraAnimationFrame === null) return;
		cancelAnimationFrame(cameraAnimationFrame);
		cameraAnimationFrame = null;
	}

	function readCameraPair(value: unknown, fallbackA: number, fallbackB: number): [number, number] {
		if (Array.isArray(value)) {
			const first = Number(value[0]);
			const second = Number(value[1]);

			return [
				Number.isFinite(first) ? first : fallbackA,
				Number.isFinite(second) ? second : fallbackB
			];
		}

		if (value && typeof value === 'object') {
			const cameraValue = value as Record<string, unknown>;
			const first = Number(cameraValue.yaw ?? cameraValue.x);
			const second = Number(cameraValue.pitch ?? cameraValue.y);

			return [
				Number.isFinite(first) ? first : fallbackA,
				Number.isFinite(second) ? second : fallbackB
			];
		}

		return [fallbackA, fallbackB];
	}

	function readCameraTriple(
		value: unknown,
		fallbackX: number,
		fallbackY: number,
		fallbackZ: number
	): [number, number, number] {
		if (Array.isArray(value)) {
			const x = Number(value[0]);
			const y = Number(value[1]);
			const z = Number(value[2]);

			return [
				Number.isFinite(x) ? x : fallbackX,
				Number.isFinite(y) ? y : fallbackY,
				Number.isFinite(z) ? z : fallbackZ
			];
		}

		if (value && typeof value === 'object') {
			const cameraValue = value as Record<string, unknown>;
			const x = Number(cameraValue.x);
			const y = Number(cameraValue.y);
			const z = Number(cameraValue.z);

			return [
				Number.isFinite(x) ? x : fallbackX,
				Number.isFinite(y) ? y : fallbackY,
				Number.isFinite(z) ? z : fallbackZ
			];
		}

		return [fallbackX, fallbackY, fallbackZ];
	}

	function easeInOutCubic(value: number) {
		return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
	}

	function interpolate(start: number, end: number, progress: number) {
		return start + (end - start) * progress;
	}

	/** Set camera to a view with optional yaw, pitch, and offset (for external API) */
	function setView(options: {
		yaw?: number;
		pitch?: number;
		offsetX?: number;
		offsetY?: number;
		offsetZ?: number;
		animate?: boolean;
		durationMs?: number;
	}) {
		if (!voyagerElement) return;

		cancelCameraAnimation();

		const [currentYaw, currentPitch] = readCameraPair(
			getCameraOrbit('active'),
			cameraYaw,
			cameraPitch
		);
		const [currentOffsetX, currentOffsetY, currentOffsetZ] = readCameraTriple(
			getCameraOffset('active'),
			cameraOffsetX,
			cameraOffsetY,
			cameraOffsetZ
		);

		const targetYaw = options.yaw ?? currentYaw;
		const targetPitch = options.pitch ?? currentPitch;
		const targetOffsetX = options.offsetX ?? currentOffsetX;
		const targetOffsetY = options.offsetY ?? currentOffsetY;
		const targetOffsetZ = options.offsetZ ?? currentOffsetZ;

		if (!options.animate) {
			cameraYaw = targetYaw;
			cameraPitch = targetPitch;
			cameraOffsetX = targetOffsetX;
			cameraOffsetY = targetOffsetY;
			cameraOffsetZ = targetOffsetZ;

			voyagerElement.setCameraOrbit?.(cameraYaw, cameraPitch);
			voyagerElement.setCameraOffset?.(cameraOffsetX, cameraOffsetY, cameraOffsetZ);
			return;
		}

		const durationMs = Math.max(options.durationMs ?? 1200, 0);
		const startedAt = performance.now();

		const updateCamera = (progress: number) => {
			cameraYaw = interpolate(currentYaw, targetYaw, progress);
			cameraPitch = interpolate(currentPitch, targetPitch, progress);
			cameraOffsetX = interpolate(currentOffsetX, targetOffsetX, progress);
			cameraOffsetY = interpolate(currentOffsetY, targetOffsetY, progress);
			cameraOffsetZ = interpolate(currentOffsetZ, targetOffsetZ, progress);

			voyagerElement?.setCameraOrbit?.(cameraYaw, cameraPitch);
			voyagerElement?.setCameraOffset?.(cameraOffsetX, cameraOffsetY, cameraOffsetZ);
		};

		if (durationMs === 0) {
			updateCamera(1);
			return;
		}

		const tick = (now: number) => {
			const progress = Math.min((now - startedAt) / durationMs, 1);
			updateCamera(easeInOutCubic(progress));

			if (progress < 1) {
				cameraAnimationFrame = requestAnimationFrame(tick);
			} else {
				cameraAnimationFrame = null;
			}
		};

		cameraAnimationFrame = requestAnimationFrame(tick);
	}

	function getCameraOrbit(type?: string) {
		if (!voyagerElement) return;
		return voyagerElement.getCameraOrbit?.(type);
	}

	function setCameraOffset(x: number, y: number, z: number) {
		if (!voyagerElement) return;
		cancelCameraAnimation();
		cameraOffsetX = x;
		cameraOffsetY = y;
		cameraOffsetZ = z;
		voyagerElement.setCameraOffset?.(x, y, z);
	}

	function applyCameraOffset() {
		setCameraOffset(cameraOffsetX, cameraOffsetY, cameraOffsetZ);
	}

	function getCameraOffset(type?: string) {
		if (!voyagerElement) return;
		return voyagerElement.getCameraOffset?.(type);
	}

	function resetCamera() {
		cancelCameraAnimation();
		cameraYaw = 0;
		cameraPitch = -25;
		cameraOffsetX = 0;
		cameraOffsetY = 0;
		cameraOffsetZ = 0;
		setCameraOrbitInternal();
		applyCameraOffset();
	}

	function resetViewer() {
		if (!voyagerElement) return;
		cancelCameraAnimation();
		voyagerElement.resetViewer?.();
	}

	function getCurrentCameraPosition() {
		if (!voyagerElement) return;
		const orbit = getCameraOrbit('active');
		const offset = getCameraOffset('active');
		console.log('Camera Orbit:', orbit);
		console.log('Camera Offset:', offset);
		alert(`Camera Position:\nOrbit: ${JSON.stringify(orbit)}\nOffset: ${JSON.stringify(offset)}`);
	}

	// API Methods - Annotations
	function getActiveTags(): string[] {
		return parseAnnotationCategories(
			(voyagerElement as CategoryViewer)?.viewer?.ins?.activeTags?.value
		);
	}

	function notifyAnnotationCategories() {
		const categories = getActiveTags();
		const key = JSON.stringify(categories);
		if (key === lastActiveCategories) return;
		lastActiveCategories = key;
		onAnnotationCategoriesChange?.(categories);
	}

	function setActiveTags(categories: string[]) {
		const element = voyagerElement as CategoryViewer | undefined;
		if (!element) return;
		element.setActiveTags?.(categories.join(','));
		if (categories.length && element.viewer?.ins?.annotationsVisible?.value === false) {
			toggleAnnotations();
		}
		notifyAnnotationCategories();
	}

	function setActiveAnnotation(id: string) {
		if (!voyagerElement) return;
		const element = voyagerElement;
		// A scene's tag filter can hide an otherwise active annotation.
		const annotation = annotations.find((item) => item.id === id);
		if (
			annotation?.tags?.length &&
			!annotation.tags.some((tag: string) => getActiveTags().includes(tag))
		) {
			setActiveTags(annotation.tags);
		}
		const annotationsVisible =
			element.getAnnotationsVisible?.() ?? element.viewer?.ins?.annotationsVisible?.value;
		if (annotationsVisible === false) {
			element.toggleAnnotations?.();
		}
		element.setActiveAnnotation?.(id);
	}

	function toggleAnnotations() {
		if (!voyagerElement) return;
		voyagerElement.toggleAnnotations?.();
	}

	// API Methods - Articles
	function setActiveArticle(id: string) {
		if (!voyagerElement) return;
		if (externalContent) {
			if (lastActiveArticleId !== id) {
				lastActiveArticleId = id;
				onActiveArticleChange?.(id);
			}
			return;
		}
		// Show reader if hidden, then set active article
		const readerElement = voyagerElement.shadowRoot?.querySelector('.sv-reader-container');
		if (!readerElement) {
			voyagerElement.toggleReader?.();
		}
		voyagerElement.setActiveArticle?.(id);
	}

	function toggleReader() {
		if (!voyagerElement) return;
		voyagerElement.toggleReader?.();
	}

	function openArticle(id: string) {
		if (!voyagerElement) return;
		console.log('📖 Opening article:', id);

		// Just set the active article - user should toggle reader manually
		try {
			voyagerElement.setActiveArticle?.(id);
			console.log('✅ Article activated. Toggle Reader to view.');
		} catch (err) {
			console.error('❌ Error opening article:', err);
		}
	}

	// API Methods - Tours
	function setTourStep(tourIdx: number, stepIdx: number, interpolate?: boolean) {
		if (!voyagerElement) return;
		const enabled = (voyagerElement as CategoryViewer).viewer?.node?.setup?.tours?.ins.enabled
			.value;
		if (
			enabled === false ||
			(enabled === undefined &&
				!voyagerElement.shadowRoot?.querySelector('.sv-tour-menu, .sv-tour-navigator'))
		) {
			toggleTours();
		}
		voyagerElement.setTourStep?.(tourIdx, stepIdx, interpolate);
		notifyTourState({ tourIndex: tourIdx, stepIndex: stepIdx });
	}

	function toggleTours() {
		if (!voyagerElement) return;
		voyagerElement.toggleTours?.();
	}

	function stopTour() {
		if ((voyagerElement as CategoryViewer)?.viewer?.node?.setup?.tours?.ins.enabled.value) {
			toggleTours();
		}
		notifyTourState();
	}

	// API Methods - UI Controls
	function toggleTools() {
		if (!voyagerElement) return;
		voyagerElement.toggleTools?.();
	}

	function toggleMeasurement() {
		if (!voyagerElement) return;
		const element = voyagerElement as CategoryViewer;
		const shadowRoot = element.shadowRoot;
		if (!shadowRoot?.querySelector('.sv-tool-bar-container')) element.toggleTools?.();
		requestAnimationFrame(() => {
			const button = Array.from(
				shadowRoot?.querySelectorAll<HTMLElement>('.sv-tool-button') ?? []
			).find((item) => item.getAttribute('icon') === 'tape');
			button?.click();
			requestAnimationFrame(() => {
				const toggle = shadowRoot?.querySelector<HTMLElement>(
					'sv-property-boolean[name="Tape Tool"] ff-button'
				);
				toggle?.click();
				if (toggle) toast.success('Measurement active — select two points on the model.');
			});
		});
	}

	function setBackgroundStyle(style: 'Solid' | 'LinearGradient' | 'RadialGradient') {
		if (!voyagerElement) return;
		voyagerElement.setBackgroundStyle?.(style);
	}

	function setBackgroundColor(color0: string, color1?: string) {
		if (!voyagerElement) return;
		voyagerElement.setBackgroundColor?.(color0, color1);
	}

	function setLanguage(languageCode: string) {
		if (!voyagerElement) return;
		selectedLanguage = languageCode;
		voyagerElement.setLanguage?.(languageCode);
	}

	async function supportsAR() {
		const nav = navigator as Navigator & {
			xr?: { isSessionSupported?: (mode: string) => Promise<boolean> };
		};
		const sessionPrototype = (
			window as Window & {
				XRSession?: { prototype?: { requestHitTestSource?: unknown } };
			}
		).XRSession?.prototype;
		const hasWebXR =
			!!nav.xr &&
			typeof nav.xr.isSessionSupported === 'function' &&
			!!sessionPrototype?.requestHitTestSource;
		const webXR = hasWebXR
			? await nav.xr!.isSessionSupported!('immersive-ar').catch(() => false)
			: false;
		const android = /Android/i.test(nav.userAgent);
		const ios = /iPad|iPhone|iPod/.test(nav.userAgent);
		const link = document.createElement('a');
		const quickLook = ios && !!link.relList?.supports?.('ar');
		return webXR || android || quickLook;
	}

	async function enableAR() {
		if (!voyagerElement) return;
		if (!(await supportsAR())) {
			toast.error('AR is not available on this device or browser.');
			return;
		}
		voyagerElement.enableAR?.();
	}

	// Available languages
	const languages = [
		{ code: 'EN', name: 'English' },
		{ code: 'ES', name: 'Español' },
		{ code: 'FR', name: 'Français' },
		{ code: 'DE', name: 'Deutsch' },
		{ code: 'IT', name: 'Italiano' },
		{ code: 'NL', name: 'Nederlands' },
		{ code: 'JA', name: '日本語' },
		{ code: 'AR', name: 'العربية' }
	];
	const languageOptions = languages.map((language) => ({
		value: language.code,
		label: language.name
	}));

	function toggleVoyagerUI() {
		showVoyagerUI = !showVoyagerUI;
		contentResources?.dispose();
		cleanupChromeObserver();
		cancelCameraAnimation();

		// Clean up existing fetch interceptor
		if (cleanupFetchInterceptor) {
			cleanupFetchInterceptor();
			cleanupFetchInterceptor = null;
		}

		// Reset loading state
		loadingProgress = 0;
		totalBytes = 0;
		loadedBytes = 0;
		loadingPhase = 'script';
		sceneLoading = new SceneLoadingTracker();
		sceneReady = false;
		firstModelVisible = false;
		unknownDownloadIds.clear();

		// Re-mount the voyager element with new uiMode
		isScriptLoaded = false;
		resources.timeout(() => {
			// Reinstall fetch interceptor
			cleanupFetchInterceptor = installFetchInterceptor();
			void initializeViewer();
		}, 100);
	}
</script>

{#snippet progressBar()}
	{#if activeMode === 'viewer' && hasError}
		<div
			class="absolute inset-0 z-10 grid place-content-center bg-base-200 p-6 text-center"
			role="status"
		>
			<p class="font-semibold">3D preview unavailable</p>
			<p class="mt-2 text-sm text-base-content/70">{errorMessage}</p>
			{#if externalContent}<p class="mt-2 text-sm">
					You can still explore the edition content below.
				</p>{/if}
		</div>
	{:else if activeMode === 'viewer' && !viewerReady}
		<div class="edition-loading-status" class:is-refining={firstModelVisible}>
			<div class="edition-loading-label" role="status" aria-live="polite">
				<span>{loadingLabel}</span>
				{#if downloadPercentage !== undefined}
					<span class="tabular-nums">{downloadPercentage}%</span>
				{/if}
			</div>
			<progress
				class="progress h-1 w-full progress-primary"
				aria-label={firstModelVisible ? 'Downloading remaining details' : 'Downloading model'}
				value={downloadPercentage}
				max="100"
			></progress>
		</div>
	{/if}
{/snippet}

{#snippet loadingCover()}
	{#if coverUrl && !coverImageError && !hasError}
		<div class="edition-loading-cover" class:is-ready={coverRevealed} aria-hidden={coverRevealed}>
			<img
				src={coverUrl}
				alt={coverRevealed ? '' : `Cover image of the edition ${title}`}
				decoding="async"
				fetchpriority="high"
				onerror={() => (coverImageError = true)}
			/>
			{#if !coverRevealed}<div class="edition-loading-scan" aria-hidden="true"></div>{/if}
		</div>
	{/if}
{/snippet}

<div id="voyager-viewer" class="voyager-viewer-shell">
	{#if activeMode === 'editor'}
		<div
			class="relative w-full overflow-hidden rounded-lg bg-base-300"
			style="{containerStyle} background: radial-gradient(ellipse at center, #35424F 0%, #03070B 100%);"
		>
			<iframe
				name="Voyager Story"
				src={resolvedEditorUrl}
				title="Voyager Story editor"
				class="absolute top-0 left-0 h-full w-full border-0"
				loading="lazy"
				allow="xr-spatial-tracking; fullscreen"
			></iframe>
		</div>
	{:else if direct}
		<!-- Direct Embedding Mode with Full API Control -->
		<div class="voyager-container">
			{#if showControls && isScriptLoaded}
				<!-- Global UI Toggle -->
				<div class="mb-4">
					<button
						class="btn btn-block btn-lg {showVoyagerUI ? 'btn-warning' : 'btn-success'}"
						onclick={toggleVoyagerUI}
					>
						{showVoyagerUI ? 'Hide Voyager UI' : 'Show Voyager UI'}
					</button>
					<div class="mt-2 text-center text-xs text-base-content/60">
						{showVoyagerUI ? 'Full Voyager interface visible' : 'Clean API-controlled mode'}
					</div>
				</div>

				<!-- Two Column Layout: Viewer Left, Controls Right -->
				<div class="grid gap-4 lg:grid-cols-[1fr_300px]">
					<!-- Left Column: Viewer -->
					<div class="order-2 lg:order-1">
						<!-- Voyager Explorer Component -->
						<div
							class="relative w-full overflow-hidden rounded-lg bg-gradient-to-b from-slate-700 to-slate-900"
							style={containerStyle}
						>
							{#if isScriptLoaded}
								<voyager-explorer
									bind:this={voyagerElement}
									id="voyager"
									class="absolute top-0 left-0 h-full w-full"
									root={url}
									resourceroot={resolvedResourceRoot}
									document={model || geometry ? undefined : documentPath || 'scene.svx.json'}
									model={geometry ? undefined : model}
									{geometry}
									{title}
									uimode={showVoyagerUI ? 'all' : uiMode}
									controls={enableControls}
									prompt={showPrompt}
								></voyager-explorer>
							{:else}
								<div class="absolute inset-0 flex items-center justify-center">
									<div class="loading loading-lg loading-spinner"></div>
								</div>
							{/if}
							{@render progressBar()}
							{@render loadingCover()}
						</div>
					</div>

					<!-- Right Column: Controls -->
					<div class="order-1 lg:order-2">
						<!-- Control Toolbar -->
						<div
							class="voyager-controls card max-h-[80vh] overflow-y-auto bg-base-300 p-4 shadow-lg"
						>
							<div class="space-y-4">
								<!-- Camera Orbit Controls -->
								<div class="space-y-2">
									<h3 class="text-sm font-semibold">Camera Orbit</h3>
									<div class="form-control">
										<div class="label py-1">
											<span class="label-text text-xs">Yaw: {cameraYaw}°</span>
										</div>
										<input
											type="range"
											min="-180"
											max="180"
											bind:value={cameraYaw}
											onchange={setCameraOrbitInternal}
											class="range range-xs"
											aria-label="Camera yaw angle"
										/>
									</div>
									<div class="form-control">
										<div class="label py-1">
											<span class="label-text text-xs">Pitch: {cameraPitch}°</span>
										</div>
										<input
											type="range"
											min="-90"
											max="90"
											bind:value={cameraPitch}
											onchange={setCameraOrbitInternal}
											class="range range-xs"
											aria-label="Camera pitch angle"
										/>
									</div>
								</div>

								<!-- Camera Actions -->
								<div class="space-y-2">
									<h3 class="text-sm font-semibold">Camera Actions</h3>
									<div class="flex gap-2">
										<button class="btn flex-1 btn-outline btn-sm" onclick={resetCamera}>
											Reset
										</button>
										<button
											class="btn flex-1 btn-outline btn-sm"
											onclick={getCurrentCameraPosition}
										>
											Get Position
										</button>
									</div>
								</div>

								<!-- Camera Offset Controls -->
								<div class="space-y-2">
									<h3 class="text-sm font-semibold">Camera Offset</h3>
									<div class="form-control">
										<div class="label py-0">
											<span class="label-text text-xs">X: {cameraOffsetX.toFixed(1)}</span>
										</div>
										<input
											type="range"
											min="-5"
											max="5"
											step="0.1"
											bind:value={cameraOffsetX}
											onchange={applyCameraOffset}
											class="range range-xs"
											aria-label="Camera X offset"
										/>
									</div>
									<div class="form-control">
										<div class="label py-0">
											<span class="label-text text-xs">Y: {cameraOffsetY.toFixed(1)}</span>
										</div>
										<input
											type="range"
											min="-5"
											max="5"
											step="0.1"
											bind:value={cameraOffsetY}
											onchange={applyCameraOffset}
											class="range range-xs"
											aria-label="Camera Y offset"
										/>
									</div>
									<div class="form-control">
										<div class="label py-0">
											<span class="label-text text-xs">Z: {cameraOffsetZ.toFixed(1)}</span>
										</div>
										<input
											type="range"
											min="-5"
											max="5"
											step="0.1"
											bind:value={cameraOffsetZ}
											onchange={applyCameraOffset}
											class="range range-xs"
											aria-label="Camera Z offset"
										/>
									</div>
								</div>

								<!-- Language & Display Controls -->
								<div class="space-y-4">
									<!-- Language Selector -->
									<div class="space-y-2">
										<h3 class="text-sm font-semibold">Language</h3>
										<FloatingSelect
											value={selectedLanguage}
											options={languageOptions}
											class="w-full"
											onchange={setLanguage}
										/>
									</div>

									<!-- Display Toggles -->
									<div class="space-y-2">
										<h3 class="text-sm font-semibold">Display Toggles</h3>
										<div class="grid grid-cols-3 gap-2">
											<button class="btn btn-outline btn-xs" onclick={toggleAnnotations}>
												Annotations
											</button>
											<button class="btn btn-outline btn-xs" onclick={toggleReader}>
												Reader
											</button>
											<button class="btn btn-outline btn-xs" onclick={toggleTours}> Tours </button>
											<button class="btn btn-outline btn-xs" onclick={toggleTools}> Tools </button>
											<button class="btn btn-outline btn-xs" onclick={toggleMeasurement}>
												Measurement
											</button>
											<button class="btn btn-outline btn-xs" onclick={enableAR}> AR Mode </button>
										</div>
									</div>
								</div>

								<!-- Background Controls -->
								<div class="space-y-2">
									<h3 class="text-sm font-semibold">Background Style</h3>
									<div class="mb-3 flex gap-2">
										<button
											class="btn flex-1 btn-outline btn-xs"
											onclick={() => setBackgroundStyle('Solid')}
										>
											Solid
										</button>
										<button
											class="btn flex-1 btn-outline btn-xs"
											onclick={() => setBackgroundStyle('LinearGradient')}
										>
											Linear
										</button>
										<button
											class="btn flex-1 btn-outline btn-xs"
											onclick={() => setBackgroundStyle('RadialGradient')}
										>
											Radial
										</button>
									</div>

									<h3 class="text-sm font-semibold">Quick Colours</h3>
									<div class="grid grid-cols-3 gap-2">
										<button
											class="btn btn-outline btn-xs"
											onclick={() => setBackgroundColor('#1a1a1a', '#0a0a0a')}
											title="Dark grey gradient"
										>
											Dark
										</button>
										<button
											class="btn btn-outline btn-xs"
											onclick={() => setBackgroundColor('#ffffff', '#e0e0e0')}
											title="White to light grey"
										>
											Light
										</button>
										<button
											class="btn btn-outline btn-xs"
											onclick={() => setBackgroundColor('#1e3a8a', '#0c1d3f')}
											title="Deep blue gradient"
										>
											Blue
										</button>
										<button
											class="btn btn-outline btn-xs"
											onclick={() => setBackgroundColor('#7c3aed', '#4c1d95')}
											title="Purple gradient"
										>
											Purple
										</button>
										<button
											class="btn btn-outline btn-xs"
											onclick={() => setBackgroundColor('#dc2626', '#7f1d1d')}
											title="Red gradient"
										>
											Red
										</button>
										<button
											class="btn btn-outline btn-xs"
											onclick={() => setBackgroundColor('#059669', '#064e3b')}
											title="Green gradient"
										>
											Green
										</button>
										<button
											class="btn btn-outline btn-xs"
											onclick={() => setBackgroundColor('#ea580c', '#7c2d12')}
											title="Orange gradient"
										>
											Orange
										</button>
										<button
											class="btn btn-outline btn-xs"
											onclick={() => setBackgroundColor('#0891b2', '#164e63')}
											title="Cyan gradient"
										>
											Cyan
										</button>
										<button
											class="btn btn-outline btn-xs"
											onclick={() => setBackgroundColor('#ec4899', '#831843')}
											title="Pink gradient"
										>
											Pink
										</button>
										<button
											class="btn btn-outline btn-xs"
											onclick={() => setBackgroundColor('#eab308', '#713f12')}
											title="Gold gradient"
										>
											Gold
										</button>
										<button
											class="btn btn-outline btn-xs"
											onclick={() => setBackgroundColor('#14b8a6', '#134e4a')}
											title="Teal gradient"
										>
											Teal
										</button>
										<button
											class="btn btn-outline btn-xs"
											onclick={() => setBackgroundColor('#f97316', '#9a3412')}
											title="Amber gradient"
										>
											Amber
										</button>
									</div>
								</div>

								<!-- Annotations List -->
								{#if annotations.length > 0}
									<div class="mt-4">
										<h3 class="mb-2 text-sm font-semibold">Annotations ({annotations.length})</h3>
										<div class="flex flex-wrap gap-2">
											{#each annotations as annotation (annotation.id)}
												<button
													class="badge cursor-pointer badge-lg badge-primary hover:badge-accent"
													onclick={() => setActiveAnnotation(annotation.id)}
												>
													{annotation.titles?.EN ||
														annotation.titles?.en ||
														annotation.title ||
														annotation.name ||
														annotation.id}
												</button>
											{/each}
										</div>
									</div>
								{/if}

								<!-- Articles List -->
								{#if articles.length > 0}
									<div class="mt-4">
										<h3 class="mb-2 text-sm font-semibold">Articles ({articles.length})</h3>
										<div class="flex flex-wrap gap-2">
											{#each articles as article (article.id)}
												<button
													class="badge cursor-pointer badge-lg badge-secondary hover:badge-accent"
													onclick={() => openArticle(article.id)}
												>
													{article.titles?.EN ||
														article.titles?.en ||
														article.title ||
														article.name ||
														article.id}
												</button>
											{/each}
										</div>
									</div>
								{/if}

								<!-- Tours List -->
								{#if tours.length > 0}
									<div class="mt-4">
										<h3 class="mb-2 text-sm font-semibold">Tours</h3>
										<div class="space-y-2">
											{#each tours as tour, tourIdx (tourIdx)}
												<div class="card bg-base-200 p-2">
													<div class="mb-1 text-xs font-semibold">
														{tour.title || tour.titles?.EN || `Tour ${tourIdx + 1}`}
													</div>
													{#if tour.steps && tour.steps.length > 0}
														<div class="flex flex-wrap gap-1">
															{#each tour.steps as step, stepIdx (stepIdx)}
																<button
																	class="btn btn-outline btn-xs"
																	onclick={() => setTourStep(tourIdx, stepIdx, true)}
																	title={step.title || step.titles?.EN || `Step ${stepIdx + 1}`}
																>
																	{stepIdx + 1}
																</button>
															{/each}
														</div>
													{/if}
												</div>
											{/each}
										</div>
									</div>
								{/if}
							</div>
						</div>
					</div>
				</div>
			{:else}
				<!-- Direct Mode without Controls Panel -->
				<div
					class="relative w-full overflow-hidden rounded-lg"
					style="{containerStyle} background: radial-gradient(ellipse at center, #35424F 0%, #03070B 100%);"
				>
					{#if isScriptLoaded}
						<voyager-explorer
							bind:this={voyagerElement}
							id="voyager"
							class="absolute top-0 left-0 h-full w-full"
							root={url}
							resourceroot={resolvedResourceRoot}
							document={model || geometry ? undefined : documentPath || 'scene.svx.json'}
							model={geometry ? undefined : model}
							{geometry}
							{title}
							uimode={uiMode}
							controls={enableControls}
							prompt={showPrompt}
						></voyager-explorer>
					{:else}
						<div class="absolute inset-0 flex items-center justify-center">
							<div class="loading loading-lg loading-spinner"></div>
						</div>
					{/if}
					{@render progressBar()}
					{@render loadingCover()}
				</div>
			{/if}
		</div>
	{:else}
		<!-- Iframe Mode (No API Control) -->
		<div
			class="relative w-full"
			style="{containerStyle} background: radial-gradient(ellipse at center, #35424F 0%, #03070B 100%);"
		>
			<iframe
				bind:this={iframeElement}
				name="Smithsonian Voyager"
				src={url}
				{title}
				class="absolute top-0 left-0 h-full w-full border-0"
				loading="eager"
				allow="xr; xr-spatial-tracking; fullscreen"
				onload={handleIframeLoad}
			></iframe>
			{@render progressBar()}
			{@render loadingCover()}
		</div>
	{/if}

	{#if direct}<div bind:this={animationHost}></div>{/if}
	{#if showEditorSwitch}
		<div class="flex flex-wrap items-center justify-between gap-3 bg-base-100/95 p-3">
			<div class="join" role="group" aria-label="Voyager mode">
				<button
					type="button"
					class="btn join-item btn-sm"
					class:btn-active={activeMode === 'viewer'}
					onclick={() => (activeMode = 'viewer')}
				>
					Viewer
				</button>
				<button
					type="button"
					class="btn join-item btn-sm"
					class:btn-active={activeMode === 'editor'}
					onclick={() => (activeMode = 'editor')}
				>
					Editor
				</button>
			</div>

			{#if activeMode === 'editor' && onFullWindowToggle}
				<button
					type="button"
					class="btn btn-outline btn-sm"
					onclick={onFullWindowToggle}
					aria-label={isFullWindow ? 'Exit full window' : 'Full window'}
				>
					{isFullWindow ? 'Exit full window' : 'Full window'}
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.voyager-viewer-shell {
		position: relative;
		width: 100%;
	}

	.edition-loading-status {
		position: absolute;
		right: 1rem;
		bottom: 1rem;
		left: 1rem;
		z-index: 30;
		max-width: 24rem;
		margin-inline: auto;
		padding: 0.75rem 1rem;
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
		pointer-events: none;
	}
	.edition-loading-status progress {
		color: rgb(163 199 173);
		background-color: rgb(255 255 255 / 18%);
	}
	.edition-loading-status.is-refining {
		left: auto;
		width: min(18rem, calc(100% - 2rem));
	}
	.edition-loading-label {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.375rem;
		font-size: 0.875rem;
	}

	.edition-loading-cover {
		position: absolute;
		inset: 0;
		z-index: 20;
		overflow: hidden;
		background: var(--color-base-200);
		transition: opacity 0.9s ease;
	}
	.edition-loading-cover img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition: transform 1.4s cubic-bezier(0.2, 0.7, 0.1, 1);
	}
	.edition-loading-cover.is-ready {
		opacity: 0;
		pointer-events: none;
	}
	.edition-loading-cover.is-ready img {
		transform: scale(1.04);
	}
	.edition-loading-scan {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: linear-gradient(
			180deg,
			transparent 0%,
			color-mix(in srgb, var(--color-accent) 28%, transparent) 49%,
			var(--color-accent) 50%,
			transparent 51%
		);
		background-size: 100% 220%;
		mix-blend-mode: screen;
		animation: edition-cover-scan 2.2s cubic-bezier(0.45, 0, 0.55, 1) infinite;
	}
	@keyframes edition-cover-scan {
		from {
			background-position: 0 110%;
		}
		to {
			background-position: 0 -10%;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.edition-loading-cover,
		.edition-loading-cover img {
			transition-duration: 0.01ms;
		}
		.edition-loading-scan {
			animation: none;
			display: none;
		}
	}

	/* Custom element styles */
	:global(voyager-explorer) {
		display: block;
		width: 100%;
		height: 100%;
		/* Contain fixed/absolute positioned children within the viewer */
		contain: layout;
		isolation: isolate;
	}

	/* Hide Voyager's built-in notification system - we use svelte-french-toast instead */
	:global(voyager-explorer .sv-notification),
	:global(voyager-explorer .ff-notification),
	:global(voyager-explorer .sv-notification-stack),
	:global(voyager-explorer .ff-notification-stack) {
		display: none !important;
	}
</style>
