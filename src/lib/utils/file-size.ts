export async function fetchFileSize(url: string, signal: AbortSignal): Promise<number | null> {
	try {
		const response = await fetch(url, { method: 'HEAD', signal });
		const length = response.headers.get('content-length');
		if (!response.ok || length === null || length.trim() === '') return null;
		const size = Number(length);
		return Number.isSafeInteger(size) && size >= 0 ? size : null;
	} catch {
		return null;
	}
}
