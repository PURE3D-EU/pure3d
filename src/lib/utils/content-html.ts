import createDOMPurify from 'dompurify';
import { localContentAssetUrl } from './local-content-asset';
import { contentTags, embedHosts, normaliseContentHtml } from '$lib/content';
import {
	isCalloutStyle,
	isCmsColumnCount,
	normaliseContentImage,
	normaliseLogoItems,
	normaliseProfileCards,
	normaliseProjectFacts,
	parseEditionIds,
	parseOpenCallIds,
	safeContentUrl,
	serialiseEditionIds,
	serialiseOpenCallIds
} from './content-components';

const purifier = typeof window !== 'undefined' ? createDOMPurify(window) : null;
purifier?.addHook('afterSanitizeAttributes', (node) => {
	if (node.tagName === 'A') node.setAttribute('rel', 'noopener noreferrer');
	if (node.tagName === 'IMG' && node.hasAttribute('src'))
		node.setAttribute('src', localContentAssetUrl(node.getAttribute('src') || ''));
	for (const attribute of Array.from(node.attributes)) {
		if (attribute.name === 'data-content-image') {
			if (node.tagName !== 'FIGURE' || attribute.value !== 'true')
				node.removeAttribute(attribute.name);
			continue;
		}
		if (!attribute.name.startsWith('data-')) continue;
		if (!attribute.name.startsWith('data-cms-')) {
			if (
				attribute.name === 'data-open-call-ids' &&
				node.tagName === 'DIV' &&
				node.getAttribute('data-cms-open-calls') === 'true'
			)
				continue;
			const profileAttribute =
				[
					'data-name',
					'data-role',
					'data-bio',
					'data-image',
					'data-alt',
					'data-href',
					'data-link-label'
				].includes(attribute.name) &&
				node.tagName === 'ARTICLE' &&
				node.getAttribute('data-cms-profile') === 'true';
			const logoAttribute =
				['data-name', 'data-image', 'data-alt', 'data-href'].includes(attribute.name) &&
				node.tagName === 'FIGURE' &&
				node.getAttribute('data-cms-logo') === 'true';
			const factAttribute =
				['data-label', 'data-value'].includes(attribute.name) &&
				node.tagName === 'DIV' &&
				node.getAttribute('data-cms-project-fact') === 'true';
			if (!profileAttribute && !logoAttribute && !factAttribute)
				node.removeAttribute(attribute.name);
			continue;
		}
		const allowed =
			(attribute.name === 'data-cms-callout' && node.tagName === 'ASIDE') ||
			(attribute.name === 'data-cms-actions' && node.tagName === 'DIV') ||
			(attribute.name === 'data-cms-editions' && node.tagName === 'DIV') ||
			(attribute.name === 'data-cms-open-calls' && node.tagName === 'DIV') ||
			(attribute.name === 'data-open-call-ids' &&
				node.tagName === 'DIV' &&
				node.getAttribute('data-cms-open-calls') === 'true') ||
			(attribute.name === 'data-cms-action' && node.tagName === 'A') ||
			(attribute.name === 'data-cms-expandable' && node.tagName === 'DETAILS') ||
			(attribute.name === 'data-cms-columns' && node.tagName === 'SECTION') ||
			(attribute.name === 'data-cms-column' && node.tagName === 'DIV') ||
			(attribute.name === 'data-cms-profiles' && node.tagName === 'SECTION') ||
			(attribute.name === 'data-cms-profile' && node.tagName === 'ARTICLE') ||
			(attribute.name === 'data-cms-profile-links' &&
				node.tagName === 'DIV' &&
				node.parentElement?.getAttribute('data-cms-profile') === 'true') ||
			(attribute.name === 'data-cms-profile-link' &&
				node.tagName === 'A' &&
				node.parentElement?.getAttribute('data-cms-profile-links') === 'true') ||
			(attribute.name === 'data-cms-logo-grid' && node.tagName === 'DIV') ||
			(attribute.name === 'data-cms-logo' && node.tagName === 'FIGURE') ||
			(attribute.name === 'data-cms-project-facts' && node.tagName === 'DL') ||
			(attribute.name === 'data-cms-project-fact' && node.tagName === 'DIV');
		if (!allowed) node.removeAttribute(attribute.name);
	}
	if (node.tagName === 'ASIDE' && node.hasAttribute('data-cms-callout')) {
		if (!isCalloutStyle(node.getAttribute('data-cms-callout')))
			node.removeAttribute('data-cms-callout');
	}
	if (node.tagName === 'DIV' && node.hasAttribute('data-cms-actions')) {
		if (node.getAttribute('data-cms-actions') !== 'true') node.removeAttribute('data-cms-actions');
	}
	if (node.tagName === 'A' && node.hasAttribute('data-cms-action')) {
		const action = node.getAttribute('data-cms-action');
		if (
			!['primary', 'secondary'].includes(action || '') ||
			node.parentElement?.getAttribute('data-cms-actions') !== 'true' ||
			!safeContentUrl(node.getAttribute('href') || '')
		)
			node.removeAttribute('data-cms-action');
	}
	if (node.tagName === 'DIV' && node.hasAttribute('data-cms-editions')) {
		const ids = serialiseEditionIds(parseEditionIds(node.getAttribute('data-cms-editions') || ''));
		if (ids) node.setAttribute('data-cms-editions', ids);
		else node.remove();
	}
	if (node.tagName === 'DIV' && node.hasAttribute('data-cms-open-calls')) {
		const ids = serialiseOpenCallIds(
			parseOpenCallIds(node.getAttribute('data-open-call-ids') || '')
		);
		if (node.getAttribute('data-cms-open-calls') === 'true' && ids) {
			node.setAttribute('data-open-call-ids', ids);
		} else node.remove();
	}
	if (node.tagName === 'DETAILS' && node.hasAttribute('data-cms-expandable')) {
		if (node.getAttribute('data-cms-expandable') !== 'true')
			node.removeAttribute('data-cms-expandable');
	}
	if (node.tagName === 'SECTION' && node.hasAttribute('data-cms-columns')) {
		if (!isCmsColumnCount(Number(node.getAttribute('data-cms-columns')))) node.remove();
	}
	if (node.tagName === 'DIV' && node.hasAttribute('data-cms-column')) {
		if (node.getAttribute('data-cms-column') !== 'true') node.removeAttribute('data-cms-column');
	}
	if (node.tagName === 'SECTION' && node.hasAttribute('data-cms-profiles')) {
		if (node.getAttribute('data-cms-profiles') !== 'true')
			node.removeAttribute('data-cms-profiles');
	}
	if (node.tagName === 'ARTICLE' && node.hasAttribute('data-cms-profile')) {
		const links = Array.from(
			node.querySelectorAll<HTMLAnchorElement>(
				':scope > [data-cms-profile-links="true"] > a[data-cms-profile-link="true"]'
			)
		).map((link) => ({ label: link.textContent || '', href: link.getAttribute('href') || '' }));
		const legacyLink = node.querySelector<HTMLAnchorElement>('a[href]');
		const profile = normaliseProfileCards([
			{
				name: node.getAttribute('data-name'),
				role: node.getAttribute('data-role'),
				bio: node.getAttribute('data-bio'),
				image: node.getAttribute('data-image'),
				alt: node.getAttribute('data-alt'),
				...(links.length ? { links } : {}),
				href: node.getAttribute('data-href') || legacyLink?.getAttribute('href'),
				linkLabel: node.getAttribute('data-link-label') || legacyLink?.textContent
			}
		])[0];
		if (!profile || node.parentElement?.getAttribute('data-cms-profiles') !== 'true') node.remove();
	}
	if (node.tagName === 'DIV' && node.hasAttribute('data-cms-profile-links')) {
		if (node.getAttribute('data-cms-profile-links') !== 'true')
			node.removeAttribute('data-cms-profile-links');
	}
	if (node.tagName === 'A' && node.hasAttribute('data-cms-profile-link')) {
		if (
			node.getAttribute('data-cms-profile-link') !== 'true' ||
			node.parentElement?.getAttribute('data-cms-profile-links') !== 'true' ||
			!safeContentUrl(node.getAttribute('href') || '')
		)
			node.removeAttribute('data-cms-profile-link');
	}
	if (node.tagName === 'DIV' && node.hasAttribute('data-cms-logo-grid')) {
		if (node.getAttribute('data-cms-logo-grid') !== 'true')
			node.removeAttribute('data-cms-logo-grid');
	}
	if (node.tagName === 'FIGURE' && node.hasAttribute('data-cms-logo')) {
		const logo = normaliseLogoItems([
			{
				name: node.getAttribute('data-name'),
				image: node.getAttribute('data-image'),
				alt: node.getAttribute('data-alt'),
				href: node.getAttribute('data-href')
			}
		])[0];
		if (!logo || node.parentElement?.getAttribute('data-cms-logo-grid') !== 'true') node.remove();
	}
	if (node.tagName === 'DL' && node.hasAttribute('data-cms-project-facts')) {
		if (node.getAttribute('data-cms-project-facts') !== 'true')
			node.removeAttribute('data-cms-project-facts');
	}
	if (node.tagName === 'DIV' && node.hasAttribute('data-cms-project-fact')) {
		const fact = normaliseProjectFacts([
			{ label: node.getAttribute('data-label'), value: node.getAttribute('data-value') }
		])[0];
		if (!fact || node.parentElement?.getAttribute('data-cms-project-facts') !== 'true')
			node.remove();
	}
	if (node.tagName === 'FIGURE' && node.getAttribute('data-content-image') === 'true') {
		const image = node.querySelector(':scope > img');
		if (
			!normaliseContentImage({
				src: image?.getAttribute('src'),
				alt: image?.getAttribute('alt'),
				caption: node.querySelector(':scope > figcaption')?.textContent || ''
			})
		)
			node.remove();
	}
	if (node.tagName !== 'IFRAME') return;
	try {
		const url = new URL(node.getAttribute('src') || '');
		if (!['https:', 'http:'].includes(url.protocol)) {
			node.remove();
			return;
		}
		if (embedHosts.includes(url.hostname)) return;
		const link = node.ownerDocument.createElement('a');
		link.href = url.href;
		link.rel = 'noopener noreferrer';
		link.textContent = 'Open embedded resource ↗';
		node.replaceWith(link);
	} catch {
		node.remove();
	}
});

export function contentText(html: string): string {
	if (typeof window === 'undefined') return '';
	const document = new DOMParser().parseFromString(cleanContent(html), 'text/html');
	for (const element of document.body.querySelectorAll('p, div, li, h2, h3, h4, br')) {
		element.append(document.createTextNode(' '));
	}
	return (document.body.textContent || '').replace(/\s+/g, ' ').trim();
}

export function cleanContent(html: string): string {
	// The application is an SPA; never emit unsanitised HTML during server evaluation.
	if (!purifier) return '';
	const normalised = normaliseContentHtml(html).replace(
		/<(\/?)(h1|b|i)(?=[\s>])/g,
		(_, closing, tag) =>
			`<${closing}${({ h1: 'h2', b: 'strong', i: 'em' } as Record<string, string>)[tag]}`
	);
	return purifier.sanitize(normalised, {
		ALLOWED_TAGS: contentTags,
		ALLOWED_ATTR: [
			'href',
			'src',
			'title',
			'alt',
			'target',
			'rel',
			'allowfullscreen',
			'colspan',
			'rowspan',
			'data-cms-callout',
			'data-cms-actions',
			'data-cms-action',
			'data-cms-editions',
			'data-cms-open-calls',
			'data-open-call-ids',
			'data-cms-expandable',
			'data-cms-columns',
			'data-cms-column',
			'data-cms-profiles',
			'data-cms-profile',
			'data-cms-profile-links',
			'data-cms-profile-link',
			'data-cms-logo-grid',
			'data-cms-logo',
			'data-cms-project-facts',
			'data-cms-project-fact',
			'data-content-image',
			'data-name',
			'data-role',
			'data-bio',
			'data-image',
			'data-alt',
			'data-href',
			'data-link-label',
			'data-label',
			'data-value'
		],
		ALLOW_DATA_ATTR: false
	});
}
