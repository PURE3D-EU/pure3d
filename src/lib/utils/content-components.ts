export const calloutStyles = ['info', 'success', 'warning'] as const;
export type CalloutStyle = (typeof calloutStyles)[number];
export const cmsColumnCounts = [2, 3, 4] as const;
export type CmsColumnCount = (typeof cmsColumnCounts)[number];

export interface ProfileCard {
	name: string;
	role: string;
	bio: string;
	image: string;
	alt: string;
	links: ProfileLink[];
}

export interface ProfileLink {
	label: string;
	href: string;
}

export interface LogoItem {
	name: string;
	image: string;
	alt: string;
	href: string;
}

export interface ProjectFact {
	label: string;
	value: string;
}

export interface ContentImage {
	src: string;
	alt: string;
	caption: string;
	width?: number | null;
}

export const maxContentImageWidth = 9999;

const editionIdPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const pocketbaseIdPattern = /^[a-z0-9]{15}$/;
export const maxEditionReferences = 24;
export const maxOpenCallReferences = 24;
export const maxProfileCards = 12;
export const maxProfileLinks = 8;
export const maxLogoItems = 24;
export const maxProjectFacts = 16;

function text(value: unknown, maxLength: number) {
	if (typeof value !== 'string') return '';
	const normalised = value.trim();
	return normalised.length <= maxLength && !/[<>]/.test(normalised) ? normalised : '';
}

function optionalText(value: unknown, maxLength: number) {
	if (value == null || value === '') return '';
	const normalised = text(value, maxLength);
	return normalised || null;
}

function hasUnsafeUrlCharacters(value: string) {
	return (
		/\s/.test(value) ||
		Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code < 32 || code === 127;
		})
	);
}

function safeRelativeUrl(value: string) {
	if (!/^\/(?!\/|\\)/.test(value) || hasUnsafeUrlCharacters(value)) return null;
	try {
		const decoded = decodeURIComponent(value);
		return /^\/(?!\/|\\)/.test(decoded) ? value : null;
	} catch {
		return null;
	}
}

export function safeContentUrl(value: string): string | null {
	const url = value.trim();
	if (!url || url.length > 2048 || hasUnsafeUrlCharacters(url)) return null;
	const localUrl = safeRelativeUrl(url);
	if (localUrl) return localUrl;
	try {
		const parsed = new URL(url);
		if (['http:', 'https:'].includes(parsed.protocol))
			return parsed.hostname && !parsed.username && !parsed.password ? url : null;
		return parsed.protocol === 'mailto:' && /^[^@\s]+@[^@\s]+$/.test(parsed.pathname) ? url : null;
	} catch {
		return null;
	}
}

export function safeContentImageUrl(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const url = value.trim();
	if (!url || url.length > 2048 || hasUnsafeUrlCharacters(url)) return null;
	const localUrl = safeRelativeUrl(url);
	if (localUrl) return localUrl;
	try {
		const parsed = new URL(url);
		return ['http:', 'https:'].includes(parsed.protocol) &&
			parsed.hostname &&
			!parsed.username &&
			!parsed.password
			? url
			: null;
	} catch {
		return null;
	}
}

export function parseEditionIds(value: string): string[] {
	return Array.from(
		new Set(
			value
				.split(',')
				.map((id) => id.trim())
				.filter((id) => editionIdPattern.test(id))
		)
	).slice(0, maxEditionReferences);
}

export function serialiseEditionIds(ids: string[]): string {
	const validIds = Array.from(
		new Set(ids.map((id) => id.trim()).filter((id) => editionIdPattern.test(id)))
	);
	if (validIds.length > maxEditionReferences)
		throw new RangeError(`Select at most ${maxEditionReferences} editions.`);
	return validIds.join(',');
}

export function parseOpenCallIds(value: string): string[] {
	return Array.from(
		new Set(
			value
				.split(',')
				.map((id) => id.trim())
				.filter((id) => pocketbaseIdPattern.test(id))
		)
	).slice(0, maxOpenCallReferences);
}

export function serialiseOpenCallIds(ids: string[]): string {
	const validIds = Array.from(
		new Set(ids.map((id) => id.trim()).filter((id) => pocketbaseIdPattern.test(id)))
	);
	if (validIds.length > maxOpenCallReferences)
		throw new RangeError(`Select at most ${maxOpenCallReferences} open calls.`);
	return validIds.join(',');
}

export function isCalloutStyle(value: string | null): value is CalloutStyle {
	return calloutStyles.includes(value as CalloutStyle);
}

export function isCmsColumnCount(value: unknown): value is CmsColumnCount {
	return cmsColumnCounts.includes(value as CmsColumnCount);
}

function normaliseProfileLinks(value: unknown, legacyHref: unknown, legacyLabel: unknown) {
	const candidates =
		value == null
			? legacyHref
				? [{ label: legacyLabel || 'Profile', href: legacyHref }]
				: []
			: Array.isArray(value)
				? value
				: null;
	if (!candidates || candidates.length > maxProfileLinks) return null;
	const links = candidates.map((candidate) => {
		if (!candidate || typeof candidate !== 'object') return null;
		const link = candidate as Partial<ProfileLink>;
		const label = text(link.label, 80);
		const href = typeof link.href === 'string' ? safeContentUrl(link.href) : null;
		return label && href ? { label, href } : null;
	});
	return links.every((link) => link) ? (links as ProfileLink[]) : null;
}

export function normaliseProfileCards(value: unknown): ProfileCard[] {
	if (!Array.isArray(value) || value.length > maxProfileCards) return [];
	const cards = value.map((item) => {
		if (!item || typeof item !== 'object') return [];
		const card = item as Partial<ProfileCard> & { href?: unknown; linkLabel?: unknown };
		const name = text(card.name, 120);
		const image = card.image ? safeContentImageUrl(card.image) : '';
		const links = normaliseProfileLinks(card.links, card.href, card.linkLabel);
		const role = optionalText(card.role, 120);
		const bio = optionalText(card.bio, 500);
		const alt = optionalText(card.alt, 240);
		if (!name || (card.image && !image) || !links || role === null || bio === null || alt === null)
			return [];
		return {
			name,
			role,
			bio,
			image: image || '',
			alt,
			links
		};
	});
	return cards.every((card) => card && !Array.isArray(card)) ? (cards as ProfileCard[]) : [];
}

export function normaliseLogoItems(value: unknown): LogoItem[] {
	if (!Array.isArray(value) || value.length > maxLogoItems) return [];
	const logos = value.map((item) => {
		if (!item || typeof item !== 'object') return [];
		const logo = item as Partial<LogoItem>;
		const name = text(logo.name, 120);
		const image = safeContentImageUrl(logo.image);
		const href = logo.href ? safeContentUrl(logo.href) : '';
		const alt = optionalText(logo.alt, 240);
		if (!name || !image || (logo.href && !href) || alt === null) return [];
		return { name, image, alt, href: href || '' };
	});
	return logos.every((logo) => logo && !Array.isArray(logo)) ? (logos as LogoItem[]) : [];
}

export function normaliseProjectFacts(value: unknown): ProjectFact[] {
	if (!Array.isArray(value) || value.length > maxProjectFacts) return [];
	const facts = value.map((item) => {
		if (!item || typeof item !== 'object') return [];
		const fact = item as Partial<ProjectFact>;
		const label = text(fact.label, 120);
		const value = text(fact.value, 500);
		return label && value ? { label, value } : [];
	});
	return facts.every((fact) => fact && !Array.isArray(fact)) ? (facts as ProjectFact[]) : [];
}

export function normaliseContentImageWidth(value: unknown): number | null {
	if (typeof value !== 'number' && typeof value !== 'string') return null;
	if (typeof value === 'string' && !/^[1-9][0-9]*$/.test(value)) return null;
	const width = Number(value);
	return Number.isInteger(width) && width > 0 && width <= maxContentImageWidth ? width : null;
}

export function normaliseContentImage(value: unknown): ContentImage | null {
	if (!value || typeof value !== 'object') return null;
	const image = value as Partial<ContentImage>;
	const src = safeContentImageUrl(image.src);
	if (!src) return null;
	const alt = optionalText(image.alt, 240);
	const caption = optionalText(image.caption, 500);
	if (alt === null || caption === null) return null;
	return { src, alt, caption, width: normaliseContentImageWidth(image.width) };
}
