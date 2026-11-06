<script lang="ts">
	import SandboxIcon from '~icons/tabler/sandbox';
	import { workflowAnchor } from '$lib/workflow/presentation';
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import toast from 'svelte-french-toast';
	import { pb } from '$lib/database/client';
	import { authStore } from '$lib/database/stores/auth.svelte';
	import { EditionStatus } from '$lib/types/roles';
	import type { ReviewAssignment, EditionReview } from '$lib/types/reviews';
	import { ReviewDecision, ReviewAssignmentStatus } from '$lib/types/reviews';
	import AlphaReviewProgress from '$lib/components/workflow/AlphaReviewProgress.svelte';
	import FinalReviewProgress from '$lib/components/workflow/FinalReviewProgress.svelte';
	import StatusBadge from '$lib/components/workflow/StatusBadge.svelte';
	import WorkflowTimeline from '$lib/components/workflow/WorkflowTimeline.svelte';
	import { getEditionCoverUrl, getEditionThumbnailUrl } from '$lib/utils/asset-urls';

	interface DashEdition {
		id: string;
		title: string;
		status: EditionStatus;
		collectionTitle: string;
		thumbnail: string;
		created: string;
		isSandbox: boolean;
	}

	let activeTab = $state<'reviews' | 'editions' | 'sandboxes'>('editions');
	let isLoading = $state(true);
	let isCreating = $state(false);
	let isCreatingSandbox = $state(false);
	let createdDraftId = $state('');

	async function startProposal() {
		if (isCreating || !authStore.appUserId) return;
		isCreating = true;
		try {
			if (!createdDraftId) {
				const profile = await authStore.refreshSession();
				if (!profile.orcid || !profile.orcidVerifiedAt) {
					throw new Error(
						'An ORCID-verified account is required to start a proposal. Sign out of the demo account and sign in with ORCID.'
					);
				}
				const record = await pb.collection('editions').create({
					title: 'Untitled Proposal',
					dcTitle: 'Untitled Proposal',
					status: EditionStatus.Draft,
					isPublished: false,
					credits: [
						{
							type: 'person',
							name: profile.nickname || 'Author',
							orcid: profile.orcid || null,
							role: 'creator',
							provenance: profile.orcidVerifiedAt ? 'oauth' : 'manual',
							userId: profile.id
						}
					]
				});
				createdDraftId = record.id;
			}
			await goto(resolve('/editions/[slug]/workflow', { slug: createdDraftId }));
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : 'Could not start your proposal. Please try again.'
			);
		} finally {
			isCreating = false;
		}
	}

	async function createSandbox() {
		if (isCreatingSandbox || !authStore.appUserId) return;
		isCreatingSandbox = true;
		try {
			const record = await pb.send<{ id: string }>('/api/pure3d/sandboxes', { method: 'POST' });
			await goto(resolve('/editions/[slug]/workflow', { slug: record.id }));
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: 'Could not create your private sandbox. Please try again.'
			);
		} finally {
			isCreatingSandbox = false;
		}
	}

	// My Reviews data
	let myAssignments = $state<(ReviewAssignment & { edition?: DashEdition })[]>([]);
	let myReviews = $state<EditionReview[]>([]);

	// My Editions data
	let myEditions = $state<DashEdition[]>([]);
	let mySandboxes = $state<DashEdition[]>([]);
	let decliningId = $state('');
	function matchingReview(assignment: ReviewAssignment) {
		return myReviews.find(
			(review) =>
				review.editionId === assignment.editionId &&
				review.reviewStage === assignment.reviewStage &&
				(review.reviewRound || 0) === (assignment.reviewRound || 0)
		);
	}

	let pendingAssignments = $derived(
		myAssignments.filter(
			(a) =>
				['pending', 'accepted'].includes(a.status) &&
				(!matchingReview(a) || matchingReview(a)?.reviewStatus === 'draft')
		)
	);

	let completedAssignments = $derived(
		myAssignments.filter(
			(a) =>
				a.status !== 'declined' &&
				(a.status === 'completed' ||
					(matchingReview(a) && matchingReview(a)?.reviewStatus !== 'draft'))
		)
	);
	async function decline(assignment: ReviewAssignment) {
		if (
			decliningId ||
			!confirm('Decline this review invitation? You will lose reviewer access to the edition.')
		)
			return;
		decliningId = assignment.id;
		try {
			await pb.collection('reviewAssignments').update(assignment.id, { status: 'declined' });
			myAssignments = myAssignments.map((item) =>
				item.id === assignment.id ? { ...item, status: ReviewAssignmentStatus.Declined } : item
			);
			toast.success('Review invitation declined');
		} catch {
			toast.error('Could not decline the invitation.');
		} finally {
			decliningId = '';
		}
	}

	onMount(async () => {
		if (!authStore.isAuthenticated || !authStore.appUserId) {
			goto(resolve('/'));
			return;
		}
		await loadData();
	});

	async function loadData() {
		isLoading = true;
		const userId = authStore.appUserId!;

		try {
			// Load reviewer assignments for this user
			const [assignResult, reviewResult, edUserResult] = await Promise.all([
				pb.collection('reviewAssignments').getList(1, 500, {
					filter: `reviewerId = "${userId}"`,
					sort: '-created'
				}),
				pb.collection('editionReviews').getList(1, 500, {
					filter: `reviewerId = "${userId}"`,
					sort: '-created'
				}),
				pb.collection('editionUsers').getList(1, 500, {
					filter: `userId = "${userId}" && role = "author"`
				})
			]);

			myReviews = reviewResult.items.map((r) => ({
				reviewRound: r.reviewRound || 0,
				reviewStatus: r.reviewStatus,
				id: r.id,
				editionId: r.editionId,
				reviewerId: r.reviewerId,
				reviewStage: r.reviewStage,
				decision: r.decision as ReviewDecision,
				comment: r.comment || null,
				created: r.created,
				updated: r.updated
			}));

			// Collect all edition IDs we need
			const assignmentEditionIds = assignResult.items.map((r) => r.editionId);
			const authorEditionIds = edUserResult.items.map((r) => r.editionId);
			const allEditionIds = [...new Set([...assignmentEditionIds, ...authorEditionIds])];

			// Load edition details
			const editionMap = new SvelteMap<string, DashEdition>();
			if (allEditionIds.length > 0) {
				const edResult = await pb.collection('editions').getList(1, 500, {
					filter: allEditionIds.map((id) => `id = "${id}"`).join(' || '),
					expand: 'collection'
				});
				const needsFileToken = edResult.items.some((r) => r.coverImage && !r.isPublished);
				const fileToken = needsFileToken ? await pb.files.getToken() : '';
				for (const r of edResult.items) {
					const col = r.expand?.collection;
					const collectionPubNum = col?.pubNum || 0;
					const editionPubNum = r.pubNum || 0;
					const legacyThumbnail =
						r.thumbnail && collectionPubNum > 0 && editionPubNum > 0
							? getEditionThumbnailUrl(collectionPubNum, editionPubNum)
							: '';
					const thumbnail =
						getEditionCoverUrl(
							{
								id: r.id,
								collectionId: r.collectionId,
								collectionName: r.collectionName,
								coverImage: r.coverImage,
								thumbnail: legacyThumbnail
							},
							r.isPublished ? '' : fileToken
						) || '';
					editionMap.set(r.id, {
						id: r.id,
						title: r.dcTitle || r.title,
						status: (r.status as EditionStatus) || EditionStatus.Draft,
						collectionTitle: col?.title || '',
						thumbnail,
						created: r.created,
						isSandbox: !!r.isSandbox
					});
				}
			}

			myAssignments = assignResult.items.map((r) => ({
				dueAt: r.dueAt || '',
				reviewRound: r.reviewRound || 0,
				editionTitle: r.editionTitle || '',
				id: r.id,
				editionId: r.editionId,
				reviewerId: r.reviewerId,
				reviewStage: r.reviewStage,
				assignedBy: r.assignedBy,
				status: r.status,
				created: r.created,
				updated: r.updated,
				edition: editionMap.get(r.editionId)
			}));

			const authoredEditions = authorEditionIds
				.map((id) => editionMap.get(id))
				.filter((e): e is DashEdition => !!e);
			myEditions = authoredEditions.filter((edition) => !edition.isSandbox);
			mySandboxes = authoredEditions.filter((edition) => edition.isSandbox);
		} catch (error) {
			console.error('Error loading dashboard data:', error);
		} finally {
			isLoading = false;
		}
	}

	function formatDate(dateStr: string): string {
		if (!dateStr) return '';
		const d = new Date(dateStr);
		if (isNaN(d.getTime())) return '';
		return d.toLocaleDateString('en-GB', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	let deletingId = $state<string | null>(null);

	async function deleteDraft(edition: DashEdition) {
		if (edition.status !== EditionStatus.Draft) return;
		const kind = edition.isSandbox ? 'private sandbox' : 'draft';
		const confirmed = confirm(`Delete ${kind} "${edition.title}"? This cannot be undone.`);
		if (!confirmed) return;

		deletingId = edition.id;
		try {
			await pb.collection('editions').delete(edition.id);
			myEditions = myEditions.filter((e) => e.id !== edition.id);
			mySandboxes = mySandboxes.filter((e) => e.id !== edition.id);
			toast.success(`Deleted "${edition.title}"`);
		} catch (err) {
			console.error('Delete failed:', err);
			toast.error((err as Error).message || 'Failed to delete edition');
		} finally {
			deletingId = null;
		}
	}

	function getStageLabel(stage: number): string {
		switch (stage) {
			case 1:
				return 'Concept';
			case 2:
				return 'Alpha';
			case 3:
				return 'Final';
			default:
				return `Stage ${stage}`;
		}
	}

	function workflowStepHref(editionId: string, status: EditionStatus): string {
		const workflowPath = resolve('/editions/[slug]/workflow', { slug: editionId });
		return workflowPath + workflowAnchor(status);
	}

	function statusMessage(status: EditionStatus): string {
		switch (status) {
			case EditionStatus.Draft:
				return 'Continue your proposal when you are ready.';
			case EditionStatus.ConceptSubmitted:
				return 'Proposal submitted. Awaiting editorial review.';
			case EditionStatus.EditorialReview:
				return 'Your proposal is under editorial review.';
			case EditionStatus.ConceptAccepted:
				return 'Proposal approved. Your edition is ready to build.';
			case EditionStatus.ConceptRejected:
				return 'Revise your proposal before resubmitting.';
			case EditionStatus.AlphaReview:
				return 'Editing is locked until the Alpha Review decision.';
			case EditionStatus.AlphaRevisions:
			case EditionStatus.FinalRevisions:
				return 'Revisions requested. Update your edition and resubmit.';
			case EditionStatus.AlphaRejected:
				return 'Alpha Review rejected. Revise your draft before resubmitting.';
			case EditionStatus.AlphaAccepted:
				return 'Alpha Review approved. Ready for final review.';
			case EditionStatus.FinalReview:
				return 'Your edition is in final review.';
			case EditionStatus.FinalAccepted:
				return 'Final review approved. Ready to request publication.';
			case EditionStatus.PublicationRequested:
				return 'Publication requested. Awaiting the editorial decision.';
			case EditionStatus.Published:
				return 'Your edition is published.';
			default:
				return 'Open your workflow to see the next step.';
		}
	}
</script>

<section
	id="my-work"
	class="mt-10 rounded-box border border-base-300 bg-base-100 p-6 shadow-sm"
	class:sandbox-active={activeTab === 'sandboxes'}
>
	<div class="mb-6 flex flex-wrap items-start justify-between gap-4">
		<div>
			<h2 class="text-2xl font-bold">My Work</h2>
		</div>
		<div class="flex flex-wrap gap-2">
			<button
				type="button"
				class="btn btn-outline"
				onclick={createSandbox}
				disabled={isCreatingSandbox}
			>
				{#if isCreatingSandbox}
					<span class="loading loading-xs loading-spinner"></span>
				{:else}
					<SandboxIcon class="size-5" aria-hidden="true" />
				{/if}
				{isCreatingSandbox ? 'Creating sandbox…' : 'New private sandbox'}
			</button>
			<button type="button" class="btn btn-primary" onclick={startProposal} disabled={isCreating}>
				{#if isCreating}<span class="loading loading-xs loading-spinner"></span>{/if}
				{isCreating ? 'Starting proposal…' : 'Start a proposal'}
			</button>
		</div>
	</div>

	<!-- Tabs -->
	<div class="tabs-bordered mb-6 tabs">
		<button
			class="tab"
			class:tab-active={activeTab === 'editions'}
			class:font-semibold={activeTab === 'editions'}
			onclick={() => (activeTab = 'editions')}
		>
			My Proposals & Editions
			{#if myEditions.length > 0}
				<span class="ml-1 badge badge-sm badge-neutral">{myEditions.length}</span>
			{/if}
		</button>
		<button
			class="tab"
			class:tab-active={activeTab === 'sandboxes'}
			class:font-semibold={activeTab === 'sandboxes'}
			onclick={() => (activeTab = 'sandboxes')}
		>
			Private Sandboxes
			{#if mySandboxes.length > 0}
				<span class="ml-1 badge badge-sm badge-neutral">{mySandboxes.length}</span>
			{/if}
		</button>
		<button
			class="tab"
			class:tab-active={activeTab === 'reviews'}
			class:font-semibold={activeTab === 'reviews'}
			onclick={() => (activeTab = 'reviews')}
		>
			My Reviews
			{#if pendingAssignments.length > 0}
				<span class="ml-1 badge badge-sm badge-neutral">{pendingAssignments.length}</span>
			{/if}
		</button>
	</div>

	{#if isLoading}
		<div class="flex items-center justify-center py-12">
			<span class="loading loading-lg loading-spinner"></span>
		</div>
	{:else}
		<!-- My Reviews Tab -->
		{#if activeTab === 'reviews'}
			{#if pendingAssignments.length > 0}
				<h2 class="mb-3 text-lg font-semibold">Pending Reviews</h2>
				<div class="mb-6 space-y-2">
					{#each pendingAssignments as assignment (assignment.id)}
						{@const edition = assignment.edition}
						<div class="rounded-box border border-base-300 bg-base-100 p-4">
							<div class="flex flex-wrap items-center justify-between gap-3">
								<div class="flex flex-wrap items-center gap-3">
									<span class="font-medium"
										>{edition?.title || assignment.editionTitle || 'Edition'}</span
									>
									{#if edition}
										<StatusBadge status={edition.status} />
									{/if}
									<span class="badge badge-ghost badge-sm">
										{getStageLabel(assignment.reviewStage)}
									</span>
								</div>
								<a
									href={resolve('/editions/[slug]/workflow', { slug: assignment.editionId })}
									class="btn btn-sm btn-primary"
								>
									{matchingReview(assignment)?.reviewStatus === 'draft'
										? 'Continue review'
										: 'Review edition'}
								</a>
								<button
									type="button"
									class="btn btn-outline btn-sm"
									disabled={decliningId === assignment.id}
									onclick={() => decline(assignment)}>Decline</button
								>
							</div>
							{#if assignment.dueAt}<p class="mt-2 text-sm">
									Review due: {formatDate(assignment.dueAt)}
								</p>{/if}
							{#if edition?.collectionTitle}
								<p class="mt-1 text-sm text-base-content/50">in {edition.collectionTitle}</p>
							{/if}
							<p class="mt-1 text-xs text-base-content/40">
								Assigned {formatDate(assignment.created)}
							</p>
						</div>
					{/each}
				</div>
			{/if}

			{#if completedAssignments.length > 0}
				<h2 class="mb-3 text-lg font-semibold">Completed Reviews</h2>
				<div class="space-y-2">
					{#each completedAssignments as assignment (assignment.id)}
						{@const edition = assignment.edition}
						{@const review = matchingReview(assignment)}
						<div class="rounded-box border border-base-200 bg-base-200/30 p-4">
							<div class="flex flex-wrap items-center gap-3">
								<span class="font-medium"
									>{edition?.title || assignment.editionTitle || 'Edition'}</span
								>
								{#if edition}
									<StatusBadge status={edition.status} />
								{/if}
								<span class="badge badge-ghost badge-sm">
									{getStageLabel(assignment.reviewStage)}
								</span>
								{#if assignment.reviewStage >= 2}<span class="badge badge-sm badge-success"
										>{assignment.reviewStage === 3 ? 'Final' : 'Alpha'} Review submitted</span
									>{:else if review}
									<span
										class="badge badge-sm {review.decision === ReviewDecision.Approve
											? 'badge-success'
											: review.decision === ReviewDecision.Reject
												? 'badge-error'
												: 'badge-warning'}"
									>
										{review.decision === ReviewDecision.Approve
											? 'Approved'
											: review.decision === ReviewDecision.Reject
												? 'Rejected'
												: 'Revisions'}
									</span>
								{/if}
							</div>
							{#if assignment.reviewStage >= 2}<p class="mt-3 text-sm text-base-content/70">
									Your review is submitted and cannot be edited. Edition access is closed until you
									receive a new review invitation.
								</p>{/if}
							<p class="mt-1 text-xs text-base-content/40">
								Reviewed {review ? formatDate(review.created) : ''}
							</p>
						</div>
					{/each}
				</div>
			{/if}

			{#if !pendingAssignments.length && !completedAssignments.length}
				<p class="py-8 text-center text-base-content/60">No review assignments yet.</p>
			{/if}
		{/if}

		<!-- My Editions Tab -->
		{#if activeTab === 'editions'}
			{#if myEditions.length === 0}
				<div class="rounded-box border border-base-300 bg-base-100 px-5 py-10 text-center">
					<h2 class="text-lg font-semibold">Your first proposal starts here</h2>
					<p class="mx-auto mt-2 mb-5 max-w-md text-sm text-base-content/65">
						Tell us about your 3D edition. Your draft saves automatically, and you can return to it
						anytime before submitting it for review.
					</p>
					<button
						type="button"
						class="btn btn-primary"
						onclick={startProposal}
						disabled={isCreating}>{isCreating ? 'Starting proposal…' : 'Start a proposal'}</button
					>
				</div>
			{:else}
				<div class="grid grid-cols-1 items-start gap-6 sm:grid-cols-2 lg:grid-cols-3">
					{#each myEditions as edition (edition.id)}
						<article class="ds-card flex min-w-0 flex-col p-3">
							<a
								href={resolve('/editions/[slug]/workflow', { slug: edition.id })}
								class="relative block aspect-square overflow-hidden rounded-lg bg-base-200"
								aria-label={`Open workflow for ${edition.title || 'Untitled Proposal'}`}
							>
								{#if edition.thumbnail}
									<img
										src={edition.thumbnail}
										alt={edition.title}
										class="h-full w-full object-cover"
										loading="lazy"
									/>
								{:else}
									<div class="flex h-full items-center justify-center text-base-content/30">
										<svg
											xmlns="http://www.w3.org/2000/svg"
											fill="none"
											viewBox="0 0 24 24"
											stroke-width="1.5"
											stroke="currentColor"
											class="size-16"
											aria-hidden="true"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
											/>
										</svg>
									</div>
								{/if}
							</a>
							<div class="mt-3 flex flex-col gap-3 rounded-md bg-base-200 p-3">
								<div>
									<a
										class="font-semibold break-words link-hover"
										href={resolve('/editions/[slug]/workflow', { slug: edition.id })}
										>{edition.title || 'Untitled Proposal'}</a
									>
									{#if edition.collectionTitle}
										<p class="mt-1 text-sm text-base-content/60">in {edition.collectionTitle}</p>
									{/if}
								</div>
								<StatusBadge status={edition.status} />
								<p class="min-h-10 text-sm text-base-content/70">{statusMessage(edition.status)}</p>
								<div class="flex flex-wrap items-center gap-2">
									{#if edition.status === EditionStatus.Draft}
										<button
											type="button"
											class="btn text-error btn-ghost btn-sm"
											disabled={deletingId === edition.id}
											onclick={() => deleteDraft(edition)}
											aria-label={`Delete draft ${edition.title || 'Untitled Proposal'}`}
										>
											{deletingId === edition.id ? 'Deleting…' : 'Delete'}
										</button>
									{/if}
									<a
										href={resolve('/editions/[slug]/workflow', { slug: edition.id })}
										class="btn flex-1 btn-sm btn-primary"
									>
										{edition.status === EditionStatus.ConceptAccepted
											? 'Build your edition'
											: edition.status === EditionStatus.Draft
												? 'Continue proposal'
												: [EditionStatus.ConceptSubmitted, EditionStatus.EditorialReview].includes(
															edition.status
													  )
													? 'View proposal'
													: edition.status === EditionStatus.AlphaReview
														? 'View edition'
														: 'View workflow'}
									</a>
								</div>
							</div>
							<details class="mt-3 rounded-md border border-base-300">
								<summary
									class="cursor-pointer rounded-md px-3 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary"
									>Progress</summary
								>
								<div class="px-3 pb-3">
									<div class="overflow-x-auto pb-2">
										<div class="min-w-[460px]">
											<WorkflowTimeline
												currentStatus={edition.status}
												showStatusDetails={false}
												hrefForStatus={(status) => workflowStepHref(edition.id, status)}
											/>
										</div>
									</div>
									{#if [EditionStatus.FinalReview, EditionStatus.FinalRevisions, EditionStatus.FinalAccepted, EditionStatus.PublicationRequested].includes(edition.status)}<div
											class="mt-3"
										>
											<FinalReviewProgress editionId={edition.id} />
										</div>{/if}
									{#if [EditionStatus.AlphaReview, EditionStatus.AlphaRevisions, EditionStatus.AlphaAccepted].includes(edition.status)}<div
											class="mt-3"
										>
											<AlphaReviewProgress editionId={edition.id} />
										</div>{/if}
								</div>
							</details>
						</article>
					{/each}
				</div>
			{/if}
		{/if}

		{#if activeTab === 'sandboxes'}
			<div class="mb-5 rounded-box bg-base-200/60 p-4 text-sm text-base-content/75">
				Private sandboxes let you work with the full editor before a proposal is approved. They are
				not visible publicly or to the editorial workflow, and cannot be published. When an edition
				is approved, you can copy this work into it from the editor.
			</div>
			{#if mySandboxes.length === 0}
				<div class="rounded-box border border-base-300 bg-base-100 px-5 py-10 text-center">
					<h2 class="text-lg font-semibold">Try the editor privately</h2>
					<p class="mx-auto mt-2 mb-5 max-w-md text-sm text-base-content/65">
						Upload a model and create annotations, tours, and articles without submitting a
						proposal.
					</p>
					<button
						type="button"
						class="btn btn-primary"
						onclick={createSandbox}
						disabled={isCreatingSandbox}
						><SandboxIcon class="size-5" aria-hidden="true" />
						{isCreatingSandbox ? 'Creating sandbox…' : 'New private sandbox'}</button
					>
				</div>
			{:else}
				<div class="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{#each mySandboxes as sandbox (sandbox.id)}
						<article class="ds-card flex min-w-0 flex-col p-4">
							<a
								href={resolve('/editions/[slug]/workflow', { slug: sandbox.id })}
								class="relative mb-3 block aspect-square overflow-hidden rounded-lg bg-base-200"
								aria-label={`Open editor for ${sandbox.title || 'Untitled Sandbox'}`}
							>
								{#if sandbox.thumbnail}
									<img
										src={sandbox.thumbnail}
										alt={sandbox.title}
										class="h-full w-full object-cover"
										loading="lazy"
									/>
								{:else}
									<div class="flex h-full items-center justify-center text-base-content/30">
										<SandboxIcon class="size-16" aria-hidden="true" />
									</div>
								{/if}
							</a>
							<div class="mb-3 flex items-start justify-between gap-3">
								<div>
									<span class="badge badge-outline badge-sm">Private sandbox</span>
									<h3 class="mt-2 font-semibold break-words">
										{sandbox.title || 'Untitled Sandbox'}
									</h3>
									<p class="mt-1 text-xs text-base-content/55">
										Created {formatDate(sandbox.created)}
									</p>
								</div>
								<button
									type="button"
									class="btn text-error btn-ghost btn-xs"
									disabled={deletingId === sandbox.id}
									onclick={() => deleteDraft(sandbox)}>Delete</button
								>
							</div>
							<p class="mb-4 text-sm text-base-content/70">
								Private editor work only. It cannot be reviewed or published.
							</p>
							<a
								href={resolve('/editions/[slug]/workflow', { slug: sandbox.id })}
								class="btn btn-sm btn-primary">Open editor</a
							>
						</article>
					{/each}
				</div>
			{/if}
		{/if}
	{/if}
</section>

<style>
	.sandbox-active {
		background-color: color-mix(in srgb, var(--color-base-100) 85%, #edc786);
		background-image: url('/images/sandbox-doodles.svg'), url('/images/sandbox-grains.svg');
		background-position: right bottom, left top;
		background-size: 440px auto, 120px 120px;
		background-repeat: no-repeat, repeat;
	}

	.sandbox-active :global(.ds-card) {
		background-color: var(--color-base-100);
	}

	@media (max-width: 640px) {
		.sandbox-active {
			background-size: 280px auto, 120px 120px;
		}
	}
</style>
