import { cleanContent } from '$lib/utils/content-html';
import { resolveHttpUrl } from './edition-content';

export function prepareVoyagerArticle(
	html: string,
	articleUrl: string,
	title = '',
	assets: Record<string, string> = {}
): string {
	const cleaned = cleanContent(html);
	if (typeof DOMParser === 'undefined') return cleaned;

	const document = new DOMParser().parseFromString(cleaned, 'text/html');
	const heading = document.querySelector('h1, h2');
	if (title && heading?.textContent?.trim() === title.trim()) heading.remove();
	for (const element of document.querySelectorAll<HTMLAnchorElement | HTMLImageElement>(
		'a[href], img[src]'
	)) {
		const attribute = element instanceof HTMLAnchorElement ? 'href' : 'src';
		const value = element.getAttribute(attribute) || '';
		if (element instanceof HTMLAnchorElement && (/^#/.test(value) || /^mailto:/i.test(value)))
			continue;
		const resolved = resolveHttpUrl(value, articleUrl);
		if (resolved) {
			const url = new URL(resolved);
			const source = new URL(articleUrl);
			const ownFile =
				url.origin === source.origin &&
				url.pathname.startsWith(source.pathname.slice(0, source.pathname.lastIndexOf('/') + 1));
			const mapped = ownFile ? assets[decodeURIComponent(url.pathname.split('/').pop() || '')] : '';
			if (mapped) {
				const target = new URL(mapped);
				for (const [key, value] of url.searchParams)
					if (key !== 'token' && !(/^\d+$/.test(key) && !value))
						target.searchParams.append(key, value);
				target.hash = url.hash;
				element.setAttribute(attribute, target.href);
			} else element.setAttribute(attribute, resolved);
		} else element.removeAttribute(attribute);
	}
	return document.body.innerHTML;
}
