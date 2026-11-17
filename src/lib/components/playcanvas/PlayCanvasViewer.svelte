<script lang="ts">
	import { onMount } from 'svelte';

	let { url, title }: { url: string; title: string } = $props();
	let canvas: HTMLCanvasElement;
	let host: HTMLDivElement;
	let loading = $state(true);
	let error = $state('');
	let resetView = $state<(() => void) | null>(null);
	let rotateView = $state<((key: string) => void) | null>(null);
	let attempt = $state(0);
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});

	$effect(() => {
		if (!mounted) return;
		const resource = url;
		void attempt;
		let disposed = false;
		let app: import('playcanvas').Application | undefined;
		let observer: ResizeObserver | undefined;
		loading = true;
		error = '';
		resetView = null;
		rotateView = null;
		const timeout = setTimeout(() => {
			if (loading && !disposed) {
				error = 'The model took too long to load. Try another model or retry.';
				loading = false;
				disposed = true;
				observer?.disconnect();
				app?.destroy();
				app = undefined;
			}
		}, 60_000);

		async function open() {
			try {
				const [pc, { CameraControls }] = await Promise.all([
					import('playcanvas'),
					import('playcanvas/scripts/esm/camera-controls.mjs')
				]);
				if (disposed) return;
				const viewer = new pc.Application(canvas, {
					graphicsDeviceOptions: { alpha: false, antialias: true }
				});
				app = viewer;
				viewer.setCanvasFillMode(pc.FILLMODE_NONE);
				viewer.setCanvasResolution(pc.RESOLUTION_AUTO);
				viewer.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio, 2);
				viewer.scene.ambientLight = new pc.Color(0.65, 0.65, 0.65);
				const camera = new pc.Entity('Camera');
				camera.addComponent('camera', {
					clearColor: new pc.Color(0.094, 0.094, 0.094),
					fov: 45,
					nearClip: 0.01,
					farClip: 100
				});
				camera.setPosition(0, 0, 3);
				viewer.root.addChild(camera);
				camera.addComponent('script');
				const controls = camera.script!.create(CameraControls, {
					properties: { enableFly: false, focusPoint: new pc.Vec3() }
				});
				for (const [pitch, yaw, intensity] of [
					[45, 35, 1.5],
					[-30, -140, 0.7]
				]) {
					const light = new pc.Entity('Light');
					light.addComponent('light', { type: 'directional', intensity });
					light.setEulerAngles(pitch, yaw, 0);
					viewer.root.addChild(light);
				}
				const resize = () => viewer.resizeCanvas(host.clientWidth, host.clientHeight);
				observer = new ResizeObserver(resize);
				observer.observe(host);
				resize();
				// Stop drawing when this surface or browser tab is not visible.
				viewer.autoRender = false;
				viewer.on('update', () => {
					const rect = canvas.getBoundingClientRect();
					viewer.renderNextFrame =
						!document.hidden && rect.bottom > 0 && rect.top < window.innerHeight;
				});
				viewer.start();
				viewer.assets.loadFromUrl(resource, 'container', (reason, asset) => {
					if (disposed) {
						asset?.unload();
						return;
					}
					clearTimeout(timeout);
					try {
						if (reason || !asset?.resource)
							throw new Error('The model or its textures could not load.');
						const model = asset.resource.instantiateRenderEntity();
						const pivot = new pc.Entity('Model frame');
						pivot.addChild(model);
						viewer.root.addChild(pivot);
						const meshes = model.findComponents('render').flatMap((render) => render.meshInstances);
						if (!meshes.length) throw new Error('This asset contains no renderable mesh.');
						const bounds = meshes[0].aabb.clone();
						for (const mesh of meshes.slice(1)) bounds.add(mesh.aabb);
						const radius = bounds.halfExtents.length();
						if (!Number.isFinite(radius) || radius <= 0)
							throw new Error('The model has invalid bounds.');
						pivot.setLocalScale(1 / radius, 1 / radius, 1 / radius);
						pivot.setLocalPosition(bounds.center.clone().mulScalar(-1 / radius));
						resetView = () => {
							pivot.setLocalEulerAngles(0, 0, 0);
							const aspect = host.clientWidth / Math.max(host.clientHeight, 1);
							const halfFov = Math.atan(Math.tan(Math.PI / 8) * Math.min(aspect, 1));
							camera.setPosition(
								new pc.Vec3(1, 0.6, 1.5).normalize().mulScalar(1.15 / Math.sin(halfFov))
							);
							camera.lookAt(pc.Vec3.ZERO);
							if (controls) controls.focusPoint = new pc.Vec3();
						};
						rotateView = (key) => {
							pivot.rotateLocal(
								key === 'ArrowUp' ? -10 : key === 'ArrowDown' ? 10 : 0,
								key === 'ArrowLeft' ? -10 : key === 'ArrowRight' ? 10 : 0,
								0
							);
						};
						resetView();
						loading = false;
					} catch (reason) {
						error = reason instanceof Error ? reason.message : 'The model could not load.';
						loading = false;
					}
				});
			} catch {
				if (!disposed) {
					observer?.disconnect();
					app?.destroy();
					app = undefined;
					clearTimeout(timeout);
					loading = false;
					error = 'PlayCanvas could not start. This viewer requires WebGL 2 support.';
				}
			}
		}
		void open();
		return () => {
			disposed = true;
			clearTimeout(timeout);
			observer?.disconnect();
			app?.destroy();
		};
	});
</script>

<div id="play-canvas-viewer" class="space-y-3">
	<div bind:this={host} class="relative h-[495px] overflow-hidden rounded-lg bg-neutral">
		<canvas
			bind:this={canvas}
			tabindex="0"
			aria-label={`PlayCanvas 3D viewer: ${title}`}
			aria-describedby="playcanvas-controls"
			onkeydown={(event) => {
				if (rotateView && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
					event.preventDefault();
					rotateView(event.key);
				}
			}}
			class="block h-full w-full touch-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
		></canvas>
		{#if loading || error}
			<div
				class="absolute inset-x-3 bottom-3 space-y-2 rounded-lg bg-base-100/95 p-3 text-sm text-base-content"
			>
				<p role="status">{error || 'Loading the model from PURE3D assets…'}</p>
				{#if error}
					<button type="button" class="btn btn-outline btn-sm" onclick={() => (attempt += 1)}
						>Try again</button
					>
				{/if}
			</div>
		{/if}
	</div>
	<div class="flex flex-wrap items-center justify-between gap-3">
		<p id="playcanvas-controls" class="text-sm text-base-content/70">
			Drag to orbit · Scroll or pinch to zoom · Shift and drag to pan · Focus the viewer and use
			arrow keys to rotate
		</p>
		<button
			type="button"
			class="btn btn-outline btn-sm"
			disabled={!resetView || loading || !!error}
			onclick={() => resetView?.()}>Reset view</button
		>
	</div>
</div>
