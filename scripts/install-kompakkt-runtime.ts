/** Build the separately licensed, standalone Kompakkt runtime; never use a hosted viewer. */
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const revision = 'aefc60962643e030e1a12385fd83db1f0c71e400';
const recipe = 'pure3d-standalone-5';
const root = resolve(import.meta.dir, '..');
const target = join(root, 'static/kompakkt');
const assetOrigin = new URL(
	process.env.PUBLIC_ASSET_BASE_URL || 'https://api.pure3d.eu/assets'
).origin;
const marker = `${revision}:${recipe}:${assetOrigin}`;
if (
	(await Bun.file(join(target, 'runtime-version.txt')).text().catch(() => '')) === marker &&
	(await Bun.file(join(target, 'index.html')).exists())
) {
	console.log('Self-hosted Kompakkt runtime is ready.');
	process.exit(0);
}

function run(command: string[], cwd: string) {
	const result = Bun.spawnSync(command, {
		cwd,
		stdout: 'inherit',
		stderr: 'inherit',
		env: { ...process.env, NG_CLI_ANALYTICS: 'false' }
	});
	if (result.exitCode !== 0) throw new Error(`Kompakkt build failed: ${command[0]}`);
}

const temporaryRoot = join(tmpdir(), 'opencode');
await mkdir(temporaryRoot, { recursive: true });
const work = await mkdtemp(join(temporaryRoot, 'kompakkt-build-'));
const source = join(work, 'source');
const output = join(work, 'runtime');

try {
	run(['git', 'clone', '--filter=blob:none', '--no-checkout', 'https://github.com/Kompakkt/Viewer.git', source], work);
	run(['git', 'checkout', '--detach', revision], source);
	async function replace(path: string, before: string, after: string) {
		const file = join(source, path);
		const text = await readFile(file, 'utf8');
		if (!text.includes(before)) throw new Error(`Unexpected upstream source: ${path}`);
		await writeFile(file, text.replace(before, after));
	}

	// Standalone mode needs no Kompakkt account, repository or backend.
	await writeFile(join(source, 'src/environment.ts'),
		"export const environment = { server_url: './backend-disabled/', repo_url: './' };\n");
	await replace('src/app/app.config.ts', 'provideHttpClient(withInterceptors([jwtInterceptor]))', 'provideHttpClient()');
	const processing = 'src/app/services/processing/processing.service.ts';
	await replace(processing, 'effect, inject, signal', 'effect, inject, signal, untracked');
	const bridge = await readFile(join(root, 'scripts/kompakkt-persistent-bridge.ts.txt'), 'utf8');
	await replace(processing, '  constructor() {', `${bridge}\n\n  constructor() {\n    this.installPure3dBridge();`);
	await replace(processing,
		"this.message.error('Connection to entity server to load entity refused.');\n        return this.loadFallbackEntity();",
		`this.message.error('The model could not load.');
        if (window.parent !== window) window.parent.postMessage({
          type: 'pure3d:kompakkt:initial-error', resource: url,
        }, location.origin);
        this.bootstrapped.set(true);
        throw error;`);
	await replace('src/app/services/babylon/babylon.service.ts',
		'this.scene.meshes.forEach(mesh => mesh.dispose());',
		'[...this.scene.meshes].forEach(mesh => mesh.dispose(false, true));');
	await replace('src/app/services/babylon/babylon.service.ts',
		'this.scene.lights.forEach(light => light.dispose());',
		'[...this.scene.lights].forEach(light => light.dispose());');
	await replace('src/app/services/babylon/babylon.service.ts',
		'if (clearScene) this.clearScene();',
		`const deferClear = clearScene && (mediaType === 'model' || mediaType === 'entity');
    const previousMeshes = deferClear ? [...this.scene.meshes] : [];
    const previousLights = deferClear ? [...this.scene.lights] : [];
    if (clearScene && !deferClear) this.clearScene();`);
	await replace('src/app/services/babylon/babylon.service.ts',
		`this.updateLoadingText(progress),
        ).then(result => {
          this.containers.entity.set(result);`,
		`this.updateLoadingText(progress),
        ).then(result => {
          previousMeshes.forEach(mesh => mesh.dispose(false, true));
          previousLights.forEach(light => light.dispose());
          this.containers.entity.set(result);`);
	await replace('src/app/services/babylon/orbit-gizmo.ts',
		'scene.createDefaultEnvironment({ createGround: false, createSkybox: false });',
		`scene.createDefaultEnvironment({ createGround: false, createSkybox: false,
      environmentTexture: new URL('assets/skyboxes/studio.env', document.baseURI).href });`);
	await replace('src/app/services/babylon/babylon.service.ts',
		`this.scene.createDefaultEnvironment(
      this.isTransparent()
        ? {
            createGround: false,
            createSkybox: false,
          }
        : {},
    );`,
		`this.scene.createDefaultEnvironment({
      createGround: false,
      createSkybox: false,
      environmentTexture: new URL('assets/skyboxes/studio.env', document.baseURI).href,
    });`);
	await replace('src/app/services/babylon/babylon.service.ts',
		"import { DracoDecoder } from '@babylonjs/core';",
		`import { DracoDecoder, MeshoptCompression, KhronosTextureContainer2 } from '@babylonjs/core';
import { BasisToolsOptions } from '@babylonjs/core/Misc/basis';
const localAsset = (path: string) => new URL('assets/' + path, document.baseURI).href;
MeshoptCompression.Configuration = { decoder: { url: localAsset('meshopt/meshopt_decoder.js') } };
BasisToolsOptions.JSModuleURL = localAsset('basis/basis_transcoder.js');
BasisToolsOptions.WasmModuleURL = localAsset('basis/basis_transcoder.wasm');
KhronosTextureContainer2.URLConfig = {
  jsDecoderModule: localAsset('ktx2/decoder.js'),
  wasmUASTCToASTC: localAsset('ktx2/wasm/uastc_astc.wasm'),
  wasmUASTCToBC7: localAsset('ktx2/wasm/uastc_bc7.wasm'),
  wasmUASTCToRGBA_UNORM: localAsset('ktx2/wasm/uastc_rgba8_unorm_v2.wasm'),
  wasmUASTCToRGBA_SRGB: localAsset('ktx2/wasm/uastc_rgba8_srgb_v2.wasm'),
  wasmUASTCToR8_UNORM: localAsset('ktx2/wasm/uastc_r8_unorm.wasm'),
  wasmUASTCToRG8_UNORM: localAsset('ktx2/wasm/uastc_rg8_unorm.wasm'),
  jsMSCTranscoder: localAsset('ktx2/msc_basis_transcoder.js'),
  wasmMSCTranscoder: localAsset('ktx2/wasm/msc_basis_transcoder.wasm'),
  wasmZSTDDecoder: localAsset('ktx2/wasm/zstddec.wasm'),
};`);

	run(['bun', 'install', '--frozen-lockfile'], source);
	// Pin the optional texture decoder to the same Babylon release as the viewer.
	run(['bun', 'add', '--exact', '@babylonjs/ktx2decoder@9.32.1'], source);
	const assets = join(source, 'src/assets');
	for (const [from, to] of [['Basis', 'basis'], ['meshopt', 'meshopt']] as const) {
		await cp(join(source, 'node_modules/@babylonjs/core/assets', from), join(assets, to), { recursive: true });
	}
	await cp(join(source, 'node_modules/@babylonjs/ktx2decoder/wasm'), join(assets, 'ktx2/wasm'), { recursive: true });
	await cp(join(source, 'node_modules/@babylonjs/ktx2decoder/wasm/msc_basis_transcoder.js'), join(assets, 'ktx2/msc_basis_transcoder.js'));
	run(['bun', 'x', '--no-install', 'esbuild', 'node_modules/@babylonjs/ktx2decoder/index.js', '--bundle', '--format=iife', '--global-name=KTX2DECODER', '--outfile=src/assets/ktx2/decoder.js'], source);
	run(['bun', 'run', 'build', '--base-href', './', '--source-map=false', '--optimization=true'], source);
	await cp(join(source, 'dist/viewer/browser'), output, { recursive: true });

	// A restrictive policy prevents backend/CDN fallbacks, including from decoder workers.
	const policy = `default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${assetOrigin}; font-src 'self' data:; connect-src 'self' blob: ${assetOrigin}; worker-src 'self' blob:; media-src 'self' blob: ${assetOrigin}; object-src 'none'; base-uri 'self'; form-action 'none'`;
	const index = join(output, 'index.html');
	await writeFile(index, (await readFile(index, 'utf8'))
		.replace('media="print" onload="this.media=\'all\'"', 'media="all"')
		.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`));
	await cp(join(source, 'LICENSE'), join(output, 'LICENSE'));
	await cp(import.meta.filename, join(source, 'pure3d-build.ts'));
	await cp(join(root, 'scripts/kompakkt-persistent-bridge.ts.txt'), join(source, 'pure3d-persistent-bridge.ts.txt'));
	await writeFile(join(source, 'PURE3D-SOURCE.md'),
		`Kompakkt Viewer ${revision}, modified for standalone Pure3D hosting. AGPL-3.0; see LICENSE.\nBuild with Bun: bun install --frozen-lockfile && bun run build --base-href ./ --source-map=false --optimization=true.\nThe included pure3d-build.ts records runtime packaging and local decoder setup.\nDependency sources are pinned in package.json and bun.lock.\n`);
	run(['tar', '--exclude=.git', '--exclude=node_modules', '--exclude=dist', '--exclude=.angular', '-czf', join(output, 'source.tar.gz'), '.'], source);
	await writeFile(join(output, 'runtime-version.txt'), marker);
	await mkdir(dirname(target), { recursive: true });
	// Leave an existing working runtime intact until its replacement has built successfully.
	const previous = `${target}.previous`;
	await rm(previous, { recursive: true, force: true });
	const hadPrevious = await Bun.file(join(target, 'index.html')).exists();
	if (hadPrevious) await rename(target, previous);
	try {
		await cp(output, target, { recursive: true });
	} catch (error) {
		await rm(target, { recursive: true, force: true });
		if (hadPrevious) await rename(previous, target);
		throw error;
	}
	await rm(previous, { recursive: true, force: true });
	console.log(`Built self-hosted Kompakkt ${revision}.`);
} finally {
	await rm(work, { recursive: true, force: true });
}
