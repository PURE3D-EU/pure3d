export interface ViewerFetchOptions {
	root: () => string;
	overrides?: () => { url: string; content: string | Blob; contentType?: string }[] | undefined;
	companions?: () => { baseDir: string; byBasename: Record<string, string> } | undefined;
	progress?: (total: number, loaded: number) => void;
	assetRequest?: (event: ViewerAssetRequestEvent) => void;
	sceneDocument?: () => string | undefined;
	documentLoaded?: (source: unknown) => void;
}

export type ViewerAssetRequestEvent = {
	id: number;
	url: string;
	kind: 'model' | 'asset';
} & ({ type: 'start' } | { type: 'response'; total: number | null } | { type: 'finish' });

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type FetchHost = { fetch: Fetch };
type Registration = { options: ViewerFetchOptions; active: boolean };
const registries = new WeakMap<
	FetchHost,
	{ native: Fetch; dispatch: Fetch; entries: Registration[] }
>();
const assetExtension = /\.(glb|gltf|obj|ply|bin|jpg|jpeg|png|webp|ktx2|draco)$/i;
const modelExtension = /\.(glb|gltf|obj|ply)$/i;
let nextRequestId = 0;

async function observeDocument(response: Response, entry: Registration): Promise<Response> {
	if (!response.ok || !entry.options.documentLoaded) return response;
	try {
		const source: unknown = await response.clone().json();
		if (entry.active) entry.options.documentLoaded(source);
	} catch {
		// Leave invalid documents and aborted requests to Voyager's own error handling.
	}
	return response;
}

function companionUrl(requested: string, options: ViewerFetchOptions): string | null {
	const assets = options.companions?.();
	if (!assets) return null;
	try {
		const url = new URL(requested);
		const directory = new URL(assets.baseDir);
		const prefix = directory.pathname.replace(/\/?$/, '/');
		if (
			url.origin !== directory.origin ||
			!url.pathname.startsWith(prefix) ||
			url.searchParams.has('token')
		)
			return null;
		const name = decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/') + 1));
		const dot = name.lastIndexOf('.');
		const stem = dot >= 0 ? name.slice(0, dot) : name;
		const extension = dot >= 0 ? name.slice(dot) : '';
		const key =
			stem
				.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
				.replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '_')
				.replace(/_+/g, '_')
				.replace(/^_|_$/g, '') + extension.toLowerCase();
		return assets.byBasename[key] ?? null;
	} catch {
		return null;
	}
}

async function trackedResponse(
	response: Response,
	entry: Registration,
	responseStarted: (total: number | null) => void,
	finish: () => void
): Promise<Response> {
	const size = Number(response.headers.get('content-length'));
	const total = Number.isFinite(size) && size > 0 ? size : null;
	responseStarted(total);
	if (!response.body) {
		finish();
		return response;
	}
	if (entry.active && total) entry.options.progress?.(total, 0);
	const reader = response.body.getReader();
	let finished = false;
	const complete = () => {
		if (finished) return;
		finished = true;
		finish();
	};
	const stream = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const { done, value } = await reader.read();
				if (done) {
					controller.close();
					reader.releaseLock();
					complete();
					return;
				}
				if (entry.active) entry.options.progress?.(0, value.length);
				controller.enqueue(value);
			} catch (error) {
				controller.error(error);
				reader.releaseLock();
				complete();
			}
		},
		async cancel(reason) {
			try {
				await reader.cancel(reason);
			} finally {
				reader.releaseLock();
				complete();
			}
		}
	});
	return new Response(stream, {
		headers: response.headers,
		status: response.status,
		statusText: response.statusText
	});
}

/** A shared dispatcher prevents one viewer's teardown from restoring another's stale hooks. */
export function installViewerFetch(host: FetchHost, options: ViewerFetchOptions) {
	let registry = registries.get(host);
	if (!registry) {
		const native = host.fetch;
		const entries: Registration[] = [];
		const dispatch: Fetch = async (input, init) => {
			const requested =
				typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
			if (
				(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase() !== 'GET'
			)
				return native.call(host, input, init);
			for (const entry of [...entries].reverse()) {
				const sceneDocument = requested === entry.options.sceneDocument?.();
				const override = entry.options.overrides?.()?.find((item) => item.url === requested);
				if (override) {
					const response = new Response(override.content, {
						headers: { 'content-type': override.contentType ?? 'application/json' }
					});
					return sceneDocument ? observeDocument(response, entry) : response;
				}
				if (sceneDocument) return observeDocument(await native.call(host, input, init), entry);
				const mapped = companionUrl(requested, entry.options);
				let tracked = false;
				try {
					const url = new URL(requested);
					const root = new URL(entry.options.root());
					tracked =
						url.origin === root.origin &&
						url.pathname.startsWith(root.pathname.replace(/\/?$/, '/')) &&
						assetExtension.test(url.pathname);
				} catch {
					/* Non-URL requests are passed through without tracking. */
				}
				if (!mapped && !tracked) continue;
				const redirected =
					mapped && mapped !== requested
						? input instanceof Request
							? new Request(mapped, input)
							: mapped
						: input;
				if (!tracked) return await native.call(host, redirected, init);
				const kind = modelExtension.test(requested) ? 'model' : 'asset';
				const id = ++nextRequestId;
				entry.options.assetRequest?.({ type: 'start', id, url: requested, kind });
				let finished = false;
				const finish = () => {
					if (finished) return;
					finished = true;
					if (entry.active)
						entry.options.assetRequest?.({ type: 'finish', id, url: requested, kind });
				};
				try {
					const response = await native.call(host, redirected, init);
					return entry.options.progress || entry.options.assetRequest
						? trackedResponse(
								response,
								entry,
								(total) =>
									entry.active &&
									entry.options.assetRequest?.({
										type: 'response',
										id,
										url: requested,
										kind,
										total
									}),
								finish
							)
						: response;
				} catch (error) {
					finish();
					throw error;
				}
			}
			return native.call(host, input, init);
		};
		registry = { native, dispatch, entries };
		registries.set(host, registry);
		host.fetch = dispatch;
	}
	const entry = { options, active: true };
	registry.entries.push(entry);
	return () => {
		if (!entry.active) return;
		entry.active = false;
		registry.entries.splice(registry.entries.indexOf(entry), 1);
		if (!registry.entries.length) {
			if (host.fetch === registry.dispatch) host.fetch = registry.native;
			registries.delete(host);
		}
	};
}
