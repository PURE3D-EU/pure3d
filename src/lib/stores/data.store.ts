/** Catalogue metadata stays in memory; only the public home cards are persisted. */

import { persisted } from 'svelte-persisted-store';
import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { creatorNames, readCredits } from '$lib/utils/credits';
import { pb, cachePrefix } from '$lib/database/client';
import type { Edition, Collection } from '$lib/types/collection';
import { EditionStatus } from '$lib/types/roles';
import {
	getEditionThumbnailUrl,
	getCollectionCoverUrl,
	getEditionRoot,
	getEditionCoverUrl
} from '$lib/utils/asset-urls';
import {
	COLLECTION_CARD_FIELDS,
	EDITION_CARD_FIELDS,
	HOME_COLLECTION_FIELDS,
	HOME_EDITION_FIELDS,
	countEditionsByCollection
} from '$lib/utils/catalogue-performance';

// Store types
interface EditionsData {
	items: Edition[];
	total: number;
	lastFetched: number | null;
}

interface CollectionsData {
	items: (Collection & { editionCount?: number })[];
	total: number;
	lastFetched: number | null;
	countsLastFetched?: number | null;
	countError?: string | null;
}

export const editionsStore = writable<EditionsData>({
	items: [],
	total: 0,
	lastFetched: null
});

export const collectionsStore = writable<CollectionsData>({
	items: [],
	total: 0,
	lastFetched: null,
	countsLastFetched: null,
	countError: null
});

// An auth revision also rejects results from a previous sign-in to the same account.
let authRevision = 0;
if (browser) {
	pb.authStore.onChange(() => {
		authRevision += 1;
		editionsStore.set({ items: [], total: 0, lastFetched: null });
		collectionsStore.set({ items: [], total: 0, lastFetched: null });
	});
}

// The home page needs only a handful of cards, not the full catalogue or its metadata.
export const homeStore = persisted<{
	editions: Edition[];
	collections: (Collection & { editionCount?: number })[];
	editionTotal: number;
	collectionTotal: number;
	lastFetched: number | null;
}>(`${cachePrefix}:home:v1`, {
	editions: [],
	collections: [],
	editionTotal: 0,
	collectionTotal: 0,
	lastFetched: null
});

export async function fetchHomeData() {
	const [editions, collections] = await Promise.all([
		pb.collection('editions').getList(1, 8, {
			filter: 'isPublished = true',
			fields: HOME_EDITION_FIELDS,
			expand: 'collection'
		}),
		pb.collection('collections').getList(1, 5, {
			filter: 'isVisible = true',
			fields: HOME_COLLECTION_FIELDS
		})
	]);
	const value = {
		editions: editions.items.map((record) => {
			const collectionPubNum = record.expand?.collection?.pubNum || 0;
			const legacyThumbnail =
				record.thumbnail && collectionPubNum > 0
					? getEditionThumbnailUrl(collectionPubNum, record.pubNum || 1)
					: '';
			const fileCollectionId = record.collectionId || '';
			const fileCollectionName = record.collectionName || '';
			return {
				id: record.id,
				slug: record.id,
				title: record.dcTitle || record.title,
				credits: readCredits(record.credits),
				thumbnail:
					getEditionCoverUrl({
						id: record.id,
						coverImage: record.coverImage,
						thumbnail: legacyThumbnail,
						fileCollectionId,
						fileCollectionName
					}) || '',
				coverImage: record.coverImage || '',
				fileCollectionId,
				fileCollectionName,
				isPublished: true
			} as Edition;
		}),
		collections: collections.items.map((record) => ({
			id: record.id,
			slug: record.id,
			title: record.title,
			description: record.dcAbstract || '',
			thumbnail: getCollectionCoverUrl(record, record.pubNum) || '',
			isVisible: true
		})) as (Collection & { editionCount?: number })[],
		editionTotal: editions.totalItems,
		collectionTotal: collections.totalItems,
		lastFetched: Date.now()
	};
	homeStore.set(value);
	return value;
}

/**
 * Fetches all published editions from Pocketbase and updates the store.
 * Returns the mapped editions array.
 */
export async function fetchEditions(): Promise<Edition[]> {
	const revision = authRevision;
	const canRequestHidden = pb.authStore.isValid;
	const result = await pb.collection('editions').getFullList({
		filter: canRequestHidden ? undefined : 'isPublished = true',
		expand: 'collection',
		fields: EDITION_CARD_FIELDS,
		$autoCancel: false // Prevent auto-cancellation when fetching in parallel with other requests
	});
	if (revision !== authRevision) return [];

	const mappedEditions = result.map((record) => {
		const collection = record.expand?.collection;
		const collectionPubNum = collection?.pubNum || 0;
		const editionPubNum = record.pubNum || 1;

		// Build voyager URL - use local assets when pubNum is available
		const voyagerUrl = collectionPubNum > 0 ? getEditionRoot(collectionPubNum, editionPubNum) : '';

		// Thumbnail: use asset URL built from pubNums (respects PUBLIC_ASSET_BASE_URL / R2)
		const thumbnail =
			record.thumbnail && collectionPubNum > 0
				? getEditionThumbnailUrl(collectionPubNum, editionPubNum)
				: '';

		return {
			id: record.id,
			slug: record.id,
			title: record.dcTitle || record.title,
			description: record.dcAbstract || '',
			authors: creatorNames(record.credits),
			thumbnail,
			coverImage: (record.coverImage as string | undefined) || '',
			fileCollectionId: record.collectionId || '',
			fileCollectionName: record.collectionName || '',
			collectionName: record.collectionName || 'editions',
			voyagerUrl,
			usageConditions: '',
			alternativeVersion: null,
			tags: Array.isArray(record.dcKeyword) ? record.dcKeyword : [],
			created: record.created,
			// Include Dublin Core fields for filtering
			isPublished: record.isPublished,
			status: (record.status as EditionStatus) || EditionStatus.Published,
			pubNum: record.pubNum,
			collectionId: record.collection,
			dcTitle: record.dcTitle,
			dcSubtitle: record.dcSubtitle,
			dcAbstract: record.dcAbstract,
			dcDescription: record.dcDescription,
			credits: readCredits(record.credits),
			dcInstitution: record.dcInstitution || [],
			dcContact: record.dcContact,
			dcSubject: record.dcSubject || [],
			dcKeyword: record.dcKeyword || [],
			dcAudience: record.dcAudience || [],
			dcLanguage: record.dcLanguage || [],
			dcSource: record.dcSource || [],
			dcCoveragePeriod: record.dcCoveragePeriod || [],
			dcCoveragePlace: record.dcCoveragePlace,
			dcCoverageCountry: record.dcCoverageCountry || [],
			dcCoverageTemporal: record.dcCoverageTemporal,
			dcCoverageGeo: record.dcCoverageGeo,
			dcRightsHolder: record.dcRightsHolder,
			dcRightsLicense: record.dcRightsLicense,
			dcDatePublished: record.dcDatePublished,
			dcDateUnPublished: record.dcDateUnPublished,
			dcDateCreated: record.dcDateCreated,
			dcDateModified: record.dcDateModified,
			dcFunder: record.dcFunder || [],
			dcProvenance: record.dcProvenance,
			dcDoi: record.dcDoi || [],
			peerReviewKind: record.peerReviewKind,
			hasPeerReview: record.hasPeerReview || false,
			peerReviewRequested: false,
			reviewStage: null,
			peerReviewStamp: false,
			publishedAt: null,
			publishedBy: null,
			settingsAuthorToolName: null,
			settingsAuthorToolVersion: null,
			settingsSceneFile: null
		} as Edition;
	});

	editionsStore.set({
		items: mappedEditions,
		total: mappedEditions.length,
		lastFetched: Date.now()
	});

	return mappedEditions;
}

/**
 * Fetches all visible collections from Pocketbase with edition counts and updates the store.
 * Returns the mapped collections array.
 */
export async function refreshCollectionCounts() {
	const revision = authRevision;
	try {
		const editionsResult = await pb.collection('editions').getFullList({
			filter: 'isPublished = true',
			fields: 'id,collection',
			skipTotal: true,
			$autoCancel: false
		});
		if (revision !== authRevision) return;
		const countMap = countEditionsByCollection(editionsResult);
		collectionsStore.update((current) => ({
			...current,
			items: current.items.map((collection) => ({
				...collection,
				editionCount: countMap[collection.id] || 0
			})),
			countsLastFetched: Date.now(),
			countError: null
		}));
	} catch (error) {
		if (revision !== authRevision) return;
		collectionsStore.update((current) => ({
			...current,
			countError: error instanceof Error ? error.message : 'Unable to load edition counts'
		}));
	}
}

export async function fetchCollections(): Promise<(Collection & { editionCount?: number })[]> {
	const revision = authRevision;
	const canRequestHidden = pb.authStore.isValid;
	const collectionsResult = await pb.collection('collections').getFullList({
		sort: 'pubNum',
		filter: canRequestHidden ? undefined : 'isVisible = true',
		fields: COLLECTION_CARD_FIELDS,
		$autoCancel: false
	});
	if (revision !== authRevision) return [];
	let cachedCounts: Record<string, number> = {};
	let cachedCountsLastFetched: number | null = null;
	collectionsStore.subscribe((current) => {
		cachedCounts = Object.fromEntries(
			current.items
				.filter((collection) => collection.editionCount !== undefined)
				.map((collection) => [collection.id, collection.editionCount as number])
		);
		cachedCountsLastFetched = current.countsLastFetched ?? null;
	})();

	const mappedCollections = collectionsResult.map((record) => {
		// Cover image: uploaded coverImage file → legacy thumbnail URL → asset URL from pubNum
		const thumbnail = getCollectionCoverUrl(record, record.pubNum) || '';

		return {
			id: record.id,
			mongoId: record.mongoId || '',
			slug: record.id,
			title: record.title,
			description: record.dcAbstract || '',
			thumbnail,
			fileCollectionId: record.collectionId || '',
			fileCollectionName: record.collectionName || '',
			editionIds: [],
			editionCount: cachedCounts[record.id],
			created: record.created || new Date().toISOString(),
			site: record.site,
			isVisible: record.isVisible,
			lastPublished: record.lastPublished,
			pubNum: record.pubNum,
			dcTitle: record.dcTitle,
			dcSubtitle: record.dcSubtitle,
			dcAbstract: record.dcAbstract,
			dcDescription: record.dcDescription,
			credits: readCredits(record.credits),
			dcInstitution: record.dcInstitution || [],
			dcSubject: record.dcSubject || [],
			dcLanguage: record.dcLanguage || [],
			dcCoveragePeriod: record.dcCoveragePeriod,
			dcCoveragePlace: record.dcCoveragePlace,
			dcDateCreated: record.dcDateCreated,
			dcDateModified: record.dcDateModified
		} as Collection & { editionCount?: number };
	});

	collectionsStore.set({
		items: mappedCollections,
		total: mappedCollections.length,
		lastFetched: Date.now(),
		countsLastFetched: cachedCountsLastFetched,
		countError: null
	});
	void refreshCollectionCounts();

	return mappedCollections;
}

/**
 * Check if cached data is stale (older than maxAge in milliseconds).
 * Default maxAge is 5 minutes.
 */
export function isStale(lastFetched: number | null, maxAge = 5 * 60 * 1000): boolean {
	if (!lastFetched) return true;
	return Date.now() - lastFetched > maxAge;
}
