<script lang="ts">
	import { contentText } from '$lib/utils/content-html';
	import { onMount, untrack } from 'svelte';
	import { pb, cachePrefix } from '$lib/database/client';
	import { readCredits } from '$lib/utils/credits';
	import { safeContentImageUrl } from '$lib/utils/content-components';
	import toast from 'svelte-french-toast';
	import FloatingSelect from '$lib/components/ui/FloatingSelect.svelte';
	import type { Edition } from '$lib/types/collection';

	interface Props {
		open: boolean;
		edition: Pick<
			Edition,
			'id' | 'slug' | 'title' | 'description' | 'authors' | 'thumbnail' | 'tags' | 'credits'
		> &
			Partial<
				Pick<
					Edition,
					| 'dcAbstract'
					| 'dcDescription'
					| 'dcSubject'
					| 'dcKeyword'
					| 'dcCoveragePeriod'
					| 'dcCoveragePlace'
					| 'dcCoverageCountry'
					| 'dcCoverageTemporal'
					| 'dcCoverageGeo'
					| 'dcProvenance'
					| 'dcSource'
					| 'dcInstitution'
				>
			>;
		onclose: () => void;
	}

	interface GalleryImage {
		id: string;
		editionKey: string;
		ownerKey?: string;
		url: string;
		referenceUrl?: string | null;
		createdAt: number;
	}

	let { open = $bindable(), edition, onclose }: Props = $props();

	// Model options
	const MODELS = [
		{ id: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image (higher quality)' },
		{ id: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image (faster)' }
	] as const;
	const MODEL_OPTIONS = MODELS.map((model) => ({ value: model.id, label: model.label }));

	// State
	let additionalPrompt = $state('');
	let generatedImageUrl = $state<string | null>(null);
	let isGenerating = $state(false);
	let showSettings = $state(false);
	let apiKey = $state('');
	let selectedModel = $state<string>(MODELS[0].id);
	let capturedImageDataUrl = $state<string | null>(null);
	let selectedReferenceImageUrl = $state<string | null>(null);
	let errorMessage = $state<string | null>(null);
	let sliderPosition = $state(50);
	let comparisonContainer: HTMLDivElement | undefined = $state();
	let galleryImages = $state<GalleryImage[]>([]);
	const comparisonReferenceImageUrl = $derived(selectedReferenceImageUrl || capturedImageDataUrl);

	let generationRevision = 0;
	let generationController: AbortController | undefined;

	function clearPrivateState() {
		generationRevision += 1;
		generationController?.abort();
		apiKey = '';
		additionalPrompt = '';
		galleryImages = [];
		generatedImageUrl = null;
		capturedImageDataUrl = null;
		selectedReferenceImageUrl = null;
		errorMessage = null;
		isGenerating = false;
	}

	onMount(() =>
		pb.authStore.onChange(() => {
			// Do not recapture an edition loaded with the previous account's permissions.
			handleClose();
		})
	);

	$effect(() => {
		const isOpen = open;
		void edition.id;
		untrack(() => {
			clearPrivateState();
			if (isOpen) {
				void loadGalleryImages();
				captureViewerScreenshot();
			}
		});
		return () => {
			generationRevision += 1;
			generationController?.abort();
		};
	});

	function getEditionGalleryKey() {
		return edition.slug || edition.id || edition.title || 'imagine';
	}

	function getGalleryOwnerKey() {
		const owner = pb.authStore.isValid ? pb.authStore.record : null;
		return owner?.id
			? `${cachePrefix}:${pb.baseURL}:${owner.collectionName || 'users'}:${owner.id}`
			: null;
	}

	function isGeneratedImageUrl(value: unknown): value is string {
		return (
			typeof value === 'string' &&
			/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/\s]+={0,2}$/.test(value)
		);
	}

	function openGalleryDb(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open('pure3d-imagine-gallery', 1);
			request.onupgradeneeded = () => {
				const store = request.result.createObjectStore('images', { keyPath: 'id' });
				store.createIndex('editionKey', 'editionKey');
			};
			request.onsuccess = () => {
				request.result.onversionchange = () => request.result.close();
				resolve(request.result);
			};
			request.onerror = () => reject(request.error);
		});
	}

	async function loadGalleryImages() {
		const ownerKey = getGalleryOwnerKey();
		if (!ownerKey) return;
		const revision = generationRevision;
		const editionKey = getEditionGalleryKey();
		try {
			const db = await openGalleryDb();
			if (revision !== generationRevision) {
				db.close();
				return;
			}
			const transaction = db.transaction('images', 'readonly');
			const request = transaction.objectStore('images').index('editionKey').getAll(editionKey);
			request.onsuccess = () => {
				if (revision !== generationRevision || ownerKey !== getGalleryOwnerKey()) return;
				// Unowned legacy entries remain quarantined in the database, never attributed to a user.
				galleryImages = (request.result as GalleryImage[])
					.filter((image) => image.ownerKey === ownerKey && isGeneratedImageUrl(image.url))
					.map((image) => ({
						...image,
						referenceUrl: isGeneratedImageUrl(image.referenceUrl)
							? image.referenceUrl
							: safeContentImageUrl(image.referenceUrl)
					}))
					.sort((a, b) => b.createdAt - a.createdAt)
					.slice(0, 24);
			};
			transaction.oncomplete = transaction.onerror = transaction.onabort = () => db.close();
		} catch {
			// Local storage is optional; new images remain available in memory.
		}
	}

	async function saveGalleryImage(url: string) {
		const ownerKey = getGalleryOwnerKey();
		const revision = generationRevision;
		const idSuffix =
			crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const image: GalleryImage = {
			id: `${getEditionGalleryKey()}-${idSuffix}`,
			editionKey: getEditionGalleryKey(),
			ownerKey: ownerKey || undefined,
			url,
			referenceUrl: capturedImageDataUrl,
			createdAt: Date.now()
		};

		galleryImages = [image, ...galleryImages].slice(0, 24);
		selectedReferenceImageUrl = image.referenceUrl || null;
		// Anonymous sessions have no stable owner and must not persist private references.
		if (!ownerKey) return;
		try {
			const db = await openGalleryDb();
			if (revision !== generationRevision || ownerKey !== getGalleryOwnerKey()) {
				db.close();
				return;
			}
			const transaction = db.transaction('images', 'readwrite');
			transaction.objectStore('images').put(image);
			transaction.oncomplete = () => db.close();
			transaction.onerror = transaction.onabort = () => {
				db.close();
				if (revision === generationRevision)
					toast.error('Generated image could not be saved locally');
			};
		} catch {
			if (revision === generationRevision)
				toast.error('Generated image could not be saved locally');
		}
	}

	function updateSlider(e: MouseEvent | TouchEvent) {
		if (!comparisonContainer) return;
		const rect = comparisonContainer.getBoundingClientRect();
		const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
		sliderPosition = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
	}

	function startDrag(e: MouseEvent | TouchEvent) {
		updateSlider(e);

		const onMove = (ev: MouseEvent | TouchEvent) => updateSlider(ev);
		const onUp = () => {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
			window.removeEventListener('touchmove', onMove);
			window.removeEventListener('touchend', onUp);
		};
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
		window.addEventListener('touchmove', onMove);
		window.addEventListener('touchend', onUp);
	}

	function saveApiKey() {
		apiKey = apiKey.trim();
		toast.success('Gemini API key ready for this session');
		showSettings = false;
	}

	function clearApiKey() {
		apiKey = '';
		toast.success('API key cleared');
	}

	/**
	 * Capture a screenshot from the 3D viewer canvas.
	 * Uses drawImage() to copy the WebGL canvas onto a 2D canvas, which reads from
	 * the composited output and works regardless of preserveDrawingBuffer setting.
	 * Falls back to the edition thumbnail if capture fails.
	 */
	function captureViewerScreenshot() {
		capturedImageDataUrl = null;

		// Find the WebGL canvas
		let canvas: HTMLCanvasElement | null = null;
		const voyagerEl = document.querySelector('voyager-explorer');
		if (voyagerEl?.shadowRoot) {
			canvas = voyagerEl.shadowRoot.querySelector('canvas');
		}
		if (!canvas) {
			const el = document.querySelector('.card.overflow-hidden canvas');
			if (el instanceof HTMLCanvasElement) canvas = el;
		}

		if (!canvas) {
			if (edition.thumbnail) capturedImageDataUrl = edition.thumbnail;
			return;
		}

		try {
			// Copy the WebGL canvas onto a 2D canvas via drawImage
			const copy = document.createElement('canvas');
			copy.width = canvas.width;
			copy.height = canvas.height;
			const ctx = copy.getContext('2d');
			if (!ctx) throw new Error('No 2D context');
			ctx.drawImage(canvas, 0, 0);

			// Check if the result has actual content (not all transparent/white)
			const sample = ctx.getImageData(0, 0, copy.width, Math.min(copy.height, 10));
			const hasContent = sample.data.some((v, i) => (i % 4 !== 3 ? v !== 0 && v !== 255 : false));

			if (hasContent) {
				capturedImageDataUrl = copy.toDataURL('image/png');
			} else if (edition.thumbnail) {
				capturedImageDataUrl = edition.thumbnail;
			}
		} catch {
			if (edition.thumbnail) capturedImageDataUrl = edition.thumbnail;
		}
	}

	/**
	 * Resize and compress an image data URL to fit within API limits.
	 * Returns { data: base64string, mimeType: string }
	 */
	function resizeImage(
		dataUrl: string,
		maxDim = 1024
	): Promise<{ data: string; mimeType: string }> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.crossOrigin = 'anonymous';
			img.onerror = () => reject(new Error('The reference image could not load.'));
			img.onload = () => {
				try {
					let { width, height } = img;
					if (width > maxDim || height > maxDim) {
						const scale = maxDim / Math.max(width, height);
						width = Math.round(width * scale);
						height = Math.round(height * scale);
					}
					const c = document.createElement('canvas');
					c.width = width;
					c.height = height;
					const ctx = c.getContext('2d')!;
					ctx.drawImage(img, 0, 0, width, height);
					const jpeg = c.toDataURL('image/jpeg', 0.85);
					resolve({ data: jpeg.split(',')[1], mimeType: 'image/jpeg' });
				} catch {
					reject(new Error('The reference image could not be read.'));
				}
			};
			img.src = dataUrl;
		});
	}

	/**
	 * Build the AI prompt from edition metadata
	 */
	function buildPrompt(): string {
		const parts: string[] = [];

		if (capturedImageDataUrl) {
			parts.push(
				'Transform the attached reference image of this 3D model into a photorealistic photograph.'
			);
			parts.push(
				'Keep the same composition, angle, and subject as the reference image, but make it look like a real photograph taken in its original historical setting.'
			);
			parts.push(
				'Replace the 3D rendering look with realistic textures, natural lighting, atmospheric perspective, and environmental context.\n'
			);
		} else {
			parts.push(
				'Generate a photorealistic photograph of this historical/cultural object in its original context.'
			);
			parts.push(
				'Make it look like a real photograph — natural lighting, realistic textures, atmospheric perspective.\n'
			);
		}

		// Core info
		if (edition.title) parts.push(`Object: ${edition.title}`);
		if (edition.description) parts.push(`Description: ${edition.description}`);
		if (edition.authors) parts.push(`Created by: ${edition.authors}`);

		// Dublin Core metadata for richer context
		if (edition.dcAbstract) parts.push(`Abstract: ${edition.dcAbstract}`);
		if (edition.dcDescription) parts.push(`Detailed description: ${edition.dcDescription}`);

		// Classification & subject
		if (edition.dcSubject?.length) parts.push(`Subject: ${edition.dcSubject.join(', ')}`);
		if (edition.dcKeyword?.length) parts.push(`Keywords: ${edition.dcKeyword.join(', ')}`);
		if (edition.tags?.length) parts.push(`Tags: ${edition.tags.join(', ')}`);

		// Historical & geographical context
		if (edition.dcCoveragePeriod?.length)
			parts.push(`Time period: ${edition.dcCoveragePeriod.join(', ')}`);
		if (edition.dcCoveragePlace) parts.push(`Place: ${edition.dcCoveragePlace}`);
		if (edition.dcCoverageCountry?.length)
			parts.push(`Country: ${edition.dcCoverageCountry.join(', ')}`);
		if (edition.dcCoverageTemporal) parts.push(`Temporal coverage: ${edition.dcCoverageTemporal}`);
		if (edition.dcCoverageGeo) parts.push(`Geographic info: ${edition.dcCoverageGeo}`);

		// Provenance
		if (edition.dcProvenance) parts.push(`Provenance: ${edition.dcProvenance}`);
		if (edition.dcSource?.length) parts.push(`Source: ${edition.dcSource.join(', ')}`);

		// Creators & institutions
		for (const credit of readCredits(edition.credits)) {
			parts.push(
				`${credit.role}: ${credit.name}${credit.orcid ? ` (${credit.orcid})` : ''}${credit.contributionRole ? ` - ${credit.contributionRole}` : ''}`
			);
		}
		if (edition.dcInstitution?.length)
			parts.push(`Institution: ${edition.dcInstitution.join(', ')}`);

		// User additions
		if (additionalPrompt.trim()) {
			parts.push(`\nAdditional instructions: ${additionalPrompt.trim()}`);
		}

		return parts.join('\n');
	}

	/**
	 * Generate image using Google Gemini API (Imagen)
	 */
	async function generateImage() {
		if (!open || isGenerating) return;
		const key = apiKey.trim();
		if (!key) {
			showSettings = true;
			toast.error('Please set your Gemini API key first');
			return;
		}
		const model = MODELS.find((option) => option.id === selectedModel);
		if (!model) {
			errorMessage = 'Choose a supported model.';
			return;
		}
		const revision = ++generationRevision;
		const controller = new AbortController();
		generationController = controller;

		isGenerating = true;
		errorMessage = null;
		generatedImageUrl = null;
		selectedReferenceImageUrl = null;
		sliderPosition = 50;

		const prompt = buildPrompt();

		try {
			// Resize reference image to fit API limits
			let imagePart: { inlineData: { mimeType: string; data: string } } | null = null;
			if (capturedImageDataUrl) {
				const resized = await resizeImage(capturedImageDataUrl);
				imagePart = { inlineData: resized };
			}
			if (revision !== generationRevision) return;

			// Use selected Gemini image generation model
			const response = await fetch(
				`https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
					signal: controller.signal,
					body: JSON.stringify({
						contents: [
							{
								parts: [{ text: prompt }, ...(imagePart ? [imagePart] : [])]
							}
						],
						generationConfig: {
							responseModalities: ['TEXT', 'IMAGE']
						}
					})
				}
			);

			if (!response.ok) {
				const errData = await response.json().catch(() => null);
				throw new Error(
					errData?.error?.message || `API request failed with status ${response.status}`
				);
			}

			const data = await response.json();
			if (revision !== generationRevision) return;

			// Extract generated image from response
			const candidates = data.candidates || [];
			for (const candidate of candidates) {
				const parts = candidate.content?.parts || [];
				for (const part of parts) {
					if (
						['image/png', 'image/jpeg', 'image/webp'].includes(part.inlineData?.mimeType) &&
						typeof part.inlineData.data === 'string' &&
						/^[A-Za-z0-9+/\s]*={0,2}$/.test(part.inlineData.data)
					) {
						generatedImageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
						break;
					}
				}
				if (generatedImageUrl) break;
			}

			if (!generatedImageUrl) {
				throw new Error(
					'No image was generated. The model may not have produced an image for this prompt. Try adjusting your description.'
				);
			}

			await saveGalleryImage(generatedImageUrl);
		} catch (err: unknown) {
			if (revision !== generationRevision) return;
			errorMessage = err instanceof Error ? err.message : 'Failed to generate image';
			toast.error('Image generation failed');
		} finally {
			if (revision === generationRevision) isGenerating = false;
		}
	}

	function downloadImage(url = generatedImageUrl) {
		if (!isGeneratedImageUrl(url)) return;
		const slug = edition.slug || 'imagine';
		const ext = url.startsWith('data:image/jpeg') ? 'jpg' : 'png';
		const a = document.createElement('a');
		a.href = url;
		a.download = `${slug}-generated-${new Date().toISOString().slice(0, 10)}.${ext}`;
		a.click();
	}

	function selectGalleryImage(image: GalleryImage) {
		generatedImageUrl = image.url;
		selectedReferenceImageUrl = image.referenceUrl || null;
		errorMessage = null;
		sliderPosition = 50;
	}

	function handleClose() {
		clearPrivateState();
		open = false;
		onclose();
	}
</script>

<dialog id="imagine-modal" class="modal" class:modal-open={open}>
	<div class="modal-box max-w-3xl">
		<!-- Header -->
		<div class="mb-4 flex items-center justify-between">
			<h3 class="text-lg font-bold">Imagine — AI Image Generation</h3>
			<div class="flex items-center gap-2">
				{#if generatedImageUrl}
					<button
						type="button"
						class="btn btn-circle btn-ghost btn-sm"
						onclick={() => downloadImage()}
						title="Download generated image"
						aria-label="Download generated image"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 24 24"
							stroke-width="2"
							stroke="currentColor"
							class="h-5 w-5"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
							/>
						</svg>
					</button>
				{/if}
				<!-- Settings toggle -->
				<button
					type="button"
					class="btn btn-circle btn-ghost btn-sm"
					onclick={() => (showSettings = !showSettings)}
					title="Gemini API Settings"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
						stroke-width="1.5"
						stroke="currentColor"
						class="h-5 w-5"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z"
						/>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
						/>
					</svg>
				</button>
				<button
					type="button"
					class="btn btn-circle btn-ghost btn-sm"
					onclick={handleClose}
					title="Close"
					aria-label="Close"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
						stroke-width="2"
						stroke="currentColor"
						class="h-5 w-5"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
		</div>

		<!-- Settings Panel (collapsible) -->
		{#if showSettings}
			<div class="mb-4 rounded-lg bg-base-300 p-4">
				<h4 class="mb-2 text-sm font-semibold">Gemini API Configuration</h4>
				<p class="mb-3 text-xs text-base-content/60">
					Enter your Google Gemini API key. Get one at
					<a
						href="https://aistudio.google.com/apikey"
						target="_blank"
						rel="noopener noreferrer"
						class="link link-primary">Google AI Studio</a
					>. The key stays in memory only and is cleared when you close this window or change
					account.
				</p>
				<div class="flex gap-2">
					<input
						type="password"
						class="input-bordered input input-sm flex-1"
						placeholder="Enter your Gemini API key..."
						bind:value={apiKey}
						autocomplete="off"
						onkeydown={(e) => e.key === 'Enter' && saveApiKey()}
					/>
					<button type="button" class="btn btn-sm btn-primary" onclick={saveApiKey}>Use key</button>
					{#if apiKey}
						<button type="button" class="btn btn-ghost btn-sm" onclick={clearApiKey}>Clear</button>
					{/if}
				</div>
				<!-- Model selector -->
				<div class="mt-3">
					<label for="model-select" class="mb-1 block text-xs font-semibold">Model</label>
					<FloatingSelect
						id="model-select"
						value={selectedModel}
						options={MODEL_OPTIONS}
						class="w-full"
						onchange={(model) => {
							if (MODELS.some((option) => option.id === model)) selectedModel = model;
						}}
					/>
				</div>
			</div>
		{/if}

		<!-- Comparison slider (when generated) or reference preview -->
		{#if generatedImageUrl && comparisonReferenceImageUrl}
			<div class="mb-4">
				<div class="mb-1 flex items-center justify-between">
					<span class="text-xs font-semibold text-base-content/60">3D Model</span>
					<span class="text-xs font-semibold text-base-content/60">Generated</span>
				</div>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					id="comparison-container"
					class="relative cursor-col-resize overflow-hidden rounded-lg border border-base-300 shadow-lg select-none"
					bind:this={comparisonContainer}
					onmousedown={startDrag}
					ontouchstart={startDrag}
				>
					<!-- Generated image (background, full width) -->
					<img
						src={generatedImageUrl}
						alt="AI generated visualisation of {edition.title}"
						class="block w-full"
						draggable="false"
					/>
					<!-- Reference image (foreground, clipped by slider) -->
					<div
						class="absolute top-0 left-0 h-full overflow-hidden"
						style="width: {sliderPosition}%"
					>
						<img
							src={comparisonReferenceImageUrl}
							alt="Current 3D viewer capture"
							class="block h-full object-cover"
							style="width: {comparisonContainer?.offsetWidth ?? 600}px; max-width: none;"
							draggable="false"
						/>
					</div>
					<!-- Slider handle -->
					<div
						class="absolute top-0 bottom-0 z-10 w-0.5 bg-white shadow-md"
						style="left: {sliderPosition}%"
					>
						<div
							class="absolute top-1/2 left-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-lg"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 24 24"
								fill="currentColor"
								class="h-4 w-4 text-base-content/60"
							>
								<path
									d="M8 5l-5 7 5 7M16 5l5 7-5 7"
									stroke="currentColor"
									stroke-width="2"
									fill="none"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
						</div>
					</div>
				</div>
			</div>
		{:else if generatedImageUrl}
			<div class="mb-4">
				<p class="mb-2 text-sm font-semibold">Generated Image</p>
				<img
					src={generatedImageUrl}
					alt="AI generated visualisation of {edition.title}"
					class="w-full rounded-lg shadow-lg"
				/>
			</div>
		{:else}
			<!-- Reference preview (before generation) -->
			<div class="mb-4">
				<p class="mb-1 text-xs font-semibold text-base-content/60">Current view (reference)</p>
				{#if capturedImageDataUrl}
					<div class="overflow-hidden rounded-lg border border-base-300 bg-base-200 shadow-lg">
						<img
							src={capturedImageDataUrl}
							alt="Current 3D viewer capture"
							class="max-h-[55vh] w-full object-contain"
						/>
					</div>
				{:else}
					<div
						class="flex min-h-96 w-full items-center justify-center rounded-lg border border-base-300 bg-base-200 text-xs text-base-content/40"
					>
						No preview available
					</div>
				{/if}
			</div>
		{/if}

		{#if galleryImages.length}
			<div class="mb-4 rounded-lg bg-base-200 p-2.5">
				<div class="mb-1.5 flex items-center justify-between gap-3">
					<p class="text-xs font-semibold text-base-content/60">Generated gallery</p>
					<p class="text-xs text-base-content/40">
						{getGalleryOwnerKey()
							? 'Saved locally for this account'
							: 'Cleared when this window closes'}
					</p>
				</div>
				<div class="flex gap-1.5 overflow-x-auto pb-1">
					{#each galleryImages as image, index (`${image.id}-${image.createdAt}-${index}`)}
						<div class="group relative shrink-0">
							<button
								type="button"
								class="block overflow-hidden rounded-md border bg-base-100 transition hover:border-primary"
								class:border-primary={generatedImageUrl === image.url}
								class:border-base-300={generatedImageUrl !== image.url}
								onclick={() => selectGalleryImage(image)}
								title="Show generated image"
							>
								<img
									src={image.url}
									alt="Generated thumbnail for {edition.title}"
									class="h-14 w-20 object-cover"
								/>
							</button>
							<button
								type="button"
								class="btn absolute right-1 bottom-1 btn-circle border-0 bg-base-100/90 opacity-0 shadow btn-xs group-hover:opacity-100 focus:opacity-100"
								onclick={() => downloadImage(image.url)}
								title="Download this image"
								aria-label="Download this image"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									fill="none"
									viewBox="0 0 24 24"
									stroke-width="2"
									stroke="currentColor"
									class="h-3.5 w-3.5"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
									/>
								</svg>
							</button>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Metadata summary -->
		<div class="mb-4 rounded-lg bg-base-200 p-3">
			<p class="mb-1 text-xs font-semibold text-base-content/60">Context from edition metadata</p>
			<div class="flex flex-wrap gap-1">
				<span class="badge badge-sm badge-primary">{edition.title}</span>
				{#if edition.dcCoveragePeriod?.length}
					{#each edition.dcCoveragePeriod as period, index (`${period}-${index}`)}
						<span class="badge badge-sm badge-secondary">{period}</span>
					{/each}
				{/if}
				{#if edition.dcCoveragePlace}
					<span class="badge badge-sm badge-accent">{edition.dcCoveragePlace}</span>
				{/if}
				{#each edition.tags as tag, index (`${tag}-${index}`)}
					<span class="badge badge-ghost badge-sm">{tag}</span>
				{/each}
				{#if edition.dcSubject?.length}
					{#each edition.dcSubject.slice(0, 3) as subject, index (`${subject}-${index}`)}
						<span class="badge badge-ghost badge-sm">{subject}</span>
					{/each}
				{/if}
				{#if edition.dcKeyword?.length}
					{#each edition.dcKeyword.slice(0, 3) as kw, index (`${kw}-${index}`)}
						<span class="badge badge-outline badge-sm">{kw}</span>
					{/each}
				{/if}
			</div>
			{#if edition.description}
				<p class="mt-2 line-clamp-2 text-xs text-base-content/60">
					{contentText(edition.description)}
				</p>
			{/if}
		</div>

		<!-- Additional prompt input -->
		<div class="mb-4">
			<label for="additional-prompt" class="mb-1 block text-sm font-semibold"
				>Additional instructions (optional)</label
			>
			<textarea
				id="additional-prompt"
				class="textarea-bordered textarea w-full"
				rows="3"
				placeholder="Add details to guide the image generation... e.g., 'Show it in a museum setting with dramatic lighting' or 'Recreate it being used in ancient times'"
				bind:value={additionalPrompt}
			></textarea>
		</div>

		<!-- Error message -->
		{#if errorMessage}
			<div class="mb-4 alert alert-error">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5 shrink-0"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
					/>
				</svg>
				<span class="text-sm">{errorMessage}</span>
			</div>
		{/if}

		<!-- Loading state -->
		{#if isGenerating}
			<div class="mb-4 flex flex-col items-center gap-3 py-8">
				<span class="loading loading-lg loading-spinner text-primary"></span>
				<p class="text-sm text-base-content/60">
					Generating a realistic visualisation of <strong>{edition.title}</strong>...
				</p>
				<p class="text-xs text-base-content/40">This may take a few seconds</p>
			</div>
		{/if}

		<!-- Actions -->
		<p class="text-xs text-base-content/60">
			Generating sends the reference image, edition metadata and your instructions to Google using
			your API key. Google API charges may apply. Only send content you are authorised to share.
		</p>
		<div class="modal-action">
			{#if generatedImageUrl}
				<button type="button" class="btn btn-outline btn-sm" onclick={() => downloadImage()}>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
						stroke-width="2"
						stroke="currentColor"
						class="h-4 w-4"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
						/>
					</svg>
					Download
				</button>
				<button type="button" class="btn btn-sm btn-primary" onclick={generateImage}>
					Regenerate
				</button>
			{:else}
				<button type="button" class="btn" onclick={handleClose}>Cancel</button>
				<button
					type="button"
					class="btn btn-primary"
					onclick={generateImage}
					disabled={isGenerating}
				>
					{#if isGenerating}
						<span class="loading loading-sm loading-spinner"></span>
						Generating...
					{:else}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 24 24"
							stroke-width="2"
							stroke="currentColor"
							class="h-5 w-5"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
							/>
						</svg>
						Imagine
					{/if}
				</button>
			{/if}
		</div>
	</div>

	<!-- Backdrop -->
	<form method="dialog" class="modal-backdrop">
		<button type="button" onclick={handleClose} aria-label="Close">close</button>
	</form>
</dialog>
