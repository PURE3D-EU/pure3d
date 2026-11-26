import { cleanContent } from '$lib/utils/content-html';
import { pbNormalize, pbStrippedBasename } from '$lib/utils/pb-filename';
import { isTokenExpired } from 'pocketbase';
import { pb } from '$lib/database/client';
import { resolveHttpUrl } from './edition-content';

function legacyAliases(assets: Record<string, string>) {
	const aliases = new Map<string, string | null>();
	for (const value of new Set(Object.values(assets))) {
		const stored = new URL(value).pathname.split('/').pop() || '';
		const match = /^legacy_[a-f0-9]{12}_(.+)$/.exec(pbStrippedBasename(stored));
		if (match) aliases.set(match[1], aliases.has(match[1]) ? null : value);
	}
	return aliases;
}

// Exact migration corrections: the audio matches the article narration and the
// cavernous sinus article references the same illustration as both .jpeg and .jpg.
function correctedMediaName(article: string, name: string) {
	if (article.startsWith('legacy_a548abe78870_') && name === 'CNI in basic.mp3')
		return 'cn1_in_basic.mp3';
	if (article.startsWith('legacy_21a34b06739c_') && name === 'CN3 out clinc.mp3')
		return 'cn3_out_clinic.mp3';
	if (
		article.startsWith('legacy_b9ba34141fee_') &&
		name === 'Contents_of_Cavernous_Sinus_Labeled_.jpeg'
	)
		return 'contents_of_cavernous_sinus_labeled.jpg';
	return '';
}

export function prepareVoyagerArticle(
	html: string,
	articleUrl: string,
	title = '',
	assets: Record<string, string> = {},
	fileToken = ''
): string {
	const cleaned = cleanContent(html, true);
	if (typeof DOMParser === 'undefined') return cleaned;

	const document = new DOMParser().parseFromString(cleaned, 'text/html');
	const heading = document.querySelector('h1, h2');
	if (title && heading?.textContent?.trim() === title.trim()) heading.remove();
	const directory = new URL('.', articleUrl);
	const article = new URL(articleUrl).pathname.split('/').pop() || '';
	const aliases = legacyAliases(assets);
	for (const player of document.querySelectorAll('audio, video'))
		player.setAttribute('controls', '');
	for (const [selector, attribute] of [
		['a[href]', 'href'],
		['img[src], audio[src], video[src], audio > source[src], video > source[src]', 'src'],
		['video[poster]', 'poster']
	]) {
		for (const element of document.querySelectorAll(selector)) {
			const value = element.getAttribute(attribute) || '';
			if (element instanceof HTMLAnchorElement && (/^#/.test(value) || /^mailto:/i.test(value)))
				continue;
			const resolved = resolveHttpUrl(value, articleUrl);
			if (resolved) {
				const url = new URL(resolved);
				const ownFile =
					url.origin === directory.origin && url.pathname.startsWith(directory.pathname);
				let name = url.pathname.split('/').pop() || '';
				try {
					name = decodeURIComponent(name);
				} catch {
					// A literal percent in an old filename must not prevent the article from opening.
				}
				const mapped =
					ownFile &&
					((Object.hasOwn(assets, name) && assets[name]) ||
						(Object.hasOwn(assets, pbNormalize(name)) && assets[pbNormalize(name)]) ||
						aliases.get(pbNormalize(name.toLowerCase())) ||
						aliases.get(correctedMediaName(article, name)));
				if (mapped && new URL('.', mapped).href === directory.href) {
					const target = new URL(mapped);
					if (fileToken && target.searchParams.has('token'))
						target.searchParams.set('token', fileToken);
					for (const [key, value] of url.searchParams)
						if (key !== 'token' && !(/^\d+$/.test(key) && !value))
							target.searchParams.append(key, value);
					target.hash = url.hash;
					element.setAttribute(attribute, target.href);
				} else element.setAttribute(attribute, resolved);
			} else element.removeAttribute(attribute);
		}
	}
	return document.body.innerHTML;
}

/** Renew private file access on article open, not by restarting the scene mid-tour. */
export async function loadVoyagerArticle(
	articleUrl: string,
	assets: Record<string, string>,
	title = '',
	signal?: AbortSignal
) {
	const url = new URL(articleUrl);
	let token =
		Object.values(assets).includes(articleUrl) && url.origin === new URL(pb.baseURL).origin
			? url.searchParams.get('token') || ''
			: '';
	if (token && isTokenExpired(token, 60)) {
		token = await pb.files.getToken({ signal });
		url.searchParams.set('token', token);
	}
	const response = await fetch(url, { signal });
	if (!response.ok) throw new Error(`Story request failed (${response.status})`);
	return prepareVoyagerArticle(await response.text(), articleUrl, title, assets, token);
}
