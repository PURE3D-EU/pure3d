import { base } from '$app/paths';
import { pb } from '$lib/database/client';

function currentOwner() {
	const record = pb.authStore.isValid ? pb.authStore.record : null;
	return record?.id
		? `${record.collectionName || record.collectionId || 'users'}:${record.id}`
		: null;
}

let previousOwner = currentOwner();
let leavingOwner = false;
function guardOwnerChange() {
	const owner = currentOwner();
	const ownerChanged = previousOwner !== null && previousOwner !== owner;
	previousOwner = owner;
	if (!ownerChanged || leavingOwner) return;
	leavingOwner = true;
	// Drop all authorised PageData, component state and viewer resources in the old document.
	// Initial ORCID sign-in and same-owner token/profile refreshes must finish normally.
	window.location.replace(`${base}/`);
}

// PocketBase forwards both this tab's auth updates and cross-tab storage events.
pb.authStore.onChange(guardOwnerChange);
// A history-restored document may have missed auth events while frozen in the back/forward cache.
window.addEventListener('pageshow', guardOwnerChange);

// This static SPA authenticates directly with PocketBase, never via a server cookie.
document.cookie = 'pb_auth=; path=/; max-age=0; SameSite=Lax';

// Retire shared caches that could contain unpublished metadata and billing credentials.
try {
	for (const key of Object.keys(localStorage)) {
		if (/^pure3d(?::.*)?:(editions|collections)(?::.*)?$/.test(key)) {
			localStorage.removeItem(key);
		}
	}
	localStorage.removeItem('gemini-api-key');
	localStorage.removeItem('gemini-model');
} catch {
	// Storage may be disabled; the catalogue and Imagine no longer depend on it.
}
