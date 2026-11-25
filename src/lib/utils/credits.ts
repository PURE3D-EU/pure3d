import type { Credit } from '../types/credits';

export function normalizeOrcid(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const id = value
		.trim()
		.replace(/^https?:\/\/orcid\.org\//i, '')
		.toUpperCase();
	if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(id)) return null;
	const digits = id.replaceAll('-', '');
	let total = 0;
	for (const digit of digits.slice(0, 15)) total = (total + Number(digit)) * 2;
	const check = (12 - (total % 11)) % 11;
	return digits[15] === (check === 10 ? 'X' : String(check)) ? `https://orcid.org/${id}` : null;
}

export function readCredits(value: unknown): Credit[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter(
			(credit): credit is Credit =>
				credit !== null &&
				typeof credit === 'object' &&
				(credit.type === 'person' || credit.type === 'org') &&
				typeof credit.name === 'string' &&
				(credit.orcid === null || typeof credit.orcid === 'string') &&
				(credit.role === 'creator' || credit.role === 'contributor') &&
				(credit.provenance === 'manual' || credit.provenance === 'oauth') &&
				(credit.userId === undefined || typeof credit.userId === 'string') &&
				(credit.contributionRole === undefined || typeof credit.contributionRole === 'string')
		)
		.map((credit) => ({ ...credit, orcid: normalizeOrcid(credit.orcid) }));
}

export function creatorNames(value: unknown): string {
	return readCredits(value)
		.filter((credit) => credit.role === 'creator')
		.map((credit) => credit.name)
		.join(', ');
}

export function creditHref(credit: Credit, base = ''): string | null {
	return credit.userId
		? `${base}/profile/${encodeURIComponent(credit.userId)}`
		: normalizeOrcid(credit.orcid);
}

export function validateCredits(credits: Credit[], forPublication = false): string | null {
	if (forPublication && !credits.some((credit) => credit.role === 'creator'))
		return 'Add at least one creator before submitting or publishing.';
	for (const [index, credit] of credits.entries()) {
		if (!credit.name.trim()) return `Credit ${index + 1}: name is required.`;
		if (credit.orcid && !normalizeOrcid(credit.orcid))
			return `Credit ${index + 1}: enter a valid ORCID (including its checksum).`;
	}
	return null;
}
