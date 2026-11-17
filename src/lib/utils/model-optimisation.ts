export type ModelFinding = {
	tone: 'success' | 'warning' | 'error' | 'info';
	title: string;
	detail: string;
};

export type ModelAnalysis = {
	size: number;
	vertices: number;
	triangles: number;
	meshes: number;
	materials: number;
	textures: number;
	findings: ModelFinding[];
	canOptimise: boolean;
};

export type ModelOptimisationOptions = {
	mode: 'lossless' | 'textures';
	/** JPEG encoder quality, between 0.1 and 1. */
	textureQuality: number;
	/** Maximum colour JPEG edge length, between 256 and 8192 pixels. */
	maxTextureSize: number;
};

export type ModelOptimisationResult = {
	file: File;
	before: ModelAnalysis;
	after: ModelAnalysis;
	changes: string[];
	savedBytes: number;
};

export type ModelWorkerJob =
	| { action: 'analyse'; file: File }
	| { action: 'optimise'; file: File; options: ModelOptimisationOptions };

function runWorker<T>(job: ModelWorkerJob, signal?: AbortSignal): Promise<T> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted)
			return reject(new DOMException('Model operation cancelled.', 'AbortError'));
		if (typeof Worker === 'undefined')
			return reject(new Error('Model optimisation requires browser Web Worker support.'));
		const worker = new Worker(new URL('../workers/model-optimisation.worker.ts', import.meta.url), {
			type: 'module'
		});
		const finish = () => {
			worker.terminate();
			signal?.removeEventListener('abort', abort);
		};
		const abort = () => {
			finish();
			reject(new DOMException('Model operation cancelled.', 'AbortError'));
		};
		signal?.addEventListener('abort', abort, { once: true });
		worker.onmessage = (event: MessageEvent<{ result?: T; error?: string }>) => {
			finish();
			if (event.data.error) reject(new Error(event.data.error));
			else resolve(event.data.result as T);
		};
		worker.onerror = (event) => {
			finish();
			reject(new Error(event.message || 'The model worker failed.'));
		};
		worker.onmessageerror = () => {
			finish();
			reject(new Error('The model worker response could not be read.'));
		};
		try {
			worker.postMessage(job);
		} catch (error) {
			finish();
			reject(error);
		}
	});
}

/** Invalid/unsupported GLBs resolve with error findings; cancellation rejects with AbortError. */
export function analyseModel(file: File, signal?: AbortSignal): Promise<ModelAnalysis> {
	return runWorker({ action: 'analyse', file }, signal);
}

/** Never mutates the source File. Cancellation terminates its dedicated worker. */
export function optimiseModel(
	file: File,
	options: ModelOptimisationOptions,
	signal?: AbortSignal
): Promise<ModelOptimisationResult> {
	return runWorker({ action: 'optimise', file, options }, signal);
}
