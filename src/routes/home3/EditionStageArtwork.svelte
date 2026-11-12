<script lang="ts">
	import { base } from '$app/paths';

	let { stage, alt }: { stage: 'concept' | 'implementation' | 'publication'; alt: string } =
		$props();
</script>

{#snippet callout(line: string, x: number, y: number, first: string, second = '')}
	<path class="leader" pathLength="1" d={line} />
	<text class="label" {x} {y}>
		<tspan {x}>{first}</tspan>
		{#if second}<tspan {x} dy="25">{second}</tspan>{/if}
	</text>
{/snippet}

<svg
	id={`edition-stage-artwork-${stage}`}
	class="edition-stage-artwork"
	data-stage={stage}
	viewBox="0 0 602 524"
	width="602"
	height="524"
	role="img"
	aria-label={alt}
>
	{#if stage === 'implementation'}<path
			class="orbit"
			d="M175 368 C88 379 63 414 98 445 C163 502 386 506 482 442 C517 419 514 393 459 376"
		/>{/if}
	<image
		class="model"
		href={`${base}/images/landing/edition-${stage}-transparent.webp`}
		width="602"
		height="524"
	/>

	{#if stage === 'concept'}
		<g>
			{@render callout('M220 133 L148 92 H121', 29, 61, 'Research', 'question')}
			<circle class="label" cx="220" cy="133" r="4" />
		</g>
		<g class="second-callout">
			{@render callout('M425 155 L478 107 H492', 465, 70, 'Sources and', 'evidence')}
			<circle class="label" cx="425" cy="155" r="4" />
		</g>
		<g class="third-callout">
			{@render callout('M184 250 H174 V402 H184 M174 326 H133', 28, 313, 'Narrative', 'structure')}
		</g>
	{:else if stage === 'implementation'}
		<g>
			<path class="leader" pathLength="1" d="M172 167 L132 115 H108" />
			<circle class="label" cx="172" cy="167" r="4" />
			<text class="label" x="24" y="78">
				<tspan x="24">Contextual</tspan>
				<tspan x="24" dy="25">annotations</tspan>
			</text>
		</g>
		<g class="second-callout">
			<path class="leader" pathLength="1" d="M415 147 L470 104 H487" />
			<circle class="label" cx="415" cy="147" r="4" />
			<text class="label" x="478" y="68">
				<tspan x="478">Connected</tspan>
				<tspan x="478" dy="25">evidence</tspan>
			</text>
		</g>
		<g class="third-callout">
			<path class="leader" pathLength="1" d="M477 445 L505 466 H520" />
			<circle class="label" cx="477" cy="445" r="4" />
			<text class="label" x="576" y="491" text-anchor="end">Guided exploration</text>
		</g>
	{:else}
		<g>
			{@render callout('M161 124 H145 V216 H161', 22, 159, 'Scholarly', 'review')}
		</g>
		<g class="second-callout">
			{@render callout('M452 124 H469 V216 H452', 487, 159, 'Technical', 'review')}
		</g>
		<g class="third-callout">
			<path
				class="leader"
				pathLength="1"
				d="M128 457 V470 Q128 478 142 478 H281 Q301 478 301 487 Q301 478 321 478 H460 Q474 478 474 470 V457"
			/>
			<text class="label" x="301" y="512" text-anchor="middle">Published edition</text>
		</g>
	{/if}
</svg>

<style>
	svg {
		color: var(--color-vermillion-ink);
	}

	:global(html[data-color-scheme='dark']) [data-stage='concept'] .model {
		filter: brightness(0) invert(0.93);
	}

	:global(html[data-color-scheme='dark']) [data-stage='implementation'] .model {
		filter: drop-shadow(0.8px 0 0 var(--color-ink-2));
	}

	.leader,
	.orbit {
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
	}

	.orbit {
		stroke-dasharray: 8 7;
	}

	circle {
		fill: currentColor;
	}

	text {
		fill: var(--color-ink);
		font: italic 23px var(--font-serif);
	}

	@media (prefers-reduced-motion: no-preference) {
		svg {
			--artwork-start: var(--artwork-delay, var(--reveal-delay, 0ms));
		}

		.second-callout {
			--callout-delay: 120ms;
		}

		.third-callout {
			--callout-delay: 240ms;
		}

		:global(.reveal-pending) .leader,
		:global(.reveal-pending) .label,
		:global(.reveal-pending) .orbit {
			opacity: 0;
		}

		:global(.reveal-visible) .leader {
			animation: draw 440ms ease-out calc(var(--artwork-start) + var(--callout-delay, 0ms)) both;
		}

		:global(.reveal-visible) .label {
			animation: appear 260ms ease-out calc(var(--artwork-start) + var(--callout-delay, 0ms)) both;
		}

		:global(.reveal-visible) .orbit {
			animation: appear 400ms ease-out calc(150ms + var(--artwork-start)) both;
		}
	}

	@keyframes draw {
		from {
			opacity: 1;
			stroke-dasharray: 1;
			stroke-dashoffset: 1;
		}
		to {
			opacity: 1;
			stroke-dasharray: 1;
			stroke-dashoffset: 0;
		}
	}

	@keyframes appear {
		to {
			opacity: 1;
		}
	}
</style>
