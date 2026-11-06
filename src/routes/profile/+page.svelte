<script lang="ts">
	import { resolve } from '$app/paths';
	import { authStore } from '$lib/database/stores/auth.svelte';
	import { pb } from '$lib/database/client';
	import { goto } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import { ROLE_LABELS } from '$lib/types/roles';
	import EditionCard from '$lib/components/cards/EditionCard.svelte';
	import CollectionCard from '$lib/components/cards/CollectionCard.svelte';
	import MyWork from '$lib/components/workflow/MyWork.svelte';
	import NewsletterSignup from '$lib/components/ui/NewsletterSignup.svelte';
	import IconPencil from '~icons/lucide/pencil';
	import {
		getCollectionThumbnailUrl,
		getEditionRoot,
		getEditionThumbnailUrl
	} from '$lib/utils/asset-urls';
	import { creatorNames, normalizeOrcid, readCredits } from '$lib/utils/credits';
	import type { RecordModel } from 'pocketbase';

	interface ProfileData {
		displayName: string;
		username: string;
		email: string;
		profilePicture: string;
		profilePictureUrl: string;
		orcid: string;
		affiliation: string;
		titleRole: string;
		bio: string;
		socials: string;
		role: string;
		orcidVerifiedAt: string;
		joinDate: string;
	}

	let profileData = $state<ProfileData | null>(null);
	let isEditing = $state(false);
	let saveMessage = $state('');
	let errorMessage = $state('');
	let isLoading = $state(true);
	let isSaving = $state(false);
	let isRefreshing = $state(false);
	let editions = $state<ReturnType<typeof mapEdition>[]>([]);
	let collections = $state<ReturnType<typeof mapCollection>[]>([]);

	let tempData = $state({
		displayName: '',
		username: '',
		orcid: '',
		affiliation: '',
		titleRole: '',
		bio: '',
		socials: ''
	});
	let profilePictureFile = $state<File | null>(null);
	let profilePicturePreviewUrl = $state('');

	// Load user profile data
	onMount(async () => {
		if (!authStore.isAuthenticated) {
			goto(resolve('/'));
			return;
		}

		await loadProfile();
	});

	onDestroy(() => {
		clearProfilePictureFile();
	});

	function clearProfilePictureFile() {
		profilePictureFile = null;
		if (profilePicturePreviewUrl) URL.revokeObjectURL(profilePicturePreviewUrl);
		profilePicturePreviewUrl = '';
	}

	function selectProfilePicture(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
		clearProfilePictureFile();
		if (!file) return;

		profilePictureFile = file;
		profilePicturePreviewUrl = URL.createObjectURL(file);
	}

	async function loadProfile() {
		try {
			isLoading = true;
			const currentUser = authStore.user;

			if (!currentUser) {
				goto(resolve('/'));
				return;
			}

			const user = await pb.collection('users').getOne(currentUser.id);
			pb.authStore.save(pb.authStore.token, user);
			const profilePicture = user.profilePicture || user.avatar || '';

			profileData = {
				displayName: user.nickname || 'Unnamed user',
				username: user.nickname || '',
				email: user.email,
				profilePicture,
				profilePictureUrl: profilePicture
					? pb.files.getURL(user, profilePicture, { thumb: '200x200' })
					: '',
				orcid: normalizeOrcid(user.orcid) || '',
				affiliation: user.affiliation || '',
				titleRole: user.titleRole || '',
				bio: user.bio || '',
				socials: user.socials || '',
				role: user.role || authStore.globalRole,
				orcidVerifiedAt: user.orcidVerifiedAt || '',
				joinDate: new Date(user.created).toLocaleDateString('en-GB', {
					year: 'numeric',
					month: 'long'
				})
			};
			await loadProfileContent(user.id);
		} catch (error) {
			console.error('Error loading profile:', error);
			errorMessage = 'Failed to load profile data';
		} finally {
			isLoading = false;
		}
	}

	const toArray = (value: unknown): string[] =>
		Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

	function mapEdition(record: RecordModel) {
		const collection = record.expand?.collection;
		const collectionPubNum = collection?.pubNum || 0;
		const editionPubNum = record.pubNum || 1;

		return {
			id: record.id,
			slug: record.id,
			title: record.dcTitle || record.title,
			description: record.dcAbstract || '',
			authors: creatorNames(record.credits),
			thumbnail:
				record.thumbnail && collectionPubNum > 0
					? getEditionThumbnailUrl(collectionPubNum, editionPubNum)
					: '',
			voyagerUrl: collectionPubNum > 0 ? getEditionRoot(collectionPubNum, editionPubNum) : '',
			usageConditions: record.dcRightsLicense || '',
			alternativeVersion: null,
			tags: toArray(record.dcKeyword),
			created: record.created,
			isPublished: record.isPublished,
			pubNum: record.pubNum,
			collectionId: record.collection,
			collection,
			dcTitle: record.dcTitle || null,
			dcSubtitle: record.dcSubtitle || null,
			dcAbstract: record.dcAbstract || null,
			dcDescription: record.dcDescription || null,
			credits: readCredits(record.credits),
			dcInstitution: toArray(record.dcInstitution),
			dcContact: record.dcContact || null,
			dcSubject: toArray(record.dcSubject),
			dcKeyword: toArray(record.dcKeyword),
			dcAudience: toArray(record.dcAudience),
			dcLanguage: toArray(record.dcLanguage),
			dcSource: toArray(record.dcSource),
			dcCoveragePeriod: toArray(record.dcCoveragePeriod),
			dcCoveragePlace: record.dcCoveragePlace || null,
			dcCoverageCountry: toArray(record.dcCoverageCountry),
			dcCoverageTemporal: record.dcCoverageTemporal || null,
			dcCoverageGeo: record.dcCoverageGeo || null,
			dcRightsHolder: record.dcRightsHolder || null,
			dcRightsLicense: record.dcRightsLicense || null,
			dcDatePublished: record.dcDatePublished || null,
			dcDateUnPublished: record.dcDateUnPublished || null,
			dcDateCreated: record.dcDateCreated || null,
			dcDateModified: record.dcDateModified || null,
			dcFunder: toArray(record.dcFunder),
			dcProvenance: record.dcProvenance || null,
			dcDoi: toArray(record.dcDoi),
			peerReviewKind: record.peerReviewKind || null,
			peerReviewContent: record.peerReviewContent || null,
			hasPeerReview: !!record.peerReviewKind && record.peerReviewKind !== 'No peer review',
			peerReviewRequested: record.peerReviewRequested || false,
			reviewStage: record.reviewStage ?? null,
			peerReviewStamp: record.peerReviewStamp || false,
			publishedAt: record.publishedAt || null,
			publishedBy: record.publishedBy || null,
			settingsAuthorToolName: record.settingsAuthorToolName || null,
			settingsAuthorToolVersion: record.settingsAuthorToolVersion || null,
			settingsSceneFile: record.settingsSceneFile || null
		};
	}

	function mapCollection(record: RecordModel, editionCount = 0) {
		return {
			id: record.id,
			slug: record.id,
			title: record.dcTitle || record.title,
			description: record.dcAbstract || '',
			thumbnail:
				record.thumbnail && record.pubNum > 0 ? getCollectionThumbnailUrl(record.pubNum) : '',
			editionIds: [],
			editionCount,
			isVisible: record.isVisible
		};
	}

	async function loadProfileContent(userId: string) {
		const [creditedEditions, creditedCollections] = await Promise.all([
			pb.collection('editions').getFullList({ expand: 'collection' }),
			pb.collection('collections').getFullList()
		]);

		editions = creditedEditions
			.filter(
				(record) =>
					!record.isSandbox &&
					readCredits(record.credits).some((credit) => credit.userId === userId)
			)
			.map(mapEdition);

		const editionCounts: Record<string, number> = {};
		for (const edition of editions) {
			editionCounts[edition.collectionId] = (editionCounts[edition.collectionId] || 0) + 1;
		}

		collections = creditedCollections
			.filter((record) => readCredits(record.credits).some((credit) => credit.userId === userId))
			.map((record) => mapCollection(record, editionCounts[record.id] || 0));
	}

	function startEdit() {
		if (!profileData) return;

		isEditing = true;
		tempData = {
			displayName: profileData.displayName,
			username: profileData.username,
			orcid: profileData.orcid,
			affiliation: profileData.affiliation,
			titleRole: profileData.titleRole,
			bio: profileData.bio,
			socials: profileData.socials
		};
		clearProfilePictureFile();
		saveMessage = '';
		errorMessage = '';
	}

	function cancelEdit() {
		isEditing = false;
		tempData = {
			displayName: profileData?.displayName || '',
			username: profileData?.username || '',
			orcid: profileData?.orcid || '',
			affiliation: profileData?.affiliation || '',
			titleRole: profileData?.titleRole || '',
			bio: profileData?.bio || '',
			socials: profileData?.socials || ''
		};
		clearProfilePictureFile();
		errorMessage = '';
	}

	async function saveProfile() {
		if (!authStore.user?.id) return;

		try {
			isSaving = true;
			errorMessage = '';

			const formData = new FormData();
			if (profilePictureFile) {
				formData.append('profilePicture', profilePictureFile);
				formData.append('avatar', profilePictureFile);
			}

			const updatedUser = await pb.collection('users').update(authStore.user.id, formData);
			const freshUser = await pb.collection('users').getOne(authStore.user.id);
			pb.authStore.save(pb.authStore.token, freshUser);
			const profilePicture =
				freshUser.profilePicture ||
				freshUser.avatar ||
				updatedUser.profilePicture ||
				updatedUser.avatar ||
				'';

			if (profileData) {
				profileData.profilePicture = profilePicture;
				profileData.profilePictureUrl = profilePicture
					? pb.files.getURL(freshUser, profilePicture, { thumb: '200x200' })
					: '';
			}

			clearProfilePictureFile();
			isEditing = false;
			saveMessage = '✓ Profile updated successfully!';
			setTimeout(() => {
				saveMessage = '';
			}, 3000);
		} catch (error) {
			console.error('Error updating profile:', error);
			errorMessage =
				error instanceof Error ? error.message : 'Failed to update profile. Please try again.';
		} finally {
			isSaving = false;
		}
	}

	async function refreshOrcidProfile() {
		isRefreshing = true;
		errorMessage = '';
		try {
			await pb.send('/api/pure3d/orcid/profile-refresh', { method: 'POST' });
			await loadProfile();
			if (!errorMessage) saveMessage = 'Profile refreshed from ORCID.';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to refresh ORCID profile';
		} finally {
			isRefreshing = false;
		}
	}

	function socialHref(value: string) {
		return /^https?:\/\//i.test(value) ? value : `https://${value}`;
	}

	function socialLabel(value: string) {
		return value.replace(/^https?:\/\//i, '').replace(/\/$/, '');
	}

	function socialLinks(value: string) {
		return [
			...new Set(
				value
					.split(/\n+/)
					.map((item) => item.trim())
					.filter(Boolean)
			)
		];
	}
</script>

<div id="page">
	{#if isLoading}
		<div class="flex min-h-screen items-center justify-center">
			<div class="text-center">
				<span class="loading loading-lg loading-spinner"></span>
				<p class="mt-4 text-base-content/60">Loading profile...</p>
			</div>
		</div>
	{:else if authStore.isAuthenticated && profileData}
		<div class="container mx-auto max-w-5xl px-4 py-8">
			<section class="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm">
				<div class="h-24 bg-gradient-to-r from-base-300 via-base-200 to-base-100"></div>
				<div class="flex flex-col gap-6 p-6 pt-0 sm:flex-row sm:items-end">
					<div class="-mt-12 shrink-0">
						<div class="placeholder avatar relative block">
							{#if profilePicturePreviewUrl || profileData.profilePictureUrl}
								<div class="w-32 rounded-full bg-base-200 ring-4 ring-base-100">
									<img
										src={profilePicturePreviewUrl || profileData.profilePictureUrl}
										alt="{profileData.displayName} profile"
									/>
								</div>
							{:else}
								<div
									class="flex size-32 items-center justify-center rounded-full bg-base-200 text-base-content ring-4 ring-base-100"
								>
									<span class="text-4xl">{profileData.displayName.charAt(0).toUpperCase()}</span>
								</div>
							{/if}
							{#if !isEditing}
								<button
									type="button"
									class="btn absolute right-0 bottom-0 btn-circle border border-base-300 bg-base-100 btn-sm"
									onclick={startEdit}
									aria-label="Edit profile photo"
									title="Edit profile photo"
									><IconPencil class="size-4" aria-hidden="true" /></button
								>
							{/if}
						</div>
						{#if isEditing}
							<label class="btn mt-3 w-32 overflow-hidden btn-outline btn-xs">
								{profilePictureFile ? 'Photo selected' : 'Photo'}
								<input
									type="file"
									accept="image/png,image/jpeg,image/webp,image/avif"
									class="hidden"
									onchange={selectProfilePicture}
								/>
							</label>
						{/if}
					</div>

					<div class="min-w-0 flex-1">
						{#if isEditing}
							<div class="max-w-2xl">
								<div class="flex flex-wrap items-center gap-2">
									<label for="username" class="sr-only">Username</label>
									<input
										id="username"
										readonly
										type="text"
										bind:value={tempData.username}
										class="input-bordered input h-auto min-h-0 w-auto max-w-full bg-base-100 px-3 py-1 text-3xl leading-tight font-bold"
										placeholder="Display name"
									/>
									<span class="badge badge-neutral"
										>{ROLE_LABELS[profileData.role] || profileData.role}</span
									>
									{#if profileData.orcid && profileData.orcidVerifiedAt}
										<span class="badge badge-success">ORCID verified</span>
									{/if}
								</div>
								<div
									class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-base text-base-content/70"
								>
									<input
										id="title-role"
										readonly
										type="text"
										bind:value={tempData.titleRole}
										class="input-bordered input h-9 min-h-0 w-48 bg-base-100 px-3 py-1"
										placeholder="Title / role position"
									/>
									<span class="text-base-content/30">at</span>
									<input
										id="affiliation"
										readonly
										type="text"
										bind:value={tempData.affiliation}
										class="input-bordered input h-9 min-h-0 w-48 bg-base-100 px-3 py-1"
										placeholder="Affiliation"
									/>
								</div>
							</div>
						{:else}
							<div class="flex flex-wrap items-center gap-2">
								<h1 class="text-3xl leading-tight font-bold">{profileData.displayName}</h1>
								<span class="badge badge-neutral"
									>{ROLE_LABELS[profileData.role] || profileData.role}</span
								>
								{#if profileData.orcid && profileData.orcidVerifiedAt}
									<span class="badge badge-success">ORCID verified</span>
								{/if}
							</div>
							{#if profileData.titleRole || profileData.affiliation}
								<p class="mt-2 text-base text-base-content/70">
									{[profileData.titleRole, profileData.affiliation].filter(Boolean).join(' at ')}
								</p>
							{/if}
						{/if}
						<p class="mt-1 text-sm text-base-content/50">
							{profileData.email} · Member since {profileData.joinDate}
						</p>
					</div>

					<div class="flex shrink-0 flex-wrap gap-2">
						{#if isEditing}
							<button class="btn btn-sm btn-primary" onclick={saveProfile} disabled={isSaving}>
								{isSaving ? 'Saving...' : 'Save'}
							</button>
							<button class="btn btn-ghost btn-sm" onclick={cancelEdit} disabled={isSaving}
								>Cancel</button
							>
						{/if}
						<button
							type="button"
							class="btn btn-ghost btn-sm"
							disabled={isSaving || isRefreshing}
							onclick={() => {
								authStore.logout();
								void goto(resolve('/'));
							}}>Logout</button
						>
					</div>
				</div>

				{#if saveMessage}
					<div class="mx-6 mb-4 alert alert-success">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-6 w-6 shrink-0 stroke-current"
							fill="none"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						<span>{saveMessage}</span>
					</div>
				{/if}

				{#if errorMessage}
					<div class="mx-6 mb-4 alert alert-error">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-6 w-6 shrink-0 stroke-current"
							fill="none"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						<span>{errorMessage}</span>
					</div>
				{/if}

				<div class="grid gap-8 border-t border-base-300 p-6 lg:grid-cols-[1fr_20rem]">
					<div class="space-y-6">
						<div>
							<div class="flex items-center gap-2">
								<h3 class="text-sm font-semibold tracking-wide text-base-content/50 uppercase">
									Bio
								</h3>
								<button
									type="button"
									class="btn font-normal btn-ghost btn-xs"
									onclick={refreshOrcidProfile}
									disabled={isRefreshing || isEditing || !profileData.orcidVerifiedAt}
									aria-label="Refresh from ORCID"
									title="Refresh from ORCID"
									aria-busy={isRefreshing}
									>{isRefreshing ? 'Refreshing…' : 'Refresh from ORCID'}</button
								>
							</div>
							{#if isEditing}
								<textarea
									id="bio"
									readonly
									bind:value={tempData.bio}
									class="textarea-bordered textarea mt-2 min-h-40 w-full"
									placeholder="Short public biography"
								></textarea>
							{:else if profileData.bio}
								<p class="mt-2 whitespace-pre-line text-base-content/80">{profileData.bio}</p>
							{:else}
								<p class="mt-2 text-base-content/50">No public biography on ORCID.</p>
							{/if}
						</div>
					</div>

					<aside class="space-y-3">
						<div>
							<div class="flex items-center justify-between gap-2">
								<span class="text-xs font-semibold tracking-wide text-base-content/50 uppercase"
									>Profile links</span
								>
							</div>
							{#if isEditing}
								<label for="orcid" class="mt-3 block text-xs font-medium text-base-content/60"
									>ORCID</label
								>
								<input
									id="orcid"
									readonly
									type="url"
									bind:value={tempData.orcid}
									class="input-bordered input mt-1 w-full"
									placeholder="https://orcid.org/0000-0000-0000-0000"
								/>
								<label for="socials" class="mt-4 block text-xs font-medium text-base-content/60"
									>Links</label
								>
								<textarea
									id="socials"
									readonly
									bind:value={tempData.socials}
									class="textarea-bordered textarea mt-1 min-h-28 w-full"
									placeholder="One link per line"
								></textarea>
							{:else if profileData.orcid || profileData.socials}
								<div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
									{#if profileData.orcid}
										<a
											class="link text-sm underline-offset-4"
											href={`https://orcid.org/${profileData.orcid.slice(18)}`}
											title={profileData.orcid}
											target="_blank"
											rel="noreferrer"
										>
											ORCID
										</a>
									{/if}
									{#each socialLinks(profileData.socials) as social (social)}
										<!-- eslint-disable svelte/no-navigation-without-resolve -- External ORCID profile URL, not an app route. -->
										<a
											class="max-w-full link text-sm break-all underline-offset-4"
											href={socialHref(social)}
											target="_blank"
											rel="noreferrer"
										>
											{socialLabel(social)}
										</a>
										<!-- eslint-enable svelte/no-navigation-without-resolve -->
									{/each}
								</div>
							{:else}
								<p class="mt-3 text-base-content/50">No public ORCID links.</p>
							{/if}
						</div>
					</aside>
				</div>
			</section>

			<MyWork />

			<div class="mt-8">
				<NewsletterSignup id="profile-newsletter" email={profileData.email} framed />
			</div>

			<section class="mt-10">
				<div class="mb-4 flex items-center justify-between">
					<h2 class="text-2xl font-semibold">Credited Editions</h2>
					<span class="text-sm text-base-content/60">{editions.length} accessible</span>
				</div>
				{#if editions.length}
					<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
						{#each editions as edition (edition.id)}
							<EditionCard {edition} />
						{/each}
					</div>
				{:else}
					<p
						class="rounded-box border border-base-300 bg-base-100 p-6 text-base-content/60 shadow-sm"
					>
						No accessible editions credit your user ID yet.
					</p>
				{/if}
			</section>

			<section class="mt-10">
				<div class="mb-4 flex items-center justify-between">
					<h2 class="text-2xl font-semibold">Credited Collections</h2>
					<span class="text-sm text-base-content/60">{collections.length} accessible</span>
				</div>
				{#if collections.length}
					<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
						{#each collections as collection (collection.id)}
							<CollectionCard {collection} />
						{/each}
					</div>
				{:else}
					<p
						class="rounded-box border border-base-300 bg-base-100 p-6 text-base-content/60 shadow-sm"
					>
						No accessible collections credit your user ID yet.
					</p>
				{/if}
			</section>
		</div>
	{:else}
		<div class="flex min-h-screen items-center justify-center">
			<div class="text-center">
				<h1 class="mb-4 text-2xl font-bold">Please log in to view your profile</h1>
				<a href={resolve('/')} class="btn btn-primary">Go to Home</a>
			</div>
		</div>
	{/if}
</div>
