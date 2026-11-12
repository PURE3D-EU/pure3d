<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { base, resolve } from '$app/paths';
	import {
		ParticleField,
		type FieldFocus,
		type FieldFrame,
		type GlyphSource,
		type ParticleGlyphs
	} from './particle-field';
	import { EDITION_PARTICLE_FORMS, buildParticleCloud, type ParticleForm } from './particle-forms';
	import { loadEditionParticles } from './edition-particles';
	import {
		POINTER_TRAIL_SAMPLES,
		POINTER_TRAIL_STRIDE,
		advancePointerTrail,
		decayPointerTarget,
		easePointerStrength,
		pointerStrengthFromSpeed,
		savePointerTrailSample
	} from './particle-pointer';

	interface Props {
		/** Headline, lede and calls to action, laid over the artwork. */
		copy: Snippet;
		/** Actions shown beneath the form, such as opening a published edition. */
		foot?: Snippet;
		/** Draws every particle as a letter from the copy instead of a dot. */
		glyphs?: GlyphSource;
		/** Keep the artwork without its explanatory panels and form selector. */
		minimal?: boolean;
	}

	type Status = 'pending' | 'live' | 'fallback';

	let { copy, foot, glyphs, minimal = false }: Props = $props();

	/**
	 * Dots read as a dense scan. Letters need far fewer, larger particles to stay readable rather
	 * than smearing into each other. Pairs are [regular, compact]; sizes are CSS pixels at the centre
	 * of the form.
	 */
	const DENSITY = {
		points: {
			form: [18000, 9000],
			dust: [2800, 1200],
			size: [2.2, 2.2],
			maxSize: 18,
			clusters: {}
		},
		glyphs: {
			form: [1400, 700],
			dust: [260, 120],
			size: [18, 14],
			maxSize: 44,
			clusters: { anchorPoints: 4, anchorRadius: 0.07 }
		}
	};

	const MAX_PIXEL_RATIO = 1.75;
	/** Caps the drawing buffer on very large screens; the points stay sharp well below this. */
	const MAX_CANVAS_PIXELS = 4_200_000;
	/** Share of the art region's shorter side the form and its ring fill. */
	const FORM_FILL = 0.6;
	const MORPH_SECONDS = 2.6;
	const HOLD_SECONDS = 7;
	const DRIFT_PER_SECOND = 0.12;
	const REST_YAW = 0.6;
	const REST_PITCH = 0.22;
	const KEY_TURNS: Record<string, [number, number]> = {
		ArrowLeft: [-0.35, 0],
		ArrowRight: [0.35, 0],
		ArrowUp: [0, -0.15],
		ArrowDown: [0, 0.15]
	};

	let root = $state<HTMLDivElement>();
	let copyBox = $state<HTMLDivElement>();
	let art = $state<HTMLDivElement>();
	let canvas = $state<HTMLCanvasElement>();
	let status = $state<Status>('pending');
	let formIndex = $state(0);
	let paused = $state(false);
	let reducedMotion = $state(false);
	let particleCount = $state(0);
	let activeForms = $state<ParticleForm[]>(EDITION_PARTICLE_FORMS);

	const form = $derived(activeForms[formIndex]);
	const unit = $derived(glyphs ? 'letters' : 'points');
	const pad = (value: number) => String(value).padStart(2, '0');

	// Frame state changes every frame, so it stays outside Svelte's reactivity.
	let field: ParticleField | null = null;
	const frame: FieldFrame = {
		from: 0,
		to: 0,
		morph: 0,
		yaw: REST_YAW,
		pitch: REST_PITCH,
		pointerX: 0,
		pointerY: 0,
		pointerStrength: 0,
		pointerTrail: new Float32Array(POINTER_TRAIL_SAMPLES * POINTER_TRAIL_STRIDE),
		burst: 0,
		time: 0,
		scan: -9
	};
	let yawTarget = REST_YAW;
	let pitchTarget = REST_PITCH;
	let pointerTarget = 0;
	let trailIndex = 0;
	let trailSavedAt = 0;
	let pointerKnown = false;
	let pointerMovedAt = 0;
	// The first form is already assembled; bursts only follow an explicit scatter or interrupted morph.
	let burstAge = Infinity;
	let held = 0;
	let raf = 0;
	let last = 0;
	let inView = false;
	let pageVisible = true;
	let dragId = -1;
	let dragX = 0;
	let dragY = 0;
	let dragMoved = false;

	const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

	/** A barely perceptible pulse, then fall back into the form. */
	function burstEnvelope(age: number) {
		const envelope =
			age < 0.22 ? Math.sin((age / 0.22) * Math.PI * 0.5) : Math.exp(-(age - 0.22) * 2.4);
		return envelope * 0.03;
	}

	function settled() {
		return (
			frame.morph >= 1 &&
			frame.burst < 0.002 &&
			frame.pointerStrength < 0.002 &&
			pointerTarget < 0.002 &&
			frame.pointerTrail.every((value, index) => index % 4 !== 2 || value < 0.002) &&
			Math.abs(yawTarget - frame.yaw) < 0.0005 &&
			Math.abs(pitchTarget - frame.pitch) < 0.0005
		);
	}

	function step(now: number) {
		raf = 0;
		if (!field) return;
		const dt = Math.min((now - last) / 1000, 0.05);
		last = now;
		const moving = !paused && !reducedMotion;
		frame.time += dt;

		if (reducedMotion) {
			frame.morph = 1;
			frame.yaw = yawTarget;
			frame.pitch = pitchTarget;
			frame.burst = 0;
			frame.pointerStrength = pointerTarget = 0;
			frame.pointerTrail.fill(0);
		} else {
			frame.morph = Math.min(1, frame.morph + dt / MORPH_SECONDS);
			if (moving && dragId < 0) {
				yawTarget += dt * DRIFT_PER_SECOND;
				held += dt;
				if (held > HOLD_SECONDS && frame.morph >= 1) {
					showForm((frame.to + 1) % activeForms.length);
				}
			}
			const ease = 1 - Math.exp(-dt * 6);
			frame.yaw += (yawTarget - frame.yaw) * ease;
			frame.pitch += (pitchTarget - frame.pitch) * ease;
			pointerTarget = decayPointerTarget(pointerTarget, dt);
			frame.pointerStrength = easePointerStrength(frame.pointerStrength, pointerTarget, dt);
			advancePointerTrail(frame.pointerTrail, dt);
			burstAge += dt;
			frame.burst = burstEnvelope(burstAge);
		}
		frame.scan = moving ? ((frame.time * 0.2) % 1) * 3 - 1.5 : -9;

		field.render(frame);
		if (!raf && (moving || !settled())) raf = requestAnimationFrame(step);
	}

	/** Draws at least one more frame; the loop then keeps itself alive only while something moves. */
	function schedule() {
		if (raf || !field || !inView || !pageVisible) return;
		last = performance.now();
		raf = requestAnimationFrame(step);
	}

	function halt() {
		cancelAnimationFrame(raf);
		raf = 0;
	}

	function showForm(index: number) {
		held = 0;
		if (index === frame.to) return;
		// Changing form mid-transition skips ahead, so a short scatter hides the jump.
		if (frame.morph < 1 && !reducedMotion) burstAge = Math.min(burstAge, 0.22);
		frame.from = frame.to;
		frame.to = index;
		frame.morph = reducedMotion ? 1 : 0;
		formIndex = index;
		schedule();
	}

	function scatter() {
		held = 0;
		if (reducedMotion) return;
		burstAge = 0;
		schedule();
	}

	/** Text, links and controls keep their own pointer behaviour; open space belongs to the form. */
	function onInterface(target: EventTarget | null) {
		return target instanceof Element && !!target.closest('a, button, [data-hero-ui]');
	}

	function trackPointer(event: PointerEvent) {
		if (!root) return;
		const rect = root.getBoundingClientRect();
		const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		const y = 1 - ((event.clientY - rect.top) / rect.height) * 2;
		const now = performance.now();
		if (pointerKnown && !reducedMotion && dragId < 0 && !onInterface(event.target)) {
			const dx = x - frame.pointerX;
			const dy = y - frame.pointerY;
			const distance = Math.hypot((dx * rect.width) / 2, (dy * rect.height) / 2);
			if (distance > 0.2) {
				const saved = savePointerTrailSample({
					trail: frame.pointerTrail,
					trailIndex,
					lastSavedAt: trailSavedAt,
					now,
					x: frame.pointerX,
					y: frame.pointerY,
					strength: frame.pointerStrength
				});
				trailIndex = saved.trailIndex;
				trailSavedAt = saved.lastSavedAt;
				const speed = (distance * 1000) / Math.max(now - pointerMovedAt, 8);
				// Small, slow gestures barely stir the grains; stronger sweeps build up gradually.
				pointerTarget = pointerStrengthFromSpeed(speed);
			}
		}
		if (!pointerKnown && !reducedMotion && dragId < 0 && !onInterface(event.target)) {
			pointerTarget = 0;
		}
		frame.pointerX = x;
		frame.pointerY = y;
		pointerKnown = true;
		pointerMovedAt = now;
	}

	function onpointerdown(event: PointerEvent) {
		if (event.button !== 0 || status !== 'live' || onInterface(event.target)) return;
		dragId = event.pointerId;
		dragX = event.clientX;
		dragY = event.clientY;
		dragMoved = false;
		root?.setPointerCapture(event.pointerId);
		trackPointer(event);
		schedule();
	}

	function onpointermove(event: PointerEvent) {
		if (dragId === event.pointerId) {
			const dx = event.clientX - dragX;
			const dy = event.clientY - dragY;
			if (!dragMoved && Math.abs(dx) + Math.abs(dy) < 6) return;
			dragMoved = true;
			yawTarget += dx * 0.008;
			pitchTarget = clamp(pitchTarget + dy * 0.005, -0.3, 0.9);
			dragX = event.clientX;
			dragY = event.clientY;
		} else if (event.pointerType !== 'mouse') {
			return;
		}
		trackPointer(event);
		schedule();
	}

	function onpointerup(event: PointerEvent) {
		if (dragId !== event.pointerId) return;
		dragId = -1;
		if (!dragMoved) scatter();
		if (event.pointerType !== 'mouse') pointerTarget = 0;
	}

	function onpointercancel(event: PointerEvent) {
		if (dragId === event.pointerId) dragId = -1;
		pointerTarget = 0;
	}

	function onpointerleave(event: PointerEvent) {
		if (event.pointerType === 'mouse') pointerTarget = 0;
		pointerKnown = false;
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.target !== event.currentTarget) return;
		const turn = KEY_TURNS[event.key];
		if (turn) {
			yawTarget += turn[0];
			pitchTarget = clamp(pitchTarget + turn[1], -0.3, 0.9);
		} else if (event.key === 'Home') {
			yawTarget = REST_YAW;
			pitchTarget = REST_PITCH;
		} else if (event.key === ' ' || event.key === 'Enter') {
			scatter();
		} else {
			return;
		}
		event.preventDefault();
		held = 0;
		schedule();
	}

	function togglePause() {
		paused = !paused;
		held = 0;
		schedule();
	}

	onMount(() => {
		const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
		reducedMotion = motionQuery.matches;
		const compact =
			window.matchMedia('(max-width: 640px), (pointer: coarse)').matches ||
			(navigator.hardwareConcurrency ?? 8) <= 4;
		const density = glyphs ? DENSITY.glyphs : DENSITY.points;
		const tier = compact ? 1 : 0;
		particleCount = density.form[tier];
		if (reducedMotion) {
			frame.morph = 1;
			burstAge = Infinity;
		}

		const listeners = new AbortController();
		const { signal } = listeners;
		let resize: ResizeObserver | undefined;
		let visibility: IntersectionObserver | undefined;

		const start = (
			letters?: ParticleGlyphs,
			editionPoints: Readonly<Record<string, Float32Array>> = {}
		) => {
			if (signal.aborted) return;
			if (!Object.values(editionPoints).some((points) => points.length > 0)) {
				status = 'fallback';
				return;
			}
			const cloud = buildParticleCloud(particleCount, density.dust[tier], {
				...density.clusters,
				editionPoints
			});
			activeForms = cloud.formDefinitions;
			formIndex = Math.floor(Math.random() * activeForms.length);
			frame.from = frame.to = formIndex;
			const options = {
				pointScale: density.size[tier],
				maxPointSize: density.maxSize,
				glyphs: letters
			};
			field = canvas ? ParticleField.create(canvas, cloud, options) : null;
			if (!field || !canvas || !root || !art) {
				field?.dispose();
				field = null;
				status = 'fallback';
				return;
			}
			status = 'live';

			motionQuery.addEventListener(
				'change',
				(event) => {
					reducedMotion = event.matches;
					schedule();
				},
				{ signal }
			);
			document.addEventListener(
				'visibilitychange',
				() => {
					pageVisible = document.visibilityState === 'visible';
					if (pageVisible) schedule();
					else halt();
				},
				{ signal }
			);
			canvas.addEventListener(
				'webglcontextlost',
				(event) => {
					event.preventDefault();
					halt();
					field = null;
					status = 'fallback';
				},
				{ signal }
			);

			const host = root;
			const anchor = art;
			const fit = () => {
				const box = host.getBoundingClientRect();
				const region = anchor.getBoundingClientRect();
				const focus: FieldFocus = {
					x: region.left - box.left + region.width * (box.width > 960 ? 0.44 : 0.5),
					y: region.top - box.top + region.height * (box.width > 960 ? 0.4 : 0.5),
					radius: Math.min(region.width, region.height) * (box.width > 960 ? FORM_FILL : 0.46)
				};
				const pixelRatio = Math.min(
					window.devicePixelRatio || 1,
					MAX_PIXEL_RATIO,
					Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, box.width * box.height))
				);
				field?.resize(box.width, box.height, pixelRatio, focus);
				schedule();
			};
			fit();
			resize = new ResizeObserver(fit);
			resize.observe(host);
			resize.observe(anchor);

			visibility = new IntersectionObserver(([entry]) => {
				inView = entry.isIntersecting;
				if (inView) schedule();
				else halt();
			});
			visibility.observe(host);
		};

		// Edition points and, when needed, the headline glyph atlas load together. Missing edition
		// clouds are omitted; the production hero never substitutes unrelated conceptual forms.
		const points = loadEditionParticles(signal, fetch, base).catch(() => ({}));
		const letters =
			glyphs && copyBox
				? glyphs(copyBox, particleCount + density.dust[tier])
				: Promise.resolve(undefined);
		void Promise.all([letters, points]).then(
			([loadedLetters, loadedPoints]) => start(loadedLetters, loadedPoints),
			() => {
				if (!signal.aborted) status = 'fallback';
			}
		);

		return () => {
			listeners.abort();
			resize?.disconnect();
			visibility?.disconnect();
			halt();
			field?.dispose();
			field = null;
		};
	});
</script>

<!-- The whole hero is the artwork's canvas; disable text selection during interaction. -->
<div
	id="particle-hero"
	bind:this={root}
	class:is-live={status === 'live'}
	class:is-fallback={status === 'fallback'}
	class:is-minimal={minimal}
	{onpointerdown}
	{onpointermove}
	{onpointerup}
	{onpointercancel}
	{onpointerleave}
>
	<canvas bind:this={canvas} aria-hidden="true"></canvas>
	<div class="veil" aria-hidden="true"></div>

	<div class="stage">
		<div bind:this={copyBox} class="copy" data-hero-ui>
			{@render copy()}
		</div>

		<!-- The art region hosts no element of its own; the keys are the keyboard equivalent of dragging. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
		<div
			bind:this={art}
			class="art"
			role="group"
			aria-label={status === 'live'
				? `Published edition ${glyphs ? 'letterform' : 'particle'} artwork: ${form.title}`
				: '3D edition particle artwork'}
			aria-describedby={minimal ? 'particle-hero-hint' : 'particle-hero-hint particle-hero-note'}
			tabindex={status === 'live' ? 0 : -1}
			{onkeydown}
		>
			{#if !minimal}
				<span class="crop crop-tl" aria-hidden="true"></span>
				<span class="crop crop-tr" aria-hidden="true"></span>
				<span class="crop crop-bl" aria-hidden="true"></span>
				<span class="crop crop-br" aria-hidden="true"></span>

				<div class="plate-bar" aria-hidden="true">
					<span>Form {pad(formIndex + 1)} / {pad(activeForms.length)}</span>
					<span>
						{particleCount
							? `${particleCount.toLocaleString('en-GB')} ${unit} · `
							: ''}{form.sourceSlug ? 'Mesh sample' : 'Procedural'}
					</span>
				</div>
			{/if}

			{#if status === 'fallback'}
				<div class="fallback">
					<p>The interactive edition artwork is unavailable.</p>
				</div>
			{/if}

			{#if status === 'live'}
				<div class="model-navigation" class:minimal-navigation={minimal} data-hero-ui>
					<button
						type="button"
						aria-label="Previous model"
						onclick={() => showForm((formIndex - 1 + activeForms.length) % activeForms.length)}
						><span aria-hidden="true">‹</span></button
					>
					<p class="source-credit">
						{#if form.sourceSlug}
							<a href={resolve('/editions/[slug]', { slug: form.sourceSlug })}>
								{form.sourceTitle ?? form.title}
								<span aria-hidden="true">↗</span>
							</a>
						{/if}
					</p>
					<button
						type="button"
						aria-label="Next model"
						onclick={() => showForm((formIndex + 1) % activeForms.length)}
						><span aria-hidden="true">›</span></button
					>
				</div>
			{/if}
			{#if minimal && status === 'live'}
				{#if !reducedMotion}
					<button
						type="button"
						class="minimal-pause sr-only focus:not-sr-only"
						aria-label={paused ? 'Resume artwork motion' : 'Pause artwork motion'}
						aria-pressed={paused}
						onclick={togglePause}
					>
						<span aria-hidden="true">{paused ? '▶' : 'Ⅱ'}</span>
					</button>
				{/if}
			{/if}
		</div>

		{#if foot}
			<div class="foot" data-hero-ui>
				{@render foot()}
			</div>
		{/if}
	</div>

	{#if minimal}
		<p id="particle-hero-hint" class="sr-only">
			{#if status === 'live'}
				Published edition mesh sample. Drag or use the arrow keys to turn the form; press Space to
				scatter it and Home to reset the view.
			{:else if status === 'fallback'}
				The interactive edition artwork is unavailable.
			{:else}
				The interactive edition artwork is loading.
			{/if}
		</p>
	{:else}
		<div class="rail" data-hero-ui>
			<div class="caption">
				<span class="kicker"
					>{form.sourceSlug ? 'Published mesh sample' : 'Conceptual artwork · not a scan'}</span
				>
				<p class="title">{form.title}</p>
				<p id="particle-hero-note" class="note">
					{form.note} Vermillion clusters stand for the annotations an edition attaches to its model.
					{#if glyphs}
						Each particle is a letter set from the text on this page.
					{/if}
				</p>
			</div>
			<div class="tools">
				{#if status === 'live'}
					<div class="controls">
						<div class="forms" role="group" aria-label="Choose a form">
							{#each activeForms as item, index (item.id)}
								<button
									type="button"
									aria-pressed={index === formIndex}
									onclick={() => showForm(index)}
								>
									<span class="index" aria-hidden="true">{pad(index + 1)}</span>
									<span class="label">{item.label}</span>
								</button>
							{/each}
						</div>
						{#if !reducedMotion}
							<button type="button" class="pause" aria-pressed={paused} onclick={togglePause}>
								Pause motion
							</button>
						{/if}
					</div>
					<p id="particle-hero-hint" class="hint">
						{reducedMotion
							? 'Drag or use the arrow keys to turn the focused form; Home resets the view.'
							: 'Move across the form to disperse it. Click, tap or press Space to scatter and reassemble; drag or use the arrow keys to turn it.'}
					</p>
				{:else}
					<p id="particle-hero-hint" class="hint">
						A procedural point cloud standing for the objects PURE3D editions document.
					</p>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.minimal-pause:focus-visible {
		position: absolute;
		z-index: 3;
		right: 0;
		top: 0;
		width: 44px;
		height: 44px;
		border: 1px solid color-mix(in srgb, var(--color-hero-content) 28%, transparent);
		border-radius: var(--radius-control);
		background: var(--color-hero-bg);
		color: var(--color-hero-content);
		cursor: pointer;
	}
	.minimal-pause:focus-visible {
		outline: 2px solid var(--color-hero-content);
		outline-offset: 3px;
	}
	.minimal-navigation button {
		opacity: 0.7;
	}
	#particle-hero {
		--hero-ink: var(--color-hero-bg);
		--hero-paper: var(--color-hero-content);
		width: 100%;
		position: relative;
		isolation: isolate;
		overflow: hidden;
		display: grid;
		grid-template-rows: minmax(0, 1fr) auto;
		min-height: clamp(640px, calc(100vh - 77px), 1040px);
		min-height: clamp(640px, calc(100svh - 77px), 1040px);
		background:
			radial-gradient(ellipse 58% 72% at 72% 44%, var(--color-hero-glow) 0%, var(--hero-ink) 100%),
			var(--hero-ink);
		color: var(--hero-paper);
		touch-action: pan-y;
		-webkit-user-select: none;
		user-select: none;
		cursor: grab;
	}
	#particle-hero:active {
		cursor: grabbing;
	}
	#particle-hero::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 1;
		pointer-events: none;
		background-image:
			linear-gradient(color-mix(in srgb, var(--hero-paper) 4.5%, transparent) 1px, transparent 1px),
			linear-gradient(
				90deg,
				color-mix(in srgb, var(--hero-paper) 4.5%, transparent) 1px,
				transparent 1px
			);
		background-size: 72px 72px;
		mask-image: radial-gradient(ellipse 70% 80% at 72% 46%, black 10%, transparent 72%);
	}

	canvas {
		position: absolute;
		inset: 0;
		z-index: 0;
		display: block;
		width: 100%;
		height: 100%;
		opacity: 0;
		transition: opacity 1.4s ease;
	}
	.is-live canvas {
		opacity: 1;
	}

	/*
	 * Keeps the copy on a calm, dark field whatever the particles are doing behind it. The stops
	 * follow the centred copy column rather than the viewport edge, so wide screens stay covered.
	 */
	.veil {
		position: absolute;
		inset: 0;
		z-index: 1;
		pointer-events: none;
		background:
			linear-gradient(
				90deg,
				color-mix(in srgb, var(--hero-ink) 94%, transparent) 0%,
				color-mix(in srgb, var(--hero-ink) 82%, transparent) calc(50% - 160px),
				color-mix(in srgb, var(--hero-ink) 40%, transparent) calc(50% - 20px),
				transparent calc(50% + 120px)
			),
			linear-gradient(
				0deg,
				color-mix(in srgb, var(--hero-ink) 92%, transparent) 0%,
				transparent 24%
			);
	}

	.stage,
	.rail {
		position: relative;
		z-index: 2;
		width: 100%;
		max-width: 1480px;
		margin: 0 auto;
		padding-inline: clamp(20px, 4vw, 48px);
	}
	.stage {
		display: grid;
		grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
		grid-template-rows: minmax(0, 1fr) auto;
		column-gap: clamp(32px, 5vw, 72px);
		row-gap: 12px;
		padding-block: clamp(48px, 6vw, 88px) 20px;
	}
	.copy {
		grid-column: 1;
		grid-row: 1 / span 2;
		align-self: center;
		display: grid;
		gap: 32px;
		min-width: 0;
		cursor: auto;
	}

	.art {
		position: relative;
		grid-column: 2;
		grid-row: 1;
		min-height: clamp(400px, 58vh, 700px);
		min-height: clamp(400px, 58svh, 700px);
		border-radius: var(--radius-surface);
		cursor: inherit;
	}
	.art:focus-visible {
		outline: 2px solid var(--color-vermillion);
		outline-offset: 4px;
	}

	.crop {
		position: absolute;
		width: 22px;
		height: 22px;
		border-color: var(--color-vermillion);
		border-style: solid;
		border-width: 0;
		pointer-events: none;
	}
	.crop-tl {
		top: 0;
		left: 0;
		border-top-width: 2px;
		border-left-width: 2px;
	}
	.crop-tr {
		top: 0;
		right: 0;
		border-top-width: 2px;
		border-right-width: 2px;
	}
	.crop-bl {
		bottom: 0;
		left: 0;
		border-bottom-width: 2px;
		border-left-width: 2px;
	}
	.crop-br {
		right: 0;
		bottom: 0;
		border-right-width: 2px;
		border-bottom-width: 2px;
	}

	.plate-bar {
		position: absolute;
		top: 4px;
		right: 34px;
		left: 34px;
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 4px 12px;
		font-family: var(--font-mono);
		font-size: 10.5px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--hero-paper) 72%, transparent);
		pointer-events: none;
	}

	.fallback {
		position: absolute;
		inset: 36px 0 0;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 16px;
		padding: 32px;
		border-radius: var(--radius-surface);
		background: var(--color-paper);
		color: var(--color-base-content);
		text-align: center;
		cursor: auto;
	}
	.fallback p {
		margin: 0;
		max-width: 36ch;
		font: italic 400 16px/1.45 var(--font-serif);
		color: var(--color-ink-3);
	}
	.model-navigation {
		position: absolute;
		right: 0;
		bottom: 0;
		left: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		cursor: auto;
	}
	.model-navigation button {
		opacity: 0.1;
		flex: 0 0 44px;
		width: 44px;
		height: 44px;
		border-radius: var(--radius-control);
		color: color-mix(in srgb, var(--hero-paper) 75%, transparent);
		font-size: 34px;
		line-height: 1;
		cursor: pointer;
		transition:
			opacity 0.25s ease,
			color 0.18s ease,
			background 0.18s ease;
	}
	.model-navigation:hover button,
	.model-navigation:focus-within button {
		opacity: 0.85;
	}
	.model-navigation button:hover {
		color: var(--hero-paper);
		background: color-mix(in srgb, var(--hero-paper) 8%, transparent);
	}
	.model-navigation button:focus-visible {
		outline: 2px solid var(--hero-paper);
		outline-offset: 2px;
	}
	@media (hover: none) {
		.model-navigation button {
			opacity: 0.5;
		}
	}
	.source-credit {
		min-width: 0;
		margin: 0;
		font: 10px/1.45 var(--font-mono);
		letter-spacing: 0.015em;
		color: color-mix(in srgb, var(--hero-paper) 58%, transparent);
		cursor: auto;
		text-align: center;
	}
	.source-credit a {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		min-height: 44px;
		padding: 0 12px;
		border: 1px solid color-mix(in srgb, var(--hero-paper) 28%, transparent);
		border-radius: var(--radius-control);
		color: var(--hero-paper);
		font-size: 11px;
		font-weight: 600;
		text-decoration: none;
		transition:
			border-color 0.18s ease,
			background 0.18s ease;
	}
	.source-credit a:hover {
		border-color: var(--hero-paper);
		background: color-mix(in srgb, var(--hero-paper) 8%, transparent);
	}
	.model-navigation.minimal-navigation {
		right: 54px;
		bottom: 64px;
		left: auto;
		width: min(560px, calc(100% - 54px));
	}
	.is-fallback {
		cursor: auto;
	}

	.foot {
		grid-column: 2;
		grid-row: 2;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px 16px;
		min-width: 0;
		cursor: auto;
	}

	.rail {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
		align-items: start;
		gap: 20px clamp(32px, 5vw, 72px);
		padding-block: 22px clamp(24px, 3vw, 36px);
		cursor: auto;
	}
	.rail::before {
		content: '';
		position: absolute;
		top: 0;
		right: clamp(20px, 4vw, 48px);
		left: clamp(20px, 4vw, 48px);
		height: 1px;
		background: color-mix(in srgb, var(--hero-paper) 16%, transparent);
	}
	.caption {
		display: grid;
		gap: 6px;
		min-width: 0;
	}
	.kicker {
		font-family: var(--font-mono);
		font-size: 10.5px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-hero-accent);
	}
	.title {
		margin: 0;
		font: 500 22px/1.15 var(--font-sans);
		letter-spacing: -0.015em;
		color: var(--hero-paper);
	}
	.note {
		margin: 0;
		max-width: 56ch;
		font: italic 400 15px/1.45 var(--font-serif);
		color: color-mix(in srgb, var(--hero-paper) 74%, transparent);
	}

	.tools {
		display: grid;
		gap: 10px;
		min-width: 0;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	/* Eight forms sit in two even rows of four at every width, so the labels never overflow. */
	.forms {
		flex: 1 1 100%;
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 6px;
	}
	.forms button {
		min-width: 0;
		padding: 0 10px;
	}
	.label {
		min-width: 0;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.controls button {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		padding: 0 14px;
		border: 1px solid color-mix(in srgb, var(--hero-paper) 28%, transparent);
		border-radius: var(--radius-control);
		background: color-mix(in srgb, var(--hero-ink) 55%, transparent);
		color: var(--hero-paper);
		font: 500 14px/1 var(--font-sans);
		cursor: pointer;
		transition:
			border-color 0.18s ease,
			background 0.18s ease;
	}
	.controls button:hover {
		border-color: var(--hero-paper);
	}
	.controls button[aria-pressed='true'] {
		border-color: var(--hero-paper);
		background: var(--hero-paper);
		color: var(--hero-ink);
	}
	.controls button:focus-visible {
		outline: 2px solid var(--color-vermillion);
		outline-offset: 3px;
	}
	.index {
		font-family: var(--font-mono);
		font-size: 10.5px;
		letter-spacing: 0.06em;
		color: var(--color-hero-accent);
	}
	[aria-pressed='true'] .index {
		color: var(--color-vermillion-ink);
	}
	.controls .pause {
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.hint {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 1.5;
		letter-spacing: 0.02em;
		color: color-mix(in srgb, var(--hero-paper) 66%, transparent);
	}

	@media (max-width: 960px) {
		.model-navigation.minimal-navigation {
			right: 0;
			bottom: 0;
			left: 0;
			width: 100%;
			transform: translateY(100%);
		}
		.source-credit {
			font-size: 10px;
		}
		#particle-hero {
			min-height: 0;
			background:
				radial-gradient(
					ellipse 90% 34% at 50% 20%,
					var(--color-hero-glow) 0%,
					var(--hero-ink) 100%
				),
				var(--hero-ink);
		}
		#particle-hero::before {
			mask-image: radial-gradient(ellipse 90% 30% at 50% 20%, black 10%, transparent 80%);
		}
		.veil {
			background: linear-gradient(
				180deg,
				transparent 0,
				transparent min(76vw, 440px),
				color-mix(in srgb, var(--hero-ink) 70%, transparent) calc(min(76vw, 440px) + 160px),
				color-mix(in srgb, var(--hero-ink) 78%, transparent) 100%
			);
		}
		.stage {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: none;
			row-gap: 20px;
			padding-block: 20px 12px;
		}
		.art {
			order: -1;
			grid-column: 1;
			grid-row: auto;
			min-height: 0;
			height: clamp(280px, 76vw, 440px);
			max-height: 56svh;
		}
		.copy {
			grid-column: 1;
			grid-row: auto;
			padding-top: 12px;
		}
		.is-minimal .stage {
			padding-block: 36px 100px;
		}
		.is-minimal .copy {
			gap: 24px;
			padding-top: 64px;
		}
		.foot {
			grid-column: 1;
			grid-row: auto;
		}
		.rail {
			grid-template-columns: minmax(0, 1fr);
			padding-top: 20px;
		}
	}

	@media (max-width: 640px) {
		.is-minimal .copy {
			padding-top: 0;
		}
		.is-minimal .veil {
			background: linear-gradient(
				180deg,
				color-mix(in srgb, var(--hero-ink) 85%, transparent) 0,
				transparent 65%
			);
		}
		.model-navigation.minimal-navigation {
			transform: translateY(calc(100% + 16px));
		}
		.is-minimal .stage {
			padding-top: 28px;
		}
		.is-minimal .art {
			order: 0;
			margin-top: 0;
		}
		.plate-bar {
			right: 30px;
			left: 30px;
			font-size: 10px;
		}
		.forms button {
			flex-direction: column;
			justify-content: center;
			gap: 3px;
			padding: 6px 4px;
			font-size: 13px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		canvas,
		.controls button {
			transition: none;
		}
	}
</style>
