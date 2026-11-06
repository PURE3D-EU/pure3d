<script lang="ts">
	import { workflowAnchor, workflowStages } from '$lib/workflow/presentation';
	import type { RecordModel } from 'pocketbase';
	import { onMount } from 'svelte';
	import { base, resolve } from '$app/paths';
	import { pb } from '$lib/database/client';
	import { authStore } from '$lib/database/stores/auth.svelte';
	import { EditionStatus, ReviewStage, STATUS_LABELS } from '$lib/types/roles';
	import { ReviewDecision, ReviewAssignmentStatus } from '$lib/types/reviews';
	import type { EditionReview, ReviewAssignment } from '$lib/types/reviews';
	import {
		updateEditionStatus,
		assignReviewer,
		removeReviewAssignment
	} from '$lib/database/edition-helpers';
	import {
		anonymizeReviews,
		isCurrentReviewRound,
		aggregateVerdicts,
		getTargetStatusFromVerdict
	} from '$lib/utils/review-helpers';
	import AlphaEditorialPanel from '$lib/components/workflow/AlphaEditorialPanel.svelte';
	import FinalEditorialPanel from '$lib/components/workflow/FinalEditorialPanel.svelte';
	import WorkflowTimeline from '$lib/components/workflow/WorkflowTimeline.svelte';
	import FloatingSelect from '$lib/components/ui/FloatingSelect.svelte';
	import UserSearchSelect from '$lib/components/ui/UserSearchSelect.svelte';
	import toast from 'svelte-french-toast';
	import { creatorNames, readCredits, validateCredits } from '$lib/utils/credits';
	import { canTransitionStatus } from '$lib/utils/permissions';
	import {
		conceptReviewCreditIssue,
		needsConceptReviewerAssignment
	} from '$lib/workflow/review-start';

	interface WfEdition {
		record: RecordModel;
		id: string;
		title: string;
		authorNames: string;
		status: EditionStatus;
		collectionId: string;
		collectionTitle: string;
		proposalSubmittedAt: string;
		peerReviewRequested: boolean;
		peerReviewStamp: boolean;
		publishedAt: string | null;
		alphaReviewRound: number;
		finalReviewRound: number;
	}

	interface AppUser {
		id: string;
		nickname: string;
		orcid: string;
	}

	let editions = $state<WfEdition[]>([]);
	let allAssignments = $state<ReviewAssignment[]>([]);
	let allReviews = $state<EditionReview[]>([]);
	let allUsers = $state<AppUser[]>([]);
	let userLookup = $derived(
		new Map(allUsers.map((u) => [u.id, u.nickname || u.orcid || 'Unnamed user']))
	);

	let isLoading = $state(true);
	let activeTab = $state<EditionStatus | 'all'>(EditionStatus.ConceptSubmitted);
	let searchQuery = $state('');
	let collectionFilter = $state('');
	let expandedId = $state<string | null>(null);
	let actionLoading = $state(false);
	let filteredBaseEditions = $derived(
		editions.filter((e) => {
			const query = searchQuery.toLowerCase();
			const matchesSearch =
				!query ||
				e.title.toLowerCase().includes(query) ||
				e.collectionTitle.toLowerCase().includes(query);
			const matchesCollection = !collectionFilter || e.collectionId === collectionFilter;

			return matchesSearch && matchesCollection;
		})
	);
	let hasActiveFilters = $derived(Boolean(searchQuery || collectionFilter));
	let collectionFilterOptions = $derived([
		{ value: '', label: 'All collections' },
		...Array.from(
			new Map(
				editions
					.filter((edition) => edition.collectionId && edition.collectionTitle)
					.map((edition) => [edition.collectionId, edition.collectionTitle])
			).entries()
		)
			.sort(([, a], [, b]) => a.localeCompare(b))
			.map(([value, label]) => ({ value, label }))
	]);

	// Reviewer assignment form state
	let assignUserId = $state('');
	let assignDueAt = $state('');
	let replacementReason = $state('');
	let overrideEdition = $state<WfEdition | null>(null);
	let overrideStatus = $state<EditionStatus | ''>('');
	let overrideReason = $state('');

	// Publish modal state
	let publishModalEdition = $state<WfEdition | null>(null);

	// The pipeline and timeline share the same labels, order and status membership.
	let stageTabs = $derived(
		workflowStages.map((stage) => ({
			...stage,
			editions: filteredBaseEditions.filter((edition) => stage.statuses.includes(edition.status))
		}))
	);
	let selectedStage = $derived(stageTabs.find((stage) => stage.hrefStatus === activeTab));
	let visibleEditions = $derived(
		activeTab === 'all' ? filteredBaseEditions : selectedStage?.editions ?? []
	);

	const overrideTargets: Partial<Record<EditionStatus, EditionStatus[]>> = {
		[EditionStatus.Draft]: [EditionStatus.ConceptSubmitted],
		[EditionStatus.ConceptSubmitted]: [EditionStatus.EditorialReview],
		[EditionStatus.EditorialReview]: [EditionStatus.ConceptAccepted, EditionStatus.ConceptRejected],
		[EditionStatus.ConceptAccepted]: [EditionStatus.AlphaReview],
		[EditionStatus.ConceptRejected]: [EditionStatus.Draft],
		[EditionStatus.AlphaReview]: [
			EditionStatus.AlphaAccepted,
			EditionStatus.AlphaRejected,
			EditionStatus.AlphaRevisions
		],
		[EditionStatus.AlphaRevisions]: [EditionStatus.AlphaReview],
		[EditionStatus.AlphaAccepted]: [EditionStatus.FinalReview, EditionStatus.AlphaReview],
		[EditionStatus.AlphaRejected]: [EditionStatus.Draft, EditionStatus.AlphaReview],
		[EditionStatus.FinalReview]: [EditionStatus.FinalAccepted, EditionStatus.FinalRevisions],
		[EditionStatus.FinalRevisions]: [EditionStatus.FinalReview],
		[EditionStatus.FinalAccepted]: [EditionStatus.PublicationRequested, EditionStatus.FinalReview],
		[EditionStatus.PublicationRequested]: [EditionStatus.FinalAccepted, EditionStatus.FinalReview]
	};

	function isCurrentProposalCycle(
		record: { reviewStage: number; created: string },
		edition?: WfEdition
	): boolean {
		if (record.reviewStage !== ReviewStage.Concept) return true;
		const submittedAt = Date.parse((edition?.proposalSubmittedAt || '').replace(' ', 'T'));
		const createdAt = Date.parse(record.created.replace(' ', 'T'));
		return Number.isFinite(submittedAt) && Number.isFinite(createdAt) && createdAt >= submittedAt;
	}

	function editionAssignments(editionId: string, stage?: number): ReviewAssignment[] {
		const edition = editions.find((edition) => edition.id === editionId);
		return allAssignments.filter(
			(a) =>
				a.editionId === editionId &&
				(stage === undefined || a.reviewStage === stage) &&
				isCurrentReviewRound(a, edition || {}) &&
				isCurrentProposalCycle(a, edition)
		);
	}

	function editionReviews(editionId: string, stage?: number): EditionReview[] {
		const edition = editions.find((edition) => edition.id === editionId);
		return allReviews.filter(
			(r) =>
				r.editionId === editionId &&
				r.reviewStatus !== 'draft' &&
				(stage === undefined || r.reviewStage === stage) &&
				isCurrentReviewRound(r, edition || {}) &&
				isCurrentProposalCycle(r, edition)
		);
	}

	function distinctActiveAssignments(assignments: ReviewAssignment[]): ReviewAssignment[] {
		const reviewers = new Set<string>();
		return assignments.filter((assignment) => {
			if (
				assignment.status === ReviewAssignmentStatus.Declined ||
				reviewers.has(assignment.reviewerId)
			)
				return false;
			reviewers.add(assignment.reviewerId);
			return true;
		});
	}

	onMount(loadData);

	async function loadData() {
		isLoading = true;
		try {
			const [editionRecords, assignmentRecords, reviewRecords, userResult] = await Promise.all([
				pb.collection('editions').getFullList({ expand: 'collection' }),
				pb.collection('reviewAssignments').getFullList({
					expand: 'reviewerId,assignedBy'
				}),
				pb.collection('editionReviews').getFullList({ expand: 'reviewerId' }),
				pb.collection('users').getFullList()
			]);

			editions = editionRecords.map((r) => ({
				record: r,
				alphaReviewRound: r.alphaReviewRound || 0,
				finalReviewRound: r.finalReviewRound || 0,
				id: r.id,
				title: r.dcTitle || r.title,
				authorNames: creatorNames(readCredits(r.credits)),
				status: (r.status as EditionStatus) || EditionStatus.Draft,
				collectionId: r.collection || '',
				collectionTitle: r.expand?.collection?.title || '',
				proposalSubmittedAt: r.proposalSubmittedAt || '',
				peerReviewRequested: r.peerReviewRequested || false,
				peerReviewStamp: r.peerReviewStamp || false,
				publishedAt: r.publishedAt || null
			}));

			allAssignments = assignmentRecords.map((r) => ({
				reviewRound: r.reviewRound || 0,
				editionTitle: r.editionTitle || '',
				id: r.id,
				editionId: r.editionId,
				reviewerId: r.reviewerId,
				reviewStage: r.reviewStage,
				assignedBy: r.assignedBy,
				status: r.status,
				dueAt: r.dueAt || undefined,
				created: r.created,
				updated: r.updated
			}));

			allReviews = reviewRecords.map((r) => ({
				reviewStatus: r.reviewStatus,
				reviewRound: r.reviewRound || 0,
				id: r.id,
				editionId: r.editionId,
				reviewerId: r.reviewerId,
				reviewStage: r.reviewStage,
				decision: r.decision as ReviewDecision,
				comment: r.comment || null,
				created: r.created,
				updated: r.updated
			}));

			allUsers = userResult.map((r) => ({
				id: r.id,
				nickname: r.nickname || '',
				orcid: r.orcid || ''
			}));
		} catch (error) {
			console.error('Error loading workflow data:', error);
			toast.error('Failed to load workflow data');
		} finally {
			isLoading = false;
		}
	}

	function toggleExpand(editionId: string) {
		expandedId = expandedId === editionId ? null : editionId;
		assignUserId = '';
	}

	// --- Submissions tab: assign board member and start editorial review ---
	async function assignAndStartReview(edition: WfEdition) {
		actionLoading = true;
		try {
			const current = await pb.collection('editions').getOne(edition.id, {
				fields: 'id,status,credits,collection'
			});
			if (current.status !== EditionStatus.ConceptSubmitted)
				throw new Error('This proposal has changed. Refresh the workflow before starting review.');
			const parentCredits = current.collection
				? (await pb.collection('collections').getOne(current.collection, { fields: 'id,credits' }))
						.credits
				: undefined;
			const creditIssue = conceptReviewCreditIssue(current.credits, parentCredits);
			if (creditIssue) throw new Error(creditIssue);

			const existing = await pb.collection('reviewAssignments').getFullList({
				filter: pb.filter('editionId = {:id} && reviewStage = 1', { id: edition.id }),
				fields: 'id,reviewerId,reviewStage,status,assignedBy,reviewRound,created,updated'
			});
			let assignment;
			if (
				needsConceptReviewerAssignment(
					existing.map((row) => ({ reviewStage: row.reviewStage, status: row.status }))
				)
			) {
				if (!assignUserId) throw new Error('Select a reviewer first.');
				assignment = await assignReviewer(
					edition.id,
					assignUserId,
					ReviewStage.Concept,
					authStore.appUserId || ''
				);
			}

			await updateEditionStatus(edition.id, EditionStatus.EditorialReview);

			edition.status = EditionStatus.EditorialReview;
			editions = [...editions];
			if (assignment)
				allAssignments = [
					...allAssignments,
					{
						id: assignment.id,
						editionId: edition.id,
						reviewerId: assignment.reviewerId,
						reviewStage: ReviewStage.Concept,
						assignedBy: assignment.assignedBy,
						status: ReviewAssignmentStatus.Pending,
						dueAt: assignment.dueAt || undefined,
						reviewRound: 0,
						created: assignment.created,
						updated: assignment.updated
					}
				];
			assignUserId = '';
			toast.success('Editorial review started');
		} catch (error) {
			console.error('Error starting review:', error);
			toast.error(error instanceof Error ? error.message : 'Failed to start review');
		} finally {
			actionLoading = false;
		}
	}

	// --- Apply verdict for any review stage ---
	async function applyVerdict(edition: WfEdition, stage: ReviewStage) {
		const assignments = distinctActiveAssignments(editionAssignments(edition.id, stage));
		const reviews = editionReviews(edition.id, stage).filter((review) =>
			assignments.some((assignment) => assignment.reviewerId === review.reviewerId)
		);
		const verdict = aggregateVerdicts(reviews, assignments.length);

		if (verdict === 'pending') {
			toast.error('Not all reviews have been submitted yet');
			return;
		}

		const targetStatus = getTargetStatusFromVerdict(verdict, stage);
		if (!targetStatus) {
			toast.error('Could not determine target status');
			return;
		}
		if (!canTransitionStatus(edition.status, targetStatus)) {
			toast.error('This verdict is not a valid transition from the current stage');
			return;
		}
		if (targetStatus === EditionStatus.Published) {
			await publishEdition(edition);
			return;
		}

		actionLoading = true;
		try {
			await updateEditionStatus(edition.id, targetStatus, authStore.appUserId || '');

			edition.status = targetStatus;
			editions = [...editions];
			toast.success(`Status changed to ${STATUS_LABELS[targetStatus]}`);
		} catch (error) {
			console.error('Error applying verdict:', error);
			toast.error('Failed to apply verdict');
		} finally {
			actionLoading = false;
		}
	}

	// --- Assign reviewer for alpha/final stages ---
	async function assignStageReviewer(edition: WfEdition, stage: ReviewStage) {
		if (!assignUserId) {
			toast.error('Select a reviewer first');
			return;
		}
		actionLoading = true;
		try {
			if (stage >= 2 && !assignDueAt) throw new Error('Choose a review deadline.');
			if (stage === 3 && !replacementReason.trim())
				throw new Error(
					'Explain why a new reviewer is being invited instead of reusing the Alpha reviewers.'
				);
			const assignment = await assignReviewer(
				edition.id,
				assignUserId,
				stage,
				authStore.appUserId || '',
				assignDueAt ? new Date(assignDueAt + 'T23:59:59').toISOString() : '',
				replacementReason
			);

			allAssignments = [
				...allAssignments,
				{
					id: assignment.id,
					editionId: edition.id,
					reviewerId: assignment.reviewerId,
					reviewStage: stage,
					assignedBy: assignment.assignedBy,
					status: assignment.status,
					dueAt: assignment.dueAt || undefined,
					reviewRound: assignment.reviewRound,
					created: assignment.created,
					updated: assignment.updated
				}
			];
			assignUserId = '';
			assignDueAt = '';
			replacementReason = '';
			toast.success('Reviewer assigned');
		} catch (error) {
			console.error('Error assigning reviewer:', error);
			toast.error('Failed to assign reviewer');
		} finally {
			actionLoading = false;
		}
	}

	function openOverride(edition: WfEdition) {
		overrideEdition = edition;
		overrideStatus = overrideTargets[edition.status]?.[0] || '';
		overrideReason = '';
	}

	async function applyOverride() {
		if (!overrideEdition || !overrideStatus || !overrideReason.trim()) return;
		actionLoading = true;
		try {
			const result = await pb.send<{
				status: EditionStatus;
				alphaReviewRound: number;
				finalReviewRound: number;
			}>(`/api/pure3d/editions/${overrideEdition.id}/admin-workflow-override`, {
				method: 'POST',
				body: {
					status: overrideStatus,
					expectedStatus: overrideEdition.status,
					reason: overrideReason
				}
			});
			overrideEdition.status = result.status;
			overrideEdition.alphaReviewRound = result.alphaReviewRound;
			overrideEdition.finalReviewRound = result.finalReviewRound;
			editions = [...editions];
			overrideEdition = null;
			toast.success('Administrative workflow intervention recorded');
		} catch (error) {
			console.error('Error applying workflow override:', error);
			toast.error(error instanceof Error ? error.message : 'Failed to apply workflow override');
		} finally {
			actionLoading = false;
		}
	}

	async function removePendingAssignment(assignment: ReviewAssignment) {
		if (!confirm('Remove this unsubmitted reviewer invitation?')) return;
		actionLoading = true;
		try {
			await removeReviewAssignment(assignment.id);
			allAssignments = allAssignments.filter((item) => item.id !== assignment.id);
			toast.success('Reviewer invitation removed');
		} catch (error) {
			console.error('Error removing reviewer invitation:', error);
			toast.error(error instanceof Error ? error.message : 'Failed to remove reviewer invitation');
		} finally {
			actionLoading = false;
		}
	}

	// --- Publish / unpublish ---
	async function publishEdition(edition: WfEdition) {
		actionLoading = true;
		try {
			const current = await pb.collection('editions').getOne(edition.id);
			if (!canTransitionStatus(current.status as EditionStatus, EditionStatus.Published)) {
				toast.error('Complete the final review stage before publishing');
				return;
			}
			const issue = validateCredits(readCredits(current.credits), true);
			if (issue) {
				toast.error(issue);
				return;
			}
			const comment = prompt('Editorial publication explanation (maximum 500 words):');
			if (!comment?.trim()) return;
			await pb.send(`/api/pure3d/editions/${edition.id}/final-decision`, {
				method: 'POST',
				body: { decision: 'publish', comment }
			});
			const saved = await pb.collection('editions').getOne(edition.id);

			edition.status = EditionStatus.Published;
			edition.peerReviewRequested = saved.peerReviewRequested;
			edition.peerReviewStamp = saved.peerReviewStamp;
			edition.publishedAt = saved.publishedAt || null;
			editions = [...editions];
			publishModalEdition = null;
			toast.success('Edition published');
		} catch (error) {
			console.error('Error publishing:', error);
			toast.error(error instanceof Error ? error.message : 'Failed to publish edition');
		} finally {
			actionLoading = false;
		}
	}

	function getVerdictLabel(verdict: string): string {
		const labels: Record<string, string> = {
			accept: 'Accept',
			reject: 'Reject',
			revisions: 'Revisions Needed',
			pending: 'Pending'
		};
		return labels[verdict] || verdict;
	}

	function getVerdictBadge(verdict: string): string {
		const badges: Record<string, string> = {
			accept: 'badge-success',
			reject: 'badge-error',
			revisions: 'badge-warning',
			pending: 'badge-ghost'
		};
		return badges[verdict] || 'badge-ghost';
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

	function workflowStepHref(editionId: string, status: EditionStatus): string {
		const workflowPath = `${base}/editions/${editionId}/workflow`;
		return workflowPath + workflowAnchor(status);
	}

	function cardCue(status: EditionStatus): string {
		if (status === EditionStatus.ConceptSubmitted) return 'Assign for review';
		if (status === EditionStatus.EditorialReview) return 'Review progress';
		if (status === EditionStatus.ConceptAccepted) return 'Prepare edition';
		if ([EditionStatus.AlphaReview, EditionStatus.AlphaRevisions].includes(status))
			return 'Manage Alpha';
		if (
			[
				EditionStatus.AlphaAccepted,
				EditionStatus.FinalReview,
				EditionStatus.FinalRevisions,
				EditionStatus.FinalAccepted
			].includes(status)
		)
			return 'Manage Final';
		return 'View details';
	}
</script>

<div id="admin-workflow-page" class="mx-auto max-w-6xl">
	<div class="mb-8">
		<h1 class="text-3xl font-bold">Workflow Pipeline</h1>
		<p class="mt-2 text-base-content/60">
			Manage all editions, review rounds, editorial decisions, and publication confirmation.
		</p>
	</div>

	<div class="mb-4 flex flex-wrap items-end gap-2">
		<label class="form-control min-w-56 flex-1">
			<span class="sr-only">Search editions or collections</span>
			<input
				type="search"
				placeholder="Search editions or collections"
				class="input-bordered input input-sm w-full"
				bind:value={searchQuery}
			/>
		</label>
		<div class="form-control min-w-48">
			<label class="sr-only" for="workflow-collection-filter">Collection</label>
			<FloatingSelect
				id="workflow-collection-filter"
				bind:value={collectionFilter}
				options={collectionFilterOptions}
				class="input-sm w-full sm:w-56"
			/>
		</div>
		{#if hasActiveFilters}
			<button
				type="button"
				class="btn btn-ghost btn-sm"
				onclick={() => {
					searchQuery = '';
					collectionFilter = '';
				}}
			>
				Clear
			</button>
		{/if}
	</div>

	<!-- Tabs -->
	<div class="workflow-tabs mb-6 tabs border-b border-base-300">
		{#each stageTabs as stage (stage.hrefStatus)}
			<button
				class="tab"
				class:tab-active={activeTab === stage.hrefStatus}
				class:font-semibold={activeTab === stage.hrefStatus}
				aria-pressed={activeTab === stage.hrefStatus}
				onclick={() => (activeTab = stage.hrefStatus)}
			>
				{stage.label}
				<span class="ml-1 badge badge-sm" class:badge-neutral={stage.editions.length > 0}>{stage.editions.length}</span>
			</button>
		{/each}
		<button
			class="tab"
			class:tab-active={activeTab === 'all'}
			class:font-semibold={activeTab === 'all'}
			aria-pressed={activeTab === 'all'}
			onclick={() => (activeTab = 'all')}
		>
			All
			<span class="ml-1 badge badge-sm" class:badge-neutral={filteredBaseEditions.length > 0}>{filteredBaseEditions.length}</span>
		</button>
	</div>

	{#if isLoading}
		<div class="flex items-center justify-center py-12">
			<span class="loading loading-lg loading-spinner"></span>
		</div>
	{:else if visibleEditions.length === 0}
		<p class="py-8 text-center text-base-content/60">
			{activeTab === 'all'
				? 'No editions match the selected filters.'
				: `No editions in ${selectedStage?.label ?? 'this step'} match the selected filters.`}
		</p>
	{:else}
		<div class="space-y-2">
			{#each visibleEditions as edition (edition.id)}
				{#if [EditionStatus.PublicationRequested, EditionStatus.Published].includes(edition.status)}
					{@render publishCard(edition)}
				{:else}
					{@render editionCard(
						edition,
						edition.status.startsWith('final')
							? ReviewStage.Final
							: edition.status.startsWith('alpha')
								? ReviewStage.Alpha
								: ReviewStage.Concept,
						edition.status === EditionStatus.ConceptSubmitted
					)}
				{/if}
			{/each}
		</div>
	{/if}
</div>

{#if overrideEdition}
	<div class="modal-open modal">
		<div class="modal-box">
			<h3 class="text-lg font-bold">Administrative workflow intervention</h3>
			<p class="mt-2 text-sm text-base-content/70">
				Move <strong>{overrideEdition.title}</strong> from
				{STATUS_LABELS[overrideEdition.status]} with an audited reason.
			</p>
			<div class="mt-4 alert text-sm alert-warning">
				This bypasses transition prerequisites only. It does not create or release reviews, apply a
				peer-review stamp, confirm publication rights, or publish the edition.
			</div>
			<label class="form-control mt-4">
				<span class="label"><span class="label-text">Target workflow stage</span></span>
				<select class="select-bordered select" bind:value={overrideStatus}>
					{#each overrideTargets[overrideEdition.status] || [] as status (status)}
						<option value={status}>{STATUS_LABELS[status]}</option>
					{/each}
				</select>
			</label>
			<label class="form-control mt-4">
				<span class="label"><span class="label-text">Override reason (audited)</span></span>
				<textarea
					class="textarea-bordered textarea"
					rows="4"
					maxlength="5000"
					bind:value={overrideReason}
					placeholder="Explain the prerequisite exception or why this review round is reopening."
				></textarea>
			</label>
			<div class="modal-action">
				<button
					class="btn btn-ghost"
					disabled={actionLoading}
					onclick={() => (overrideEdition = null)}>Cancel</button
				>
				<button
					class="btn btn-primary"
					disabled={actionLoading || !overrideStatus || !overrideReason.trim()}
					onclick={applyOverride}
				>
					{#if actionLoading}<span class="loading loading-sm loading-spinner"></span>{/if}
					Record intervention
				</button>
			</div>
		</div>
		<button
			class="modal-backdrop"
			disabled={actionLoading}
			onclick={() => (overrideEdition = null)}
			aria-label="Close administrative workflow intervention"
		></button>
	</div>
{/if}

<!-- Publish Modal -->
{#if publishModalEdition}
	<div class="modal-open modal">
		<div class="modal-box">
			<h3 class="text-lg font-bold">Publish Edition</h3>
			<p class="mt-2">
				Publish <strong>{publishModalEdition.title}</strong>?
			</p>

			{#if publishModalEdition.peerReviewRequested}
				<div class="mt-4 alert alert-info">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
						class="size-6 shrink-0 stroke-current"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
						/>
					</svg>
					<div>
						<p class="font-semibold">Peer review stamp will be applied</p>
						<p class="text-sm">
							Released Final Reviews will become public using each reviewer's chosen attribution.
							Alpha feedback stays private.
						</p>
					</div>
				</div>
			{:else}
				<div class="mt-4 alert">
					<p>This edition will be published without a peer review stamp.</p>
				</div>
			{/if}

			<div class="modal-action">
				<button
					class="btn btn-ghost"
					onclick={() => (publishModalEdition = null)}
					disabled={actionLoading}
				>
					Cancel
				</button>
				<button
					class="btn btn-primary"
					onclick={() => publishModalEdition && publishEdition(publishModalEdition)}
					disabled={actionLoading ||
						!canTransitionStatus(publishModalEdition.status, EditionStatus.Published)}
				>
					{#if actionLoading}
						<span class="loading loading-sm loading-spinner"></span>
					{/if}
					Confirm Publish
				</button>
			</div>
		</div>
		<button
			class="modal-backdrop"
			onclick={() => (publishModalEdition = null)}
			aria-label="Close publish modal"
		></button>
	</div>
{/if}

{#snippet assignmentTable(assignments: ReviewAssignment[], reviews: EditionReview[])}
	<div>
		<h4 class="mb-2 text-sm font-semibold text-base-content/60 uppercase">Assigned Reviewers</h4>
		<div class="overflow-x-auto">
			<table class="table table-sm">
				<thead>
					<tr>
						<th>Reviewer</th>
						<th>Status</th>
						<th>Deadline</th>
						<th><span class="sr-only">Actions</span></th>
					</tr>
				</thead>
				<tbody>
					{#each assignments as assignment (assignment.id)}
						{@const hasReview = reviews.some(
							(review) => review.reviewerId === assignment.reviewerId
						)}
						<tr>
							<td>{userLookup.get(assignment.reviewerId) || 'Unknown'}</td>
							<td>
								{#if assignment.status === ReviewAssignmentStatus.Declined}<span
										class="badge badge-ghost badge-sm">Declined</span
									>{:else if hasReview}
									<span class="badge badge-sm badge-success">Reviewed</span>
								{:else}
									<span class="badge badge-ghost badge-sm">Pending</span>
								{/if}
							</td>
							<td class="text-base-content/60">
								{assignment.dueAt ? formatDate(assignment.dueAt) : 'Not set'}
							</td>
							<td>
								{#if !hasReview && [ReviewAssignmentStatus.Pending, ReviewAssignmentStatus.Accepted].includes(assignment.status)}
									<button
										class="btn btn-ghost btn-xs"
										disabled={actionLoading}
										onclick={() => removePendingAssignment(assignment)}
									>
										Remove
									</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/snippet}

<style>
	.workflow-tabs .tab-active {
		box-shadow: inset 0 -2px var(--color-accent);
	}
</style>

{#snippet assignmentControls(
	edition: WfEdition,
	stage: ReviewStage,
	isSubmission: boolean,
	assignments: ReviewAssignment[]
)}
	<div class="flex flex-wrap items-end gap-2">
		{#if !isSubmission || needsConceptReviewerAssignment(assignments)}<div class="form-control">
				<UserSearchSelect
					users={allUsers.filter((user) =>
						assignments.every((assignment) => assignment.reviewerId !== user.id)
					)}
					bind:value={assignUserId}
					placeholder="Search user..."
				/>
			</div>{/if}
		{#if !isSubmission}<label class="text-sm" for="assignment-deadline"
				>Deadline<input
					id="assignment-deadline"
					class="input-bordered input input-sm block"
					type="date"
					bind:value={assignDueAt}
				/></label
			>{/if}
		{#if stage === ReviewStage.Final}<label class="text-sm" for="replacement-reason"
				>Reason for reviewer replacement<input
					id="replacement-reason"
					class="input-bordered input input-sm block"
					bind:value={replacementReason}
				/></label
			>{/if}
		<button
			class="btn btn-sm btn-primary"
			onclick={() =>
				isSubmission ? assignAndStartReview(edition) : assignStageReviewer(edition, stage)}
			disabled={(!assignUserId &&
				(!isSubmission || needsConceptReviewerAssignment(assignments))) ||
				actionLoading}
		>
			{#if actionLoading}
				<span class="loading loading-xs loading-spinner"></span>
			{/if}
			{isSubmission
				? needsConceptReviewerAssignment(assignments)
					? 'Assign & Start Review'
					: 'Start Review'
				: 'Assign'}
		</button>
	</div>
{/snippet}

{#snippet editionSummary(edition: WfEdition, linkLabel: string)}
	<aside class="space-y-4 rounded-box border border-base-300 bg-base-200/30 p-4">
		<h3 class="font-semibold">Edition summary</h3>
		<dl class="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-2 text-sm">
			<dt class="font-semibold">Authors</dt>
			<dd>{edition.authorNames || 'Not provided'}</dd>
			{#if edition.collectionTitle}
				<dt class="font-semibold">Collection</dt>
				<dd>{edition.collectionTitle}</dd>
			{/if}
			<dt class="font-semibold">Purpose</dt>
			<dd class="line-clamp-3 break-words">{edition.record.proposalPurpose || 'Not provided'}</dd>
		</dl>
		<a class="link text-sm font-medium" href={workflowStepHref(edition.id, edition.status)}>{linkLabel}</a>
	</aside>
{/snippet}

{#snippet advancedActions(edition: WfEdition)}
	{#if overrideTargets[edition.status]?.length}
		<details class="rounded-box border border-base-300 bg-base-100">
			<summary class="cursor-pointer px-4 py-3 font-medium">Advanced actions</summary>
			<div class="border-t border-base-300 p-4">
				<h4 class="text-sm font-semibold text-base-content/60 uppercase">
					Administrative intervention
				</h4>
				<p class="mt-1 text-sm text-base-content/60">
					Advance or reopen this workflow when documented prerequisites require an exception.
				</p>
				<button class="btn mt-2 btn-outline btn-sm" onclick={() => openOverride(edition)}>
					Override workflow
				</button>
			</div>
		</details>
	{/if}
{/snippet}

{#snippet openEditionLink(edition: WfEdition)}
	<a
		class="btn btn-outline btn-sm shrink-0"
		href={resolve('/editions/[slug]', { slug: edition.id })}
		aria-label={`Open edition: ${edition.title}`}
	>
		Open edition
	</a>
{/snippet}

{#snippet publishCard(edition: WfEdition)}
	<div class="overflow-hidden rounded-box border border-base-300 bg-base-100">
		<div class="flex items-center bg-base-200/50 pr-4">
		<button
			class="flex min-w-0 flex-1 cursor-pointer items-center justify-between p-4 font-medium"
			onclick={() => toggleExpand(edition.id)}
			aria-expanded={expandedId === edition.id}
		>
			{@render expandIcon(edition.id)}
			<div class="min-w-0 flex-1 text-left">
				<div>{edition.title}</div>
				<div class="mt-1 text-sm font-normal text-base-content/60">
					{edition.authorNames || 'Authors unavailable'}
					<span aria-hidden="true"> · </span>
					{STATUS_LABELS[edition.status]}
				</div>
			</div>
			<span class="ml-4 flex shrink-0 items-center gap-2 text-sm text-base-content/70">
				{edition.status === EditionStatus.Published ? 'View publication' : 'Review readiness'}
			</span>
		</button>
		{@render openEditionLink(edition)}
		</div>
		{#if expandedId === edition.id}
			{@const finalAssignments = editionAssignments(edition.id, ReviewStage.Final).filter(
				(assignment) => assignment.status !== ReviewAssignmentStatus.Declined
			)}
			{@const finalReviews = editionReviews(edition.id, ReviewStage.Final)}
			<div class="space-y-4 border-t border-base-300 px-4 pt-3 pb-4">
				<div class="border-b border-base-300 pb-4">
					<WorkflowTimeline
						showStatusDetails={false}
						currentStatus={edition.status}
						hrefForStatus={(status) => workflowStepHref(edition.id, status)}
					/>
				</div>
				<div class="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(17rem,2fr)]">
					<section class="space-y-4">
						{#if edition.status === EditionStatus.Published}
							<h3 class="text-lg font-semibold">Published edition</h3>
							<dl class="space-y-2 text-sm">
								<div>
									<dt class="font-semibold">Publication date</dt>
									<dd>{edition.publishedAt ? formatDate(edition.publishedAt) : 'Unavailable'}</dd>
								</div>
								<div>
									<dt class="font-semibold">Peer review stamp</dt>
									<dd>{edition.peerReviewStamp ? 'Applied' : 'Not applied'}</dd>
								</div>
							</dl>
							<a class="btn btn-outline btn-sm" href={resolve('/editions/[slug]', { slug: edition.id })}>
								View published edition
							</a>
						{:else}
							<h3 class="text-lg font-semibold">Publication readiness</h3>
							<dl class="space-y-3 text-sm">
								<div>
									<dt class="font-semibold">Rights declaration</dt>
									<dd>{edition.record.publicationRequest?.rightsConfirmed ? 'Confirmed by author' : 'Not confirmed'}</dd>
								</div>
								<div>
									<dt class="font-semibold">Author statement</dt>
									<dd class="whitespace-pre-wrap">{edition.record.publicationRequest?.comment || 'No additional comments.'}</dd>
								</div>
								<div>
									<dt class="font-semibold">Final reviews</dt>
									<dd>{finalReviews.length} submitted for {finalAssignments.length} active assignments</dd>
								</div>
								<div>
									<dt class="font-semibold">Peer review publication</dt>
									<dd>{edition.peerReviewRequested ? 'Requested; released Final Reviews will be public' : 'Not requested'}</dd>
								</div>
							</dl>
							<button class="btn btn-sm btn-primary" onclick={() => (publishModalEdition = edition)} disabled={actionLoading}>
								Publish
							</button>
						{/if}
					</section>
					{@render editionSummary(
						edition,
						edition.status === EditionStatus.Published
							? 'Open publication workflow details'
							: 'Open publication request details'
					)}
				</div>
				{@render advancedActions(edition)}
			</div>
		{/if}
	</div>
{/snippet}

<!-- Reusable edition card snippet -->
{#snippet expandIcon(editionId: string)}
	<svg
		xmlns="http://www.w3.org/2000/svg"
		fill="none"
		viewBox="0 0 24 24"
		stroke-width="1.5"
		stroke="currentColor"
		aria-hidden="true"
		class="mr-3 size-4 shrink-0 transition-transform duration-200"
		class:rotate-90={expandedId === editionId}
	>
		<path stroke-linecap="round" stroke-linejoin="round" d="m9 4.5 7.5 7.5L9 19.5" />
	</svg>
{/snippet}

{#snippet editionCard(edition: WfEdition, stage: ReviewStage, isSubmission: boolean)}
	<div class="overflow-hidden rounded-box border border-base-300 bg-base-100">
		<div class="flex items-center bg-base-200/50 pr-4">
		<button
			class="flex min-w-0 flex-1 cursor-pointer items-center justify-between p-4 font-medium"
			onclick={() => toggleExpand(edition.id)}
			aria-expanded={expandedId === edition.id}
		>
			{@render expandIcon(edition.id)}
			{#if isSubmission}
				<div class="min-w-0 flex-1 text-left">
					<div>{edition.title}</div>
					<div class="mt-1 text-sm font-normal text-base-content/60">
						{edition.authorNames || 'Authors unavailable'}
						<span aria-hidden="true"> · </span>
						{edition.proposalSubmittedAt
							? formatDate(edition.proposalSubmittedAt)
							: 'Submission date unavailable'}
					</div>
				</div>
				<span class="ml-4 flex shrink-0 items-center gap-2 text-sm text-base-content/70">
					Assign for review
				</span>
			{:else}
				<div class="min-w-0 flex-1 text-left">
					<div>{edition.title}</div>
					<div class="mt-1 text-sm font-normal text-base-content/60">
						{edition.authorNames || 'Authors unavailable'}
						<span aria-hidden="true"> · </span>
						{edition.status === EditionStatus.ConceptAccepted ? 'Draft' : STATUS_LABELS[edition.status]}
					</div>
				</div>
				<span class="ml-4 flex shrink-0 items-center gap-2 text-sm text-base-content/70">
					{cardCue(edition.status)}
				</span>
			{/if}
		</button>
		{@render openEditionLink(edition)}
		</div>

		{#if expandedId === edition.id}
			{@const assignments = editionAssignments(edition.id, stage)}
			{@const activeAssignments = distinctActiveAssignments(assignments)}
			{@const reviews = editionReviews(edition.id, stage)}
			{@const activeReviews = reviews.filter((review) =>
				activeAssignments.some((assignment) => assignment.reviewerId === review.reviewerId)
			)}
			{@const verdict = aggregateVerdicts(activeReviews, activeAssignments.length)}
			{@const verdictTarget =
				verdict === 'pending' ? null : getTargetStatusFromVerdict(verdict, stage)}
			{@const displayReviews = anonymizeReviews(activeReviews, activeAssignments, userLookup, true)}
			<div class="space-y-4 border-t border-base-300 px-4 pt-3 pb-4">
				<div class="space-y-3 border-b border-base-300 pb-4">
					<WorkflowTimeline
						showStatusDetails={false}
						currentStatus={edition.status}
						hrefForStatus={(status) => workflowStepHref(edition.id, status)}
					/>
				</div>
				{#if isSubmission}
					<div class="grid items-start gap-6 lg:grid-cols-2">
						<aside class="space-y-5 rounded-box border border-base-300 bg-base-200/50 p-4">
							<div>
								<h3 class="mb-1 text-lg font-semibold">Assign board member</h3>
								<p class="mb-3 text-sm text-base-content/60">
									Assign a board member and move this proposal into editorial review.
								</p>
								{@render assignmentControls(edition, stage, true, assignments)}
							</div>
							{#if assignments.length > 0}
								{@render assignmentTable(assignments, reviews)}
							{/if}
						</aside>
						<div class="space-y-4">
							<dl class="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-2 text-sm">
								<dt class="font-semibold">Authors</dt>
								<dd>{edition.authorNames || 'Not provided'}</dd>
								<dt class="font-semibold">Purpose</dt>
								<dd class="line-clamp-3 break-words">{edition.record.proposalPurpose || 'Not provided'}</dd>
							</dl>
							<a
								class="btn btn-primary btn-sm"
								style="text-decoration: none;"
								href={resolve('/editions/[slug]/workflow', { slug: edition.id })}
								target="_blank"
								rel="noopener noreferrer"
							>
								View proposal
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="1.5"
									class="size-4"
									aria-hidden="true"
								>
									<path stroke-linecap="round" stroke-linejoin="round" d="M7 17 17 7M7 7h10v10" />
								</svg>
								<span class="sr-only">(opens in a new tab)</span>
							</a>
						</div>
					</div>
				{:else}
					<div class="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(17rem,2fr)]">
						<section class="space-y-5">
							{#if edition.status === EditionStatus.EditorialReview}
								<h3 class="text-lg font-semibold">Editorial review</h3>
								{#if assignments.length > 0}
									{@render assignmentTable(assignments, reviews)}
								{:else}
									<p class="text-sm text-base-content/60">Awaiting board member assignment.</p>
								{/if}
								{#if displayReviews.length > 0}
									<div>
										<h4 class="mb-2 text-sm font-semibold text-base-content/60 uppercase">Reviews</h4>
										<div class="space-y-2">
											{#each displayReviews as review (review.created)}
												<div class="rounded-lg border border-base-300 p-3">
													<div class="flex items-center justify-between gap-3">
														<span class="font-medium">{review.displayName}</span>
														<span class="badge badge-sm {review.decision === 'approve' ? 'badge-success' : review.decision === 'reject' ? 'badge-error' : 'badge-warning'}">
															{review.decision === 'approve' ? 'Approve' : review.decision === 'reject' ? 'Reject' : 'Revisions'}
														</span>
													</div>
													{#if review.comment}<p class="mt-2 text-sm text-base-content/70">{review.comment}</p>{/if}
													<p class="mt-1 text-xs text-base-content/40">{formatDate(review.created)}</p>
												</div>
											{/each}
										</div>
									</div>
								{/if}
								{#if assignments.length > 0}
									{#if verdict === 'pending'}
										<p class="text-sm text-base-content/60">Awaiting review.</p>
									{:else}
										<div class="flex flex-wrap items-center gap-3">
											<span class="text-sm font-semibold">Editorial recommendation</span>
											<span class="badge {getVerdictBadge(verdict)}">{getVerdictLabel(verdict)}</span>
											{#if verdict === 'accept'}
												<p class="text-sm text-base-content/60">
													Unanimous approval advances the proposal automatically.
												</p>
											{:else if verdictTarget && canTransitionStatus(edition.status, verdictTarget)}
												<button class="btn btn-sm btn-primary" onclick={() => applyVerdict(edition, stage)} disabled={actionLoading}>
													{#if actionLoading}<span class="loading loading-xs loading-spinner"></span>{/if}
													Apply editorial decision
												</button>
											{/if}
										</div>
									{/if}
								{/if}
							{:else if edition.status === EditionStatus.AlphaReview}
								<div>
									<h3 class="mb-2 text-lg font-semibold">Alpha reviewer assignments</h3>
									{@render assignmentControls(edition, ReviewStage.Alpha, false, assignments)}
								</div>
								{#if assignments.length > 0}{@render assignmentTable(assignments, reviews)}{/if}
								{#key assignments.length}<AlphaEditorialPanel editionId={edition.id} round={edition.alphaReviewRound} onchanged={() => void loadData()} embedded />{/key}
							{:else if edition.status === EditionStatus.FinalReview}
								<div>
									<h3 class="mb-2 text-lg font-semibold">Final reviewer assignments</h3>
									{@render assignmentControls(edition, ReviewStage.Final, false, assignments)}
								</div>
								{#if assignments.length > 0}{@render assignmentTable(assignments, reviews)}{/if}
								<FinalEditorialPanel editionId={edition.id} status={edition.status} round={edition.finalReviewRound} onchanged={() => void loadData()} embedded showAssignments={false} />
							{:else if edition.status === EditionStatus.ConceptAccepted}
								<h3 class="text-lg font-semibold">Awaiting Alpha review request</h3>
								<p class="text-sm text-base-content/60">The author is preparing the edition before requesting Alpha Review.</p>
							{:else if edition.status === EditionStatus.AlphaRevisions}
								<h3 class="text-lg font-semibold">Awaiting Alpha revisions</h3>
								<p class="text-sm text-base-content/60">Released feedback is with the author for the next Alpha round.</p>
							{:else if edition.status === EditionStatus.AlphaAccepted}
								<h3 class="text-lg font-semibold">Awaiting Final review request</h3>
								<p class="text-sm text-base-content/60">Alpha Review is complete. The author is preparing the Final submission.</p>
							{:else if edition.status === EditionStatus.FinalRevisions}
								<h3 class="text-lg font-semibold">Awaiting Final revisions</h3>
								<p class="text-sm text-base-content/60">Released Final feedback is with the author for correction.</p>
							{:else if edition.status === EditionStatus.FinalAccepted}
								<h3 class="text-lg font-semibold">Awaiting publication request</h3>
								<p class="text-sm text-base-content/60">Final Review is complete. Publication still requires the author's request and rights confirmation.</p>
							{:else}
								<p class="text-sm text-base-content/60">No stage-specific editorial action is available.</p>
							{/if}
						</section>
						{@render editionSummary(
							edition,
							edition.status === EditionStatus.ConceptAccepted
								? 'Open draft edition'
								: edition.status === EditionStatus.EditorialReview
								? 'Open editorial review details'
								: stage === ReviewStage.Alpha
									? 'Open Alpha workflow details'
									: stage === ReviewStage.Final
										? 'Open Final workflow details'
										: 'Open workflow details'
						)}
					</div>
				{/if}

				{@render advancedActions(edition)}

			</div>
		{/if}
	</div>
{/snippet}
