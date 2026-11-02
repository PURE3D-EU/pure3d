export interface VoyagerAudioReader {
	get: (url: string) => Promise<ArrayBuffer>;
	loadingManager: { itemEnd: (url: string) => void };
}

/** Backport Voyager 0.66's failed-audio bookkeeping without changing the hosted runtime. */
export function repairLegacyAudioLoading(reader: VoyagerAudioReader, version: string) {
	const match = /^0\.(\d+)\./.exec(version);
	if (!match || Number(match[1]) >= 66) return () => {};
	const original = reader.get;
	const installed: VoyagerAudioReader['get'] = (url) => {
		return original.call(reader, url).catch((error: unknown) => {
			// Older AudioReaders call itemError but omit itemEnd on HTTP/network errors.
			// Keep the rejection: audio has failed, but must not strand the scene's busy flag.
			reader.loadingManager.itemEnd(url);
			throw error;
		});
	};
	reader.get = installed;
	return () => {
		if (reader.get === installed) reader.get = original;
	};
}

export class ViewerResources {
	private controller = new AbortController();
	private timers = new Set<ReturnType<typeof setTimeout>>();
	private cleanups: (() => void)[] = [];
	get disposed() {
		return this.controller.signal.aborted;
	}
	listen(target: EventTarget, type: string, listener: EventListener) {
		target.addEventListener(type, listener, { signal: this.controller.signal });
	}
	timeout(callback: () => void, delay: number) {
		if (this.disposed) return;
		const timer = setTimeout(() => {
			this.timers.delete(timer);
			if (!this.disposed) callback();
		}, delay);
		this.timers.add(timer);
	}
	defer(cleanup: () => void) {
		if (this.disposed) cleanup();
		else this.cleanups.push(cleanup);
	}
	dispose() {
		if (this.disposed) return;
		this.controller.abort();
		for (const timer of this.timers) clearTimeout(timer);
		this.timers.clear();
		for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
	}
}

const pendingScripts = new WeakMap<Document, Promise<void>>();
export function ensureViewerScript(
	document: Document,
	registry: Pick<CustomElementRegistry, 'get'>,
	url: string
): Promise<void> {
	if (registry.get('voyager-explorer')) return Promise.resolve();
	const pending = pendingScripts.get(document);
	if (pending) return pending;
	const load = new Promise<void>((resolve, reject) => {
		const script = document.createElement('script');
		script.src = url;
		script.addEventListener('load', () => resolve(), { once: true });
		script.addEventListener(
			'error',
			() => {
				pendingScripts.delete(document);
				script.remove();
				reject(new Error('The 3D viewer could not be loaded.'));
			},
			{ once: true }
		);
		document.head.appendChild(script);
	});
	pendingScripts.set(document, load);
	return load;
}

type ErrorHost = Pick<Console, 'error'>;
const errorObservers = new WeakMap<
	ErrorHost,
	{
		original: Console['error'];
		installed: Console['error'];
		listeners: Set<(message: string) => void>;
	}
>();
export function captureViewerErrors(
	listener: (message: string) => void,
	host: ErrorHost = console
) {
	let observers = errorObservers.get(host);
	if (!observers) {
		const original = host.error;
		const listeners = new Set<(message: string) => void>();
		const installed: Console['error'] = (...args: unknown[]) => {
			const message = args.join(' ');
			if (message.includes('Failed to load document') || message.includes('schema validation')) {
				for (const notify of listeners) notify(message);
			}
			original.apply(host, args);
		};
		observers = { original, installed, listeners };
		errorObservers.set(host, observers);
		host.error = installed;
	}
	observers.listeners.add(listener);
	return () => {
		observers.listeners.delete(listener);
		if (!observers.listeners.size) {
			if (host.error === observers.installed) host.error = observers.original;
			errorObservers.delete(host);
		}
	};
}

type CanvasPrototype = Pick<HTMLCanvasElement, 'getContext'>;
const canvasUsers = new WeakMap<
	CanvasPrototype,
	{
		count: number;
		original: HTMLCanvasElement['getContext'];
		installed: HTMLCanvasElement['getContext'];
	}
>();
export function retainCanvasCapture(prototype: CanvasPrototype) {
	let entry = canvasUsers.get(prototype);
	if (!entry) {
		const original = prototype.getContext;
		const installed = function (
			this: HTMLCanvasElement,
			type: string,
			attributes?: Record<string, unknown>
		) {
			return original.call(
				this,
				type,
				type === 'webgl' || type === 'webgl2'
					? { ...attributes, preserveDrawingBuffer: true }
					: attributes
			);
		} as HTMLCanvasElement['getContext'];
		entry = { original, installed, count: 0 };
		canvasUsers.set(prototype, entry);
		prototype.getContext = installed;
	}
	entry.count++;
	let disposed = false;
	return () => {
		if (disposed) return;
		disposed = true;
		if (--entry.count === 0) {
			if (prototype.getContext === entry.installed) prototype.getContext = entry.original;
			canvasUsers.delete(prototype);
		}
	};
}
