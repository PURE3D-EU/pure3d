<script lang="ts">
	import ProposalQuestionnaire from '$lib/components/workflow/ProposalQuestionnaire.svelte';
	import { workflowStages } from '$lib/workflow/presentation';
	import CreditsEditor from '$lib/components/ui/CreditsEditor.svelte';
	import type { Credit } from '$lib/types/credits';
	import { readCredits, validateCredits } from '$lib/utils/credits';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { pb } from '$lib/database/client';
	import { authStore } from '$lib/database/stores/auth.svelte';
	import {
		CollectionRole,
		EditionStatus,
		GlobalRole,
		ReviewStage,
		type UserRoleContext
	} from '$lib/types/roles';
	import { canDeleteEdition } from '$lib/utils/permissions';
	import { ReviewDecision } from '$lib/types/reviews';
	import type { EditionReview, ReviewAssignment } from '$lib/types/reviews';
	import { updateEditionStatus } from '$lib/database/edition-helpers';
	import { anonymizeReviews } from '$lib/utils/review-helpers';
	import StatusBadge from '$lib/components/workflow/StatusBadge.svelte';
	import ReviewForm from '$lib/components/workflow/ReviewForm.svelte';
	import CollaboratorManager from '$lib/components/workflow/CollaboratorManager.svelte';
	import ReviewFeedbackForm from '$lib/components/workflow/ReviewFeedbackForm.svelte';
	import ReviewFeedbackList from '$lib/components/workflow/ReviewFeedbackList.svelte';
	import RichTextEditor from '$lib/components/ui/RichTextEditor.svelte';
	import SearchableSelect from '$lib/components/ui/SearchableSelect.svelte';
	import EditionAssetsPanel from '$lib/components/uploads/EditionAssetsPanel.svelte';
	import ProposalModelUploads from '$lib/components/uploads/ProposalModelUploads.svelte';
	import ProposalSummary from '$lib/components/workflow/ProposalSummary.svelte';
	import ReadOnlyProposal from '$lib/components/workflow/ReadOnlyProposal.svelte';
	import AlphaRequestForm from '$lib/components/workflow/AlphaRequestForm.svelte';
	import ReviewWorkspace from '$lib/components/workflow/ReviewWorkspace.svelte';
	import AlphaReviewProgress from '$lib/components/workflow/AlphaReviewProgress.svelte';
	import AlphaEditorialPanel from '$lib/components/workflow/AlphaEditorialPanel.svelte';
	import FinalRequestForm from '$lib/components/workflow/FinalRequestForm.svelte';
	import FinalReviewProgress from '$lib/components/workflow/FinalReviewProgress.svelte';
	import FinalEditorialPanel from '$lib/components/workflow/FinalEditorialPanel.svelte';
	import { STATUS_LABELS } from '$lib/types/roles';
	import { DraftAutosave, type SaveState } from '$lib/workflow/autosave';
	import VoyagerPreview from '$lib/components/uploads/VoyagerPreview.svelte';
	import CoverImageUpload from '$lib/components/uploads/CoverImageUpload.svelte';
	import {
		formatOpenCallDeadline,
		MODEL_SOURCES,
		PROPOSAL_TYPES,
		proposalErrors,
		type ProposalOpenCallSnapshot,
		wordCount
	} from '$lib/workflow/proposal';
	import {
		metadataOptions,
		metadataValues,
		vocabularyValues
	} from '$lib/components/editions/metadata';
	import toast from 'svelte-french-toast';
	import type { RecordModel } from 'pocketbase';

	interface Edition {
		id: string;
		title: string;
		description: string;
		status: EditionStatus;
		collectionId: string;
		collectionTitle: string;
		peerReviewRequested: boolean;
		created: string;
		proposalSubmittedAt: string;
	}

	let edition = $state<Edition | null>(null);
	let editionRecord = $state<RecordModel | null>(null);
	let isSandbox = $state(false);
	let sandboxTargets = $state<RecordModel[]>([]);
	let transferTargetId = $state('');
	let isTransferring = $state(false);
	let transferDialog: HTMLDialogElement;
	let isLoading = $state(true);
	let assignments = $state<ReviewAssignment[]>([]);
	let reviews = $state<EditionReview[]>([]);
	let userLookup = $state(new Map<string, string>());
	let isAuthor = $state(false);
	let isCollaborator = $state(false);
	let editionAssetsBusy = $state(false);
	let coverBusy = $state(false);
	let isReviewer = $state(false);
	let myAssignment = $state<ReviewAssignment | null>(null);
	let myExistingReview = $state<EditionReview | null>(null);
	let isAdmin = $derived(authStore.globalRole === GlobalRole.Admin);
	let collectionRole = $state<CollectionRole | undefined>(undefined);
	let roleContext = $derived<UserRoleContext>({
		globalRole: authStore.globalRole,
		collectionRole
	});
	let canDelete = $derived(!!edition && (isSandbox || canDeleteEdition(roleContext)));
	let showDeleteModal = $state(false);
	let isDeleting = $state(false);
	let unpublishDialog: HTMLDialogElement;
	let unpublishReason = $state('');

	// Concept form state
	let conceptTitle = $state('');
	let conceptDescription = $state('');
	let conceptPeerReview = $state(false);
	let conceptDcSubtitle = $state('');
	let credits = $state<Credit[]>([]);
	let editableCredits = $state<Credit[]>([]);
	let creditsDialog: HTMLDialogElement;
	let alphaRequestDialog: HTMLDialogElement;
	let flushingForReview = false;
	let conceptDcInstitution = $state('');
	let conceptDcSubject = $state<string[]>([]);
	let conceptDcKeyword = $state('');
	let conceptDcCoveragePlace = $state('');
	let conceptDcAudience = $state<string[]>([]);
	let conceptDcCoverageCountry = $state<string[]>([]);
	let conceptDcCoveragePeriod = $state<string[]>([]);
	let conceptDcCoverageTemporal = $state('');
	let conceptDcLanguage = $state<string[]>([]);
	let conceptDcSource = $state<string[]>([]);
	let conceptDcRightsHolder = $state('');
	let conceptDcRightsLicense = $state('');
	let conceptDcContact = $state('');
	let conceptDcDatePublished = $state('');
	let conceptDcProvenance = $state('');
	let metadataVocabulary = $state<Array<{ category?: string; name?: string; value?: string }>>([]);
	let proposalType = $state('');
	let proposalOpenCall = $state('');
	let proposalOpenCalls = $state<ProposalOpenCallSnapshot[]>([]);
	let proposalOpenCallSnapshot = $state<ProposalOpenCallSnapshot | null>(null);
	let proposalPurpose = $state('');
	let proposalArgument = $state('');
	let proposalThreeDRationale = $state('');
	let proposalAudience = $state<string[]>([]);
	let proposalContextualMaterial = $state('');
	let proposalHasExistingModel = $state(false);
	let proposalModelSources = $state<string[]>([]);
	let proposalCopyrightOwnership = $state('');
	let proposalDigitisationSituation = $state('');
	let proposalSupportingLinks = $state('');
	let isUploadingSupporting = $state(false);
	let isUploadingModel = $state(false);
	let authorAffiliations = $state<Record<string, string>>({});
	let isSubmitting = $state(false);
	let submitDialog: HTMLDialogElement;
	let draft: DraftAutosave<ReturnType<typeof activeFormData>> | null = null;
	let workflowDisposed = false;
	let formReady = $state(false);
	let saveStatus = $state<'saved' | 'saving' | 'unsaved' | 'error'>('saved');
	let isSaving = $derived(saveStatus === 'saving');
	let alphaContextSaveStatus = $state<SaveState>('saved');
	const effectiveSaveStatus = $derived(
		saveStatus === 'error' || alphaContextSaveStatus === 'error'
			? 'error'
			: saveStatus === 'saving' || alphaContextSaveStatus === 'saving'
				? 'saving'
				: saveStatus === 'unsaved' || alphaContextSaveStatus === 'unsaved'
					? 'unsaved'
					: 'saved'
	);
	let saveError = $state('');

	// Viewer-mirror layout state
	let activeFormTab = $state<'description' | 'metadata' | 'peer-review' | 'team'>('description');

	// Scene/viewer state
	let editionPubNum = $state(0);
	let collectionPubNum = $state(0);

	function jsonArrayToString(val: unknown): string {
		return metadataValues(val).join(', ');
	}

	function stringToJsonArray(val: string): string[] {
		return val
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
	}

	function openCallSnapshot(value: unknown): ProposalOpenCallSnapshot | null {
		if (!value || typeof value !== 'object') return null;
		const call = (value as { openCall?: unknown }).openCall;
		if (!call || typeof call !== 'object') return null;
		const { id, title, deadline } = call as Partial<ProposalOpenCallSnapshot>;
		return typeof id === 'string' && typeof title === 'string' && typeof deadline === 'string'
			? { id, title, deadline }
			: null;
	}

	function toggleSelection(values: string[], value: string, checked: boolean): string[] {
		return checked ? [...new Set([...values, value])] : values.filter((item) => item !== value);
	}

	function optionsFor(category: string, values: string[]): string[] {
		return metadataOptions(values, vocabularyFor(category));
	}

	function vocabularyFor(category: string): string[] {
		return vocabularyValues(metadataVocabulary, category);
	}

	function arrayInput(event: Event): string[] {
		return stringToJsonArray((event.currentTarget as HTMLInputElement).value);
	}

	let saveStatusText = $derived.by(() => {
		if (effectiveSaveStatus === 'error') return "Couldn't save";
		if (editionAssetsBusy || coverBusy) return 'Asset work in progress';
		if (effectiveSaveStatus === 'saving') return 'Saving...';
		if (effectiveSaveStatus === 'unsaved') return 'Unsaved changes';
		return 'All changes saved';
	});
	let saveStatusClass = $derived.by(() => {
		if (effectiveSaveStatus === 'error') return 'text-error';
		if (effectiveSaveStatus === 'unsaved') return 'text-warning';
		if (effectiveSaveStatus === 'saving' || editionAssetsBusy || coverBusy)
			return 'text-base-content/60';
		return 'text-success';
	});
	$effect(() => {
		if (!formReady || !edition || viewMode !== 'concept-form') return;
		draft?.set(activeFormData());
	});

	// Determine the current review stage based on edition status
	let currentStage = $derived.by<number | null>(() => {
		if (!edition) return null;
		switch (edition.status) {
			case EditionStatus.ConceptSubmitted:
			case EditionStatus.EditorialReview:
				return ReviewStage.Concept;
			case EditionStatus.AlphaReview:
			case EditionStatus.AlphaRevisions:
				return ReviewStage.Alpha;
			case EditionStatus.FinalReview:
			case EditionStatus.FinalRevisions:
				return ReviewStage.Final;
			default:
				return null;
		}
	});

	// Which view to show
	let viewMode = $derived.by<'concept-form' | 'review-form' | 'status-view'>(() => {
		if (!edition) return 'status-view';
		if (
			(isAuthor ||
				isCollaborator ||
				isAdmin ||
				collectionRole === CollectionRole.Owner ||
				collectionRole === CollectionRole.Editor) &&
			![
				EditionStatus.ConceptSubmitted,
				EditionStatus.EditorialReview,
				EditionStatus.ConceptRejected,
				EditionStatus.AlphaReview,
				EditionStatus.FinalReview,
				EditionStatus.PublicationRequested,
				EditionStatus.Published
			].includes(edition.status)
		) {
			return 'concept-form';
		}

		// Reviewers see review form if assigned and haven't submitted yet
		if (isReviewer && myAssignment && !myExistingReview && currentStage !== null) {
			return 'review-form';
		}

		return 'status-view';
	});

	// Anonymized reviews for display
	let displayReviews = $derived.by(() => {
		if (!edition) return [];
		return anonymizeReviews(
			reviews.filter((review) => review.reviewStage !== ReviewStage.Alpha),
			assignments,
			userLookup,
			isAdmin
		);
	});

	// Can the author manage collaborators?
	let canManageCollaborators = $derived(
		!isSandbox &&
			isAuthor &&
			edition !== null &&
			[
				EditionStatus.Draft,
				EditionStatus.ConceptRejected,
				EditionStatus.ConceptAccepted,
				EditionStatus.AlphaAccepted,
				EditionStatus.AlphaRevisions,
				EditionStatus.FinalRevisions,
				EditionStatus.FinalAccepted
			].includes(edition.status)
	);

	// Can the author resolve feedback items?
	let canResolveFeedback = $derived(
		isAuthor &&
			edition !== null &&
			[EditionStatus.AlphaRevisions, EditionStatus.FinalRevisions].includes(edition.status)
	);
	let canSubmitConcept = $derived(edition?.status === EditionStatus.Draft && !isSandbox);
	let canViewEdition = $derived(
		edition !== null &&
			(isSandbox ||
				![
					EditionStatus.Draft,
					EditionStatus.ConceptSubmitted,
					EditionStatus.EditorialReview,
					EditionStatus.ConceptRejected
				].includes(edition.status))
	);

	const currentWorkflowStageIndex = $derived.by(() => {
		const currentEdition = edition;
		if (!currentEdition) return 0;
		const index = workflowStages.findIndex((stage) =>
			stage.statuses.includes(currentEdition.status)
		);
		return index === -1 ? 0 : index;
	});

	function workflowStageState(index: number): 'complete' | 'current' | 'future' {
		if (index < currentWorkflowStageIndex) return 'complete';
		if (index === currentWorkflowStageIndex) return 'current';
		return 'future';
	}

	const nextWorkflowAction = $derived.by(() => {
		if (!edition) return '';
		if (canSubmitConcept) return 'Submit proposal for review when it is ready.';
		if (edition.status === EditionStatus.ConceptAccepted)
			return 'Prepare the edition, then request Alpha Review when it is ready.';
		if (edition.status === EditionStatus.AlphaRevisions)
			return 'Read the released feedback, revise the edition, then request another Alpha round from the Review tab.';
		if (edition.status === EditionStatus.AlphaReview)
			return 'Alpha Review is in progress. Editing is locked until the editorial decision.';
		if ([EditionStatus.AlphaAccepted, EditionStatus.FinalRevisions].includes(edition.status))
			return 'Revise the edition and explain your response to feedback, then request Final Review from the Review tab.';
		if (edition.status === EditionStatus.FinalReview)
			return 'Final Review is in progress. Editing is locked until the editorial decision.';
		if (edition.status === EditionStatus.FinalAccepted)
			return 'Make final corrections, confirm material rights, and request publication from the Review tab.';
		if (edition.status === EditionStatus.PublicationRequested)
			return 'Publication has been requested. Editing is locked while the editors make their decision.';
		if (edition.status === EditionStatus.Published)
			return 'This edition is published and visible publicly.';
		return 'Your proposal is submitted. You can view it while the editorial team reviews it.';
	});

	// Reference to feedback list for reloading
	let feedbackListRef: ReviewFeedbackList | undefined = $state();

	// Previous rejection/revision feedback for display
	let previousFeedback = $derived.by(() => {
		if (!edition) return [];
		return reviews
			.filter(
				(r) =>
					r.decision === ReviewDecision.Reject || r.decision === ReviewDecision.RequestRevisions
			)
			.map((r) => ({
				comment: r.comment,
				decision: r.decision,
				created: r.created
			}));
	});

	function hasUnsavedChanges() {
		return (
			formReady &&
			!!edition &&
			viewMode === 'concept-form' &&
			(draft?.hasChanges(activeFormData()) ||
				isUploadingSupporting ||
				isUploadingModel ||
				editionAssetsBusy ||
				coverBusy)
		);
	}

	// SvelteKit requires this during component initialization, not from onMount.
	beforeNavigate((navigation) => {
		if (hasUnsavedChanges() && !confirm('Leave with unsaved proposal changes?'))
			navigation.cancel();
	});

	onMount(() => {
		if (!authStore.isAuthenticated) {
			goto(resolve('/'));
			return;
		}
		const beforeUnload = (event: BeforeUnloadEvent) => {
			if (!hasUnsavedChanges()) return;
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener('beforeunload', beforeUnload);
		void loadData();
		return () => {
			workflowDisposed = true;
			draft?.dispose();
			window.removeEventListener('beforeunload', beforeUnload);
		};
	});

	async function loadData() {
		draft?.dispose();
		draft = null;
		let loaded = false;
		isLoading = true;
		alphaContextSaveStatus = 'saved';
		formReady = false;
		const slug = $page.params.slug || '';

		try {
			// Load edition
			const edRecord = await pb.collection('editions').getOne(slug, {
				expand: 'collection'
			});
			if (workflowDisposed) return;
			editionRecord = edRecord;
			isSandbox = !!edRecord.isSandbox;
			edition = {
				id: edRecord.id,
				title: edRecord.dcTitle || edRecord.title || '',
				description: edRecord.dcAbstract || edRecord.dcDescription || '',
				status: (edRecord.status as EditionStatus) || EditionStatus.Draft,
				collectionId: edRecord.collection || '',
				collectionTitle: edRecord.expand?.collection?.title || '',
				peerReviewRequested: edRecord.peerReviewRequested || false,
				created: edRecord.created,
				proposalSubmittedAt: edRecord.proposalSubmittedAt || ''
			};

			// Initialize concept form
			if ($page.url.hash === '#edition-review-tab')
				activeFormTab = [EditionStatus.ConceptAccepted, EditionStatus.AlphaRevisions].includes(
					edition.status
				)
					? 'description'
					: 'peer-review';
			conceptTitle = edition.title;
			conceptDescription = edRecord.dcAbstract || '';
			conceptPeerReview = edition.peerReviewRequested;
			conceptDcSubtitle = edRecord.dcSubtitle || '';
			credits = readCredits(edRecord.credits);
			conceptDcInstitution = jsonArrayToString(edRecord.dcInstitution);
			conceptDcSubject = metadataValues(edRecord.dcSubject);
			conceptDcKeyword = jsonArrayToString(edRecord.dcKeyword);
			conceptDcCoveragePlace = edRecord.dcCoveragePlace || '';
			conceptDcAudience = metadataValues(edRecord.dcAudience);
			conceptDcCoverageCountry = metadataValues(edRecord.dcCoverageCountry);
			conceptDcCoveragePeriod = metadataValues(edRecord.dcCoveragePeriod);
			conceptDcCoverageTemporal = edRecord.dcCoverageTemporal || '';
			conceptDcLanguage = metadataValues(edRecord.dcLanguage);
			conceptDcSource = metadataValues(edRecord.dcSource);
			conceptDcRightsHolder = edRecord.dcRightsHolder || '';
			conceptDcRightsLicense = edRecord.dcRightsLicense || '';
			conceptDcContact = edRecord.dcContact || '';
			conceptDcDatePublished = edRecord.dcDatePublished || '';
			conceptDcProvenance = edRecord.dcProvenance || '';
			proposalType = edRecord.proposalType || '';
			proposalOpenCall = edRecord.proposalOpenCall || '';
			proposalOpenCallSnapshot = openCallSnapshot(edRecord.proposalSnapshot);
			proposalPurpose = edRecord.proposalPurpose || '';
			proposalArgument = edRecord.proposalArgument || '';
			proposalThreeDRationale = edRecord.proposalThreeDRationale || '';
			proposalAudience = Array.isArray(edRecord.proposalAudience) ? edRecord.proposalAudience : [];
			proposalContextualMaterial = edRecord.proposalContextualMaterial || '';
			proposalHasExistingModel = !!edRecord.proposalHasExistingModel;
			proposalModelSources = Array.isArray(edRecord.proposalModelSources)
				? edRecord.proposalModelSources
				: [];
			proposalCopyrightOwnership = edRecord.proposalCopyrightOwnership || '';
			proposalDigitisationSituation = edRecord.proposalDigitisationSituation || '';
			proposalSupportingLinks = Array.isArray(edRecord.proposalSupportingLinks)
				? edRecord.proposalSupportingLinks.join('\n')
				: '';
			authorAffiliations = {};
			if (credits.length === 0 && authStore.appUserId && edition.status === EditionStatus.Draft) {
				const profile = await pb.collection('users').getOne(authStore.appUserId);
				if (profile.affiliation) authorAffiliations = { [profile.id]: profile.affiliation };
				credits = [
					{
						type: 'person',
						name: profile.nickname || profile.email || 'Unnamed author',
						orcid: profile.orcid || null,
						role: 'creator',
						provenance: profile.orcidVerifiedAt ? 'oauth' : 'manual',
						userId: profile.id
					}
				];
			}
			const creditedUserIds = credits.map((credit) => credit.userId).filter(Boolean) as string[];
			if (creditedUserIds.length) {
				const users = await pb.collection('users').getList(1, creditedUserIds.length, {
					filter: creditedUserIds.map((id) => pb.filter('id = {:id}', { id })).join(' || ')
				});
				authorAffiliations = {
					...authorAffiliations,
					...Object.fromEntries(users.items.map((user) => [user.id, user.affiliation || '']))
				};
			}
			try {
				metadataVocabulary = await pb.collection('keywords').getFullList({ sort: 'value' });
			} catch {
				// The editor remains usable when an optional controlled vocabulary has not been imported.
				metadataVocabulary = [];
			}
			try {
				proposalOpenCalls = await pb.collection('open_calls').getFullList({
					filter: pb.filter('isPublished = true && (deadline = "" || deadline >= {:today})', {
						today: `${new Date().toISOString().slice(0, 10)} 00:00:00.000Z`
					}),
					sort: 'order,deadline,title',
					fields: 'id,title,deadline'
				});
			} catch {
				// General submission remains available while open calls are unavailable or not yet migrated.
				proposalOpenCalls = [];
			}

			// Initialize viewer/scene data
			editionPubNum = edRecord.pubNum || 0;
			collectionPubNum = edRecord.expand?.collection?.pubNum || 0;

			// Load user's relationship to this edition
			if (authStore.appUserId) {
				const edUsers = await pb.collection('editionUsers').getList(1, 10, {
					filter: `editionId = "${edition.id}" && userId = "${authStore.appUserId}"`
				});
				isAuthor = edUsers.items.some((r) => r.role === 'author');
				isCollaborator = edUsers.items.some((r) => r.role === 'collaborator');
				isReviewer = edUsers.items.some((r) => r.role === 'reviewer');

				if (edition.collectionId) {
					const collRoles = await pb.collection('collectionUsers').getList(1, 1, {
						filter: `collection = "${edition.collectionId}" && userId = "${authStore.appUserId}"`
					});
					collectionRole = (collRoles.items[0]?.role as CollectionRole) || undefined;
				}
			}

			// Load assignments and reviews
			const [assignResult, reviewResult] = await Promise.all([
				pb.collection('reviewAssignments').getList(1, 50, {
					filter: `editionId = "${edition.id}"`,
					sort: 'created'
				}),
				pb.collection('editionReviews').getList(1, 50, {
					filter: `editionId = "${edition.id}"`,
					sort: '-created'
				})
			]);

			assignments = assignResult.items.map((r) => ({
				reviewRound: r.reviewRound || 0,
				editionTitle: r.editionTitle || '',
				id: r.id,
				editionId: r.editionId,
				reviewerId: r.reviewerId,
				reviewStage: r.reviewStage,
				assignedBy: r.assignedBy,
				status: r.status,
				created: r.created,
				updated: r.updated
			}));

			reviews = reviewResult.items.map((r) => ({
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

			// Find current user's assignment and existing review
			if (authStore.appUserId) {
				myAssignment =
					assignments.find(
						(a) =>
							a.reviewerId === authStore.appUserId &&
							a.reviewStage === currentStage &&
							!['declined', 'completed'].includes(a.status) &&
							(a.reviewStage === ReviewStage.Concept ||
								a.reviewRound ===
									(edRecord[
										a.reviewStage === ReviewStage.Final ? 'finalReviewRound' : 'alphaReviewRound'
									] || 0))
					) || null;
				isReviewer = !!myAssignment;
				myExistingReview =
					reviews.find(
						(r) =>
							r.reviewerId === authStore.appUserId &&
							r.reviewStage === currentStage &&
							(r.reviewStage === ReviewStage.Concept ||
								(r.reviewRound ===
									(edRecord[
										r.reviewStage === ReviewStage.Final ? 'finalReviewRound' : 'alphaReviewRound'
									] || 0) &&
									r.reviewStatus === 'submitted'))
					) || null;
			}
			if (isSandbox && isAuthor && authStore.appUserId) {
				const memberships = await pb.collection('editionUsers').getFullList({
					filter: pb.filter('userId = {:user} && role = "author"', { user: authStore.appUserId })
				});
				const ids = memberships.map((membership) => membership.editionId).filter(Boolean);
				sandboxTargets = ids.length
					? (
							await pb.collection('editions').getList(1, 100, {
								filter: ids.map((id) => pb.filter('id = {:id}', { id })).join(' || ')
							})
						).items.filter(
							(record) => !record.isSandbox && record.status === EditionStatus.ConceptAccepted
						)
					: [];
			}

			// Build user lookup for display names
			const reviewerIds = [
				...new Set([...assignments.map((a) => a.reviewerId), ...reviews.map((r) => r.reviewerId)])
			];
			if (reviewerIds.length > 0) {
				const userResult = await pb.collection('users').getList(1, 100, {
					filter: reviewerIds.map((id) => `id = "${id}"`).join(' || ')
				});
				userLookup = new Map(
					userResult.items.map((u) => [u.id, u.nickname || u.email || 'Unknown'])
				);
			}

			if (workflowDisposed) return;
			// Auth guard: redirect if user has no relation and isn't admin
			if (
				!isAuthor &&
				!isCollaborator &&
				!isReviewer &&
				!isAdmin &&
				!collectionRole &&
				authStore.globalRole !== GlobalRole.EditorialBoard
			) {
				toast.error('You do not have access to this workflow');
				goto(resolve('/editions/[slug]', { slug }));
				return;
			}
			loaded = true;
		} catch (error) {
			if (workflowDisposed) return;
			console.error('Error loading workflow data:', error);
			toast.error('Failed to load workflow data');
			goto(resolve('/editions/[slug]', { slug }));
		} finally {
			if (loaded && edition && !workflowDisposed) {
				initializeDraft();
				saveStatus = 'saved';
				saveError = '';
				formReady = true;
			}
			isLoading = false;
		}
	}

	// --- Concept Form Actions ---
	function buildProposalData() {
		return {
			title: conceptTitle.trim(),
			dcTitle: conceptTitle.trim(),
			credits: readCredits(credits),
			proposalOpenCall,
			proposalType,
			proposalPurpose: proposalPurpose.trim(),
			proposalArgument: proposalArgument.trim(),
			proposalThreeDRationale: proposalThreeDRationale.trim(),
			proposalAudience,
			proposalContextualMaterial: proposalContextualMaterial.trim(),
			proposalHasExistingModel,
			proposalModelSources,
			proposalCopyrightOwnership: proposalCopyrightOwnership.trim(),
			proposalDigitisationSituation: proposalDigitisationSituation.trim(),
			proposalSupportingLinks: proposalSupportingLinks
				.split(/\r?\n/)
				.map((link) => link.trim())
				.filter(Boolean)
		};
	}

	function buildEditionData() {
		return {
			title: conceptTitle.trim(),
			dcTitle: conceptTitle.trim(),
			dcSubtitle: conceptDcSubtitle.trim(),
			dcAbstract: conceptDescription,
			credits: readCredits(credits),
			dcInstitution: stringToJsonArray(conceptDcInstitution),
			dcSubject: conceptDcSubject,
			dcKeyword: stringToJsonArray(conceptDcKeyword),
			dcCoveragePlace: conceptDcCoveragePlace.trim(),
			dcAudience: conceptDcAudience,
			dcCoverageCountry: conceptDcCoverageCountry,
			dcCoveragePeriod: conceptDcCoveragePeriod,
			dcCoverageTemporal: conceptDcCoverageTemporal.trim(),
			dcLanguage: conceptDcLanguage,
			dcSource: conceptDcSource,
			dcRightsHolder: conceptDcRightsHolder.trim(),
			dcRightsLicense: conceptDcRightsLicense.trim(),
			dcContact: conceptDcContact.trim(),
			dcDatePublished: conceptDcDatePublished.trim(),
			dcProvenance: conceptDcProvenance,
			peerReviewRequested: conceptPeerReview
		};
	}

	function activeFormData() {
		return canSubmitConcept ? buildProposalData() : buildEditionData();
	}

	function initializeDraft() {
		if (!edition) return;
		const editionId = edition.id;
		const isProposal = canSubmitConcept;
		const controller = new DraftAutosave(
			activeFormData(),
			async (data) => {
				const creditError = validateCredits(data.credits, false);
				if (creditError) throw new Error(creditError);
				const updated = await pb
					.collection('editions')
					.update(editionId, data, { requestKey: null });
				if (isProposal && !('proposalType' in updated))
					throw new Error('The proposal database migration must be installed before saving.');
				if (workflowDisposed || draft !== controller || edition?.id !== editionId) return;
				editionRecord = updated;
				edition.title = data.title;
			},
			(state, error) => {
				if (workflowDisposed || draft !== controller) return;
				saveStatus = state;
				saveError = error || '';
			},
			1200,
			() => (!isSubmitting || flushingForReview) && !isUploadingModel && !isUploadingSupporting
		);
		draft = controller;
	}

	async function persistDraft({ showToast }: { showToast: boolean }) {
		if (!edition || (isSubmitting && !flushingForReview) || !draft) return false;
		const controller = draft;
		controller.set(activeFormData());
		try {
			await controller.flush();
			if (workflowDisposed || draft !== controller || controller.dirty) return false;
			if (showToast) toast.success('Draft saved');
			return true;
		} catch {
			if (showToast && !workflowDisposed) toast.error(saveError || 'Failed to save draft');
			return false;
		}
	}

	async function saveDraft() {
		await persistDraft({ showToast: true });
	}

	async function flushEditionForAlpha() {
		if (!edition || editionAssetsBusy || coverBusy)
			throw new Error('Finish uploads and close the scene editor before requesting review.');
		const creditError = validateCredits(credits, true);
		if (creditError) throw new Error(creditError);
		flushingForReview = true;
		try {
			if (!(await persistDraft({ showToast: false })))
				throw new Error(saveError || 'Save the latest changes before requesting review.');
		} finally {
			flushingForReview = false;
		}
	}

	async function uploadSupportingFiles(event: Event) {
		if (!edition || !editionRecord || isSubmitting || isUploadingSupporting || isSaving) return;
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';
		if (files.length === 0) return;
		if (files.some((file) => file.size > 200 * 1024 * 1024)) {
			toast.error('Each file must be 200 MB or smaller.');
			return;
		}
		isUploadingSupporting = true;
		try {
			const form = new FormData();
			for (const file of files) form.append('proposalSupportingFiles+', file);
			editionRecord = await pb
				.collection('editions')
				.update(edition.id, form, { requestKey: null });
			toast.success('Supporting files uploaded');
		} catch (error) {
			console.error('Error uploading supporting files:', error);
			toast.error('Failed to upload supporting files');
		} finally {
			isUploadingSupporting = false;
			resumeAutosave();
		}
	}

	async function removeSupportingFile(filename: string) {
		if (!edition || !editionRecord || isUploadingSupporting || isSaving || isSubmitting) return;
		isUploadingSupporting = true;
		try {
			editionRecord = await pb.collection('editions').update(
				edition.id,
				{
					'proposalSupportingFiles-': [filename]
				},
				{ requestKey: null }
			);
		} catch (error) {
			console.error('Error removing supporting file:', error);
			toast.error('Failed to remove supporting file');
		} finally {
			isUploadingSupporting = false;
			resumeAutosave();
		}
	}

	function resumeAutosave() {
		if (!draft || !formReady) return;
		draft.set(activeFormData());
		if (hasUnsavedChanges()) draft.schedule();
	}

	async function saveCollaboratorCredits(nextCredits: Credit[]) {
		if (isSaving || isSubmitting) throw new Error('Wait for the current save to finish.');
		credits = readCredits(nextCredits);
		if (!(await persistDraft({ showToast: false }))) {
			throw new Error(saveError || 'Credits are unsaved. Check the form and save again.');
		}
	}

	async function deleteEdition() {
		if (!edition || isDeleting) return;
		isDeleting = true;
		try {
			const deletedId = edition.id;
			await pb.collection('editions').delete(deletedId);
			toast.success('Edition deleted');
			showDeleteModal = false;
			goto(resolve(isSandbox ? '/profile' : '/editions'));
		} catch (error) {
			console.error('Error deleting edition:', error);
			toast.error('Failed to delete edition');
			isDeleting = false;
		}
	}

	async function transferSandbox() {
		if (!edition || !isSandbox || !transferTargetId || isTransferring) return;
		if (editionAssetsBusy || coverBusy || isSaving || effectiveSaveStatus !== 'saved') {
			toast.error('Finish uploads and save all changes before transferring this sandbox.');
			return;
		}
		isTransferring = true;
		try {
			if (!(await persistDraft({ showToast: false })))
				throw new Error(saveError || 'Save the latest sandbox changes before transferring.');
			const result = await pb.send<{ editionId: string }>(
				`/api/pure3d/sandboxes/${edition.id}/transfer`,
				{
					method: 'POST',
					body: { targetEditionId: transferTargetId, expectedUpdated: editionRecord?.updated || '' }
				}
			);
			transferDialog.close();
			toast.success(
				'Sandbox work copied. Your private sandbox has been retained for confirmation.'
			);
			await goto(resolve('/editions/[slug]/workflow', { slug: result.editionId }));
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Could not transfer this sandbox.');
		} finally {
			isTransferring = false;
		}
	}

	async function submitConcept() {
		if (!edition || isSubmitting || isUploadingSupporting || isUploadingModel) return;
		const creditError = validateCredits(credits, true);
		if (creditError) {
			toast.error(creditError);
			return;
		}
		const errors = proposalErrors({
			proposalOpenCall,
			proposalType,
			title: conceptTitle,
			credits,
			purpose: proposalPurpose,
			argument: proposalArgument,
			threeDRationale: proposalThreeDRationale,
			audiences: proposalAudience,
			contextualMaterial: proposalContextualMaterial,
			hasExistingModel: proposalHasExistingModel,
			modelSources: proposalModelSources,
			copyrightOwnership: proposalCopyrightOwnership,
			digitisationSituation: proposalDigitisationSituation,
			hasModelFile:
				Array.isArray(editionRecord?.proposalModelFiles) &&
				editionRecord.proposalModelFiles.length > 0,
			supportingLinks: proposalSupportingLinks
				.split(/\r?\n/)
				.map((link) => link.trim())
				.filter(Boolean)
		});
		if (errors.length) {
			toast.error(errors[0]);
			return;
		}
		draft?.cancelPending();
		isSubmitting = true;
		try {
			await draft?.waitForIdle();
			const data = buildProposalData();
			const updated = await pb.collection('editions').update(
				edition.id,
				{
					...data,
					status: EditionStatus.ConceptSubmitted
				},
				{ requestKey: null }
			);
			editionRecord = updated;
			draft?.dispose();
			saveStatus = 'saved';
			edition.status = EditionStatus.ConceptSubmitted;
			edition.proposalSubmittedAt = updated.proposalSubmittedAt || '';
			edition.title = conceptTitle;
			toast.success('Proposal submitted for review');
		} catch (error) {
			console.error('Error submitting concept:', error);
			toast.error('Failed to submit proposal');
			saveStatus = 'error';
			saveError = 'Submission failed. Your proposal is still a draft.';
		} finally {
			isSubmitting = false;
		}
	}

	function requestSubmit() {
		if (!isUploadingSupporting && !isUploadingModel) submitDialog.showModal();
		else toast.error('Wait for uploads and changes to finish saving, then submit again.');
	}

	async function reopenProposal() {
		if (!edition || isSubmitting) return;
		isSubmitting = true;
		try {
			await updateEditionStatus(edition.id, EditionStatus.Draft);
			await loadData();
		} catch {
			toast.error('Could not reopen the proposal. Please try again.');
		} finally {
			isSubmitting = false;
		}
	}

	async function unpublishEdition() {
		if (!edition || !isAdmin || isSubmitting || !unpublishReason.trim()) return;
		isSubmitting = true;
		try {
			await pb.send(`/api/pure3d/editions/${edition.id}/unpublish`, {
				method: 'POST',
				body: { expectedStatus: edition.status, reason: unpublishReason.trim() }
			});
			unpublishDialog.close();
			unpublishReason = '';
			toast.success('Edition unpublished and returned for final revisions');
			await loadData();
		} catch (error) {
			console.error('Error unpublishing edition:', error);
			toast.error(error instanceof Error ? error.message : 'Could not unpublish the edition');
		} finally {
			isSubmitting = false;
		}
	}

	// --- Resubmit after revisions ---
	function handleReviewSubmitted() {
		loadData();
	}

	function handleFeedbackSubmitted() {
		feedbackListRef?.loadFeedback();
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
</script>

<div
	id="edition-workflow-page"
	class="mx-auto p-4 lg:p-8"
	class:max-w-7xl={edition &&
		((viewMode === 'concept-form' && !canSubmitConcept) || viewMode === 'review-form')}
	class:max-w-4xl={!edition || viewMode === 'status-view' || canSubmitConcept}
>
	{#if isLoading}
		<div class="flex items-center justify-center py-12">
			<span class="loading loading-lg loading-spinner"></span>
		</div>
	{:else if edition}
		<!-- Breadcrumbs -->
		<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
			<nav class="breadcrumbs text-sm">
				<ul>
					<li><a href={resolve('/')} class="link link-hover">Home</a></li>
					<li><a href={resolve('/editions')} class="link link-hover">Editions</a></li>
					<li class="text-base-content/70">{edition.title || 'Untitled Edition'}</li>
				</ul>
			</nav>
			{#if viewMode === 'concept-form'}
				<div class="ml-auto flex flex-wrap items-center gap-2">
					{#if canViewEdition}
						<a href={resolve('/editions/[slug]', { slug: edition.id })} class="btn btn-ghost btn-sm"
							>View Edition</a
						>
					{/if}
					{#if canDelete}
						<button
							type="button"
							class="btn btn-outline btn-sm btn-error"
							onclick={() => (showDeleteModal = true)}>Delete</button
						>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Header -->
		<div class="mb-6 flex flex-wrap items-start gap-4">
			{#if viewMode !== 'concept-form'}
				<div class="min-w-64">
					<div class="flex flex-wrap items-center gap-3">
						<h1 class="text-2xl font-bold">
							{viewMode === 'review-form' && currentStage === ReviewStage.Concept
								? 'Review Proposal'
								: viewMode === 'review-form'
									? 'Review Edition'
									: 'Edition Workflow'}
						</h1>
						<StatusBadge status={edition.status} />
					</div>
					<p class="mt-1 text-base-content/70">{edition.title || 'Untitled Edition'}</p>
					{#if edition.collectionTitle}
						<p class="text-sm text-base-content/50">in {edition.collectionTitle}</p>
					{/if}
				</div>
			{/if}

			{#if viewMode === 'concept-form'}
				{#if isSandbox}
					<div class="min-w-72 flex-1 rounded-box bg-base-200 px-4 py-3">
						<div class="flex flex-wrap items-center justify-between gap-3">
							<div>
								<p class="font-semibold">Private sandbox</p>
								<p class="text-sm text-base-content/70">
									This work is private and uses the full editor. It cannot be reviewed or published.
								</p>
							</div>
							<button
								type="button"
								class="btn btn-sm btn-primary"
								disabled={!sandboxTargets.length ||
									isTransferring ||
									editionAssetsBusy ||
									coverBusy ||
									isSaving ||
									effectiveSaveStatus !== 'saved'}
								onclick={() => transferDialog.showModal()}>Transfer to approved edition</button
							>
						</div>
						{#if !sandboxTargets.length}
							<p class="mt-2 text-xs text-base-content/60">
								A transfer destination appears after one of your proposals is approved and still has
								no editor content.
							</p>
						{/if}
					</div>
				{:else}
					<div class="min-w-72 flex-1 rounded-box border border-base-300 bg-base-100 px-4 py-3">
						<div class="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
							<div>
								<span class="font-semibold">Workflow</span>
								<span class="ml-2 text-base-content/60">{nextWorkflowAction}</span>
							</div>
							{#if editionRecord && [EditionStatus.ConceptAccepted, EditionStatus.AlphaRevisions].includes(edition.status) && (isAuthor || isAdmin || collectionRole === CollectionRole.Owner)}
								<button
									type="button"
									class="btn btn-primary"
									disabled={isSaving || isSubmitting || editionAssetsBusy || coverBusy}
									onclick={() => alphaRequestDialog.showModal()}
								>
									Request Alpha Review
									<svg
										xmlns="http://www.w3.org/2000/svg"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.5"
										class="size-4"
										aria-hidden="true"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M5 12h14m-6-6 6 6-6 6"
										/>
									</svg>
								</button>
							{/if}
							{#if edition.status !== EditionStatus.ConceptAccepted}
								<StatusBadge status={edition.status} />
							{/if}
						</div>
						<ol class="flex items-center gap-2 overflow-x-auto pb-1">
							{#each workflowStages as stage, index (stage.label)}
								{@const state = workflowStageState(index)}
								<li class="flex shrink-0 items-center gap-2">
									<div
										class="flex size-5 items-center justify-center rounded-full text-[10px] font-semibold"
										class:bg-success={state === 'complete'}
										class:text-success-content={state === 'complete'}
										class:bg-primary={state === 'current'}
										class:text-primary-content={state === 'current'}
										class:bg-base-300={state === 'future'}
										class:text-base-content={state === 'future'}
										class:opacity-50={state === 'future'}
									>
										{#if state === 'complete'}✓{:else}{index + 1}{/if}
									</div>
									<span class="text-xs whitespace-nowrap" class:opacity-50={state === 'future'}>
										{stage.label}
									</span>
									{#if index < workflowStages.length - 1}
										<span class="h-px w-6 bg-base-300"></span>
									{/if}
								</li>
							{/each}
						</ol>
					</div>
				{/if}
			{/if}

			{#if viewMode !== 'concept-form'}
				<div class="ml-auto flex flex-col items-end gap-2">
					<div class="flex flex-wrap items-center justify-end gap-2">
						{#if canViewEdition}
							<a
								href={resolve('/editions/[slug]', { slug: edition.id })}
								class="btn btn-ghost btn-sm">View Edition</a
							>
						{/if}
						{#if canDelete}
							<button
								type="button"
								class="btn btn-outline btn-sm btn-error"
								onclick={() => (showDeleteModal = true)}
							>
								Delete
							</button>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<!-- Proposal Form — mirrors viewer layout -->
		{#if viewMode === 'concept-form'}
			{#if canSubmitConcept}
				<form
					id="proposal"
					class="space-y-5"
					onsubmit={(event) => {
						event.preventDefault();
						requestSubmit();
					}}
				>
					<fieldset
						disabled={isSubmitting || isUploadingSupporting || isUploadingModel}
						class="space-y-5"
					>
						<section
							id="proposal-basics"
							class="space-y-4 overflow-hidden rounded-box border border-base-300 bg-base-100 p-5"
						>
							<div class="-mx-5 -mt-5 border-b border-base-300 bg-base-200 px-5 py-3">
								<h1 class="text-base font-semibold">Your proposal</h1>
							</div>
							<p class="text-sm text-base-content/65">
								Your proposal stays private and editable until you submit it for editorial review.
							</p>
							<div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
								<label class="form-control">
									<span class="label-text mb-1 font-semibold">Proposal type</span>
									<select class="select-bordered select w-full" bind:value={proposalType} required>
										<option value="" disabled>Select a type</option>
										{#each PROPOSAL_TYPES as [value, label] (value)}
											<option {value}>{label}</option>
										{/each}
									</select>
								</label>
								<label class="form-control">
									<span class="label-text mb-1 font-semibold">Title</span>
									<input class="input-bordered input w-full" bind:value={conceptTitle} required />
								</label>
							</div>
							<label class="form-control">
								<span class="label-text mb-1 font-semibold">Thematic call</span>
								<select class="select-bordered select w-full" bind:value={proposalOpenCall}>
									<option value="">General submission</option>
									{#if proposalOpenCall && !proposalOpenCalls.some((call) => call.id === proposalOpenCall)}
										<option value={proposalOpenCall}>
											{proposalOpenCallSnapshot?.title || 'Previously selected thematic call'} (no longer
											open)
										</option>
									{/if}
									{#each proposalOpenCalls as call (call.id)}
										<option value={call.id}>
											{call.title}{call.deadline
												? ` · deadline ${formatOpenCallDeadline(call.deadline)}`
												: ''}
										</option>
									{/each}
								</select>
								<span class="label-text-alt mt-1 text-base-content/60"
									>Select a published thematic call, or leave this as General submission. Deadlines
									include the stated UTC calendar day.</span
								>
							</label>
							<div>
								<h2 class="font-semibold">Authors</h2>
								<div class="mt-3">
									<CreditsEditor
										bind:credits
										disabled={isSubmitting}
										authorsOnly
										affiliations={authorAffiliations}
									/>
								</div>
							</div>
						</section>

						<ProposalQuestionnaire
							bind:purpose={proposalPurpose}
							bind:argument={proposalArgument}
							bind:rationale={proposalThreeDRationale}
							bind:context={proposalContextualMaterial}
							bind:audience={proposalAudience}
						/>

						<section
							id="proposal-models"
							class="space-y-5 overflow-hidden rounded-box border border-base-300 bg-base-100 p-5"
						>
							<div class="-mx-5 -mt-5 border-b border-base-300 bg-base-200 px-5 py-3">
								<h2 class="text-base font-semibold">3D model(s)</h2>
							</div>
							<fieldset class="space-y-2">
								<legend class="text-sm font-semibold"
									>Do you already have a digital 3D model to use for this edition?</legend
								>
								<label class="mr-5 inline-flex items-center gap-2"
									><input
										type="radio"
										class="radio radio-sm radio-primary"
										value={true}
										bind:group={proposalHasExistingModel}
									/> Yes</label
								>
								<label class="inline-flex items-center gap-2"
									><input
										type="radio"
										class="radio radio-sm radio-primary"
										value={false}
										bind:group={proposalHasExistingModel}
									/> No</label
								>
							</fieldset>
							{#if proposalHasExistingModel}
								<div class="space-y-5">
									<div class="space-y-2 text-xs leading-relaxed text-base-content/80">
										<h3 class="text-sm font-semibold text-base-content">Upload your 3D model(s)</h3>
										<p>
											Please check the technical requirements in the <a
												href={resolve('/documentation/[slug]', { slug: 'submission' })}
												class="link link-primary">submission guidelines</a
											>.
										</p>
										<p>
											At this stage, the model is used to assess compatibility and suitability for a
											3D edition. You can adjust the resolution before publication.
										</p>
									</div>
									<fieldset
										class="grid gap-x-4 gap-y-3 rounded-lg bg-base-200/50 p-3 sm:grid-cols-2 lg:grid-cols-3"
									>
										<legend class="sr-only">Model source · Select all that apply</legend>
										<div class="col-span-full text-sm font-semibold">
											Model source <span class="font-normal text-base-content/75"
												>· Select all that apply</span
											>
										</div>
										{#each MODEL_SOURCES as [value, label] (value)}
											<label class="inline-flex items-center gap-2 text-xs">
												<input
													type="checkbox"
													class="checkbox checkbox-sm"
													checked={proposalModelSources.includes(value)}
													onchange={(event) =>
														(proposalModelSources = toggleSelection(
															proposalModelSources,
															value,
															event.currentTarget.checked
														))}
												/>
												{label}
											</label>
										{/each}
									</fieldset>
									<div class="space-y-2">
										<h3 class="text-sm font-semibold">Model files</h3>
										<p class="text-xs text-base-content/80">
											Add one GLB, GLTF, OBJ, or PLY model with its companion files at a time.
											Maximum 200 MB per file. Each model is previewed automatically.
										</p>
										{#if editionRecord}
											<ProposalModelUploads
												bind:edition={editionRecord}
												disabled={isSubmitting || isUploadingSupporting || isSaving}
												onupdated={(record) => (editionRecord = record)}
												onuploadstatechange={(uploading) => {
													isUploadingModel = uploading;
													if (!uploading) resumeAutosave();
												}}
											/>
										{/if}
									</div>
									<label class="form-control">
										<span class="text-sm font-semibold"
											>Do you own the copyright of the model(s)? If not, please explain.</span
										>
										<textarea
											class="textarea-bordered textarea mt-2 min-h-20 w-full"
											rows="3"
											bind:value={proposalCopyrightOwnership}
											required
										></textarea>
										<span class="mt-1 text-right text-xs text-base-content/50"
											>{wordCount(proposalCopyrightOwnership)}/150 words</span
										>
									</label>
									<p class="text-xs leading-relaxed text-base-content/80">
										PURE3D cannot be held responsible for copyright infringement by authors. Before
										submitting, confirm that you hold the copyright or have permission to use the
										material in your edition.
									</p>
								</div>
							{:else}
								<p class="rounded-lg bg-base-200/50 p-3 text-sm leading-relaxed">
									PURE3D normally expects you to have a 3D model before building your edition.
									During development, support for digitising an object may be possible. Describe
									your situation and what you would like to digitise.
								</p>
								<label class="form-control">
									<span class="text-sm font-semibold">Describe the digitisation situation</span>
									<textarea
										class="textarea-bordered textarea mt-2 min-h-20 w-full"
										rows="3"
										bind:value={proposalDigitisationSituation}
										required
									></textarea>
									<span class="mt-1 text-right text-xs text-base-content/50"
										>{wordCount(proposalDigitisationSituation)}/150 words</span
									>
								</label>
								<p class="text-xs leading-relaxed text-base-content/80">
									Add images, videos or website links to help us assess whether your subject is
									suitable for a 3D scholarly edition.
								</p>
								<label class="form-control">
									<span class="text-sm font-semibold">Supporting links</span>
									<textarea
										class="textarea-bordered textarea mt-1 min-h-20 w-full"
										bind:value={proposalSupportingLinks}
										placeholder="One link per line"
									></textarea>
								</label>
								{#if editionRecord}
									<div>
										<button
											type="button"
											class="btn btn-outline btn-sm"
											onclick={() => document.getElementById('proposal-supporting-files')?.click()}
											disabled={isUploadingSupporting || isSubmitting || isSaving}
											>Add supporting files</button
										>
										<input
											id="proposal-supporting-files"
											class="hidden"
											type="file"
											multiple
											onchange={uploadSupportingFiles}
											disabled={isUploadingSupporting || isSubmitting}
										/>
										{#if isUploadingSupporting}<span class="ml-2 text-sm">Uploading…</span>{/if}
										{#if Array.isArray(editionRecord.proposalSupportingFiles) && editionRecord.proposalSupportingFiles.length > 0}
											<ul class="mt-2 space-y-1 text-sm">
												{#each editionRecord.proposalSupportingFiles as filename (filename)}
													<li class="flex items-center gap-2">
														<span class="break-all">{filename}</span><button
															type="button"
															class="btn btn-ghost btn-xs"
															onclick={() => removeSupportingFile(filename)}
															disabled={isUploadingSupporting || isSubmitting || isSaving}
															>Remove</button
														>
													</li>
												{/each}
											</ul>
										{/if}
									</div>
								{/if}
							{/if}
						</section>
					</fieldset>

					<div class="flex items-center justify-end gap-3 border-t border-base-300 pt-4">
						<div
							class="mr-auto flex items-center gap-2 text-xs {saveStatusClass}"
							aria-live="polite"
						>
							<span>{saveStatusText}</span>
							{#if saveStatus === 'error'}<span>{saveError}</span><button
									type="button"
									class="link"
									onclick={() => persistDraft({ showToast: false })}>Retry</button
								>{/if}
						</div>
						<button
							type="submit"
							class="btn btn-primary"
							disabled={isSubmitting || isUploadingSupporting || isUploadingModel}
						>
							{#if isSubmitting}<span class="loading loading-xs loading-spinner"></span>{/if}
							Submit for Review
						</button>
					</div>
				</form>
			{:else}
				<div id="draft" class="scroll-mt-24">
					{#if editionRecord?.finalReviewRound}<FinalReviewProgress editionId={edition.id} />{/if}
					{#if editionRecord?.alphaReviewRound}<div class="mb-6">
							<AlphaReviewProgress
								editionId={edition.id}
								open={edition.status === EditionStatus.AlphaRevisions}
							/>
						</div>{/if}
					{#if editionRecord?.proposalSubmittedAt}
						<details class="mb-6">
							<summary class="cursor-pointer py-3 font-semibold">View submitted proposal</summary
							><ProposalSummary record={editionRecord} />
						</details>
					{/if}
					<!-- Show rejection feedback if resubmitting -->
					{#if edition.status === EditionStatus.ConceptRejected && previousFeedback.length > 0}
						<div class="mb-4 alert alert-warning">
							<div>
								<p class="font-semibold">Previous Review Feedback</p>
								{#each previousFeedback as fb (fb.created)}
									{#if fb.comment}
										<p class="mt-1 text-sm">{fb.comment}</p>
									{/if}
								{/each}
							</div>
						</div>
					{/if}

					<form
						id="concept"
						class="scroll-mt-24"
						onsubmit={(e) => {
							e.preventDefault();
							void saveDraft();
						}}
					>
						<fieldset disabled={isSubmitting}>
							<!-- Header: cover image + editable title + authors -->
							<div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-stretch">
								{#if editionRecord}
									<div class="w-full flex-none sm:w-36">
										<CoverImageUpload
											bind:record={editionRecord}
											disabled={isSubmitting || editionAssetsBusy}
											onbusychange={(busy) => (coverBusy = busy)}
											onuploaded={(r) => (editionRecord = r)}
											onremoved={(r) => (editionRecord = r)}
										/>
									</div>
								{/if}
								<div class="min-w-0 flex-1">
									<label for="concept-title" class="mb-1 block text-sm font-semibold">Title</label>
									<input
										id="concept-title"
										type="text"
										class="input-bordered input w-full text-2xl font-semibold placeholder:text-base-content/30"
										bind:value={conceptTitle}
										required
										placeholder="Edition title"
									/>
									<div
										class="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-base-200/50 px-3 py-2"
									>
										<div class="min-w-0 text-sm">
											<p class="font-semibold">Authors</p>
											<p class="break-words text-base-content/70">
												{credits
													.map((credit) => credit.name)
													.filter(Boolean)
													.join(', ') || 'No credits added'}
											</p>
										</div>
										<button
											type="button"
											class="btn btn-outline btn-sm"
											disabled={isSubmitting}
											onclick={() => {
												editableCredits = readCredits(credits).map((credit) => ({ ...credit }));
												creditsDialog.showModal();
											}}>Edit authors</button
										>
									</div>
									{#if edition.collectionTitle}
										<p class="mt-1 text-sm text-base-content/50">in {edition.collectionTitle}</p>
									{/if}
								</div>
							</div>

							<!-- Two-column layout (mirrors viewer) -->
							<div class="relative flex flex-col gap-8 lg:flex-row lg:items-start">
								<!-- Left Column: 3D Viewer + Asset Uploads -->
								<div class="min-w-0 flex-1 space-y-4">
									{#if editionRecord}
										<EditionAssetsPanel
											bind:edition={editionRecord}
											title={conceptTitle}
											disabled={isSubmitting || coverBusy}
											onbusychange={(busy) => (editionAssetsBusy = busy)}
											{collectionPubNum}
											{editionPubNum}
											onupdated={(r) => (editionRecord = r)}
										/>
									{/if}
								</div>

								<!-- Right Column: Tabbed Sidebar -->
								<div class="shrink-0 lg:w-96">
									<div class="lg:sticky lg:top-4">
										<div class="overflow-hidden rounded-xl border border-base-300 bg-base-200">
											<div class="w-96 max-w-full p-0">
												<!-- Tabs -->
												<div role="tablist" class="tabs-bordered tabs bg-base-300">
													<button
														type="button"
														role="tab"
														class="tab flex-1"
														class:tab-active={activeFormTab === 'description'}
														onclick={() => (activeFormTab = 'description')}
													>
														Description
													</button>
													<button
														type="button"
														role="tab"
														class="tab flex-1"
														class:tab-active={activeFormTab === 'metadata'}
														onclick={() => (activeFormTab = 'metadata')}
													>
														Metadata
													</button>
													{#if !isSandbox && ![EditionStatus.ConceptAccepted, EditionStatus.AlphaRevisions].includes(edition.status)}<button
															type="button"
															role="tab"
															class="tab flex-1"
															class:tab-active={activeFormTab === 'peer-review'}
															id="edition-review-tab"
															onclick={() => (activeFormTab = 'peer-review')}
														>
															Review
														</button>{/if}
													{#if !isSandbox}<button
															type="button"
															role="tab"
															class="tab flex-1"
															class:tab-active={activeFormTab === 'team'}
															onclick={() => (activeFormTab = 'team')}
														>
															Team
														</button>
													{/if}
												</div>

												<!-- Tab Content -->
												<div class="p-5">
													{#if activeFormTab === 'description'}
														<div class="space-y-4">
															<div>
																<span class="mb-2 block text-sm font-semibold">Abstract</span>
																<RichTextEditor
																	content={conceptDescription}
																	onchange={(html) => (conceptDescription = html)}
																	minHeight="200px"
																/>
															</div>
														</div>
													{:else if activeFormTab === 'metadata'}
														<div class="space-y-3">
															<div class="form-control">
																<label class="label py-0.5" for="concept-subtitle">
																	<span class="label-text text-sm">Subtitle</span>
																</label>
																<input
																	id="concept-subtitle"
																	type="text"
																	class="input-bordered input input-sm"
																	bind:value={conceptDcSubtitle}
																/>
															</div>
															<div class="form-control">
																<label class="label py-0.5" for="concept-institution">
																	<span class="label-text text-sm">Institutions</span>
																</label>
																<input
																	id="concept-institution"
																	type="text"
																	class="input-bordered input input-sm"
																	bind:value={conceptDcInstitution}
																	placeholder="comma-separated"
																/>
															</div>
															<div class="form-control">
																<label class="label py-0.5" for="concept-subject">
																	<span class="label-text text-sm">Subjects</span>
																</label>
																{#if vocabularyFor('subject').length}
																	<SearchableSelect
																		id="concept-subject"
																		options={optionsFor('subject', conceptDcSubject)}
																		bind:values={conceptDcSubject}
																	/>
																{:else}
																	<input
																		id="concept-subject"
																		type="text"
																		class="input-bordered input input-sm"
																		value={conceptDcSubject.join(', ')}
																		onchange={(event) => (conceptDcSubject = arrayInput(event))}
																		placeholder="comma-separated"
																	/>
																{/if}
															</div>
															<div class="grid grid-cols-2 gap-3">
																<div class="form-control">
																	<label class="label py-0.5" for="concept-place">
																		<span class="label-text text-sm">Place</span>
																	</label>
																	<input
																		id="concept-place"
																		type="text"
																		class="input-bordered input input-sm"
																		bind:value={conceptDcCoveragePlace}
																		placeholder="Rome, Italy"
																	/>
																</div>
																<div class="form-control">
																	<label class="label py-0.5" for="concept-language">
																		<span class="label-text text-sm">Languages</span>
																	</label>
																	{#if vocabularyFor('language').length}
																		<SearchableSelect
																			id="concept-language"
																			options={optionsFor('language', conceptDcLanguage)}
																			bind:values={conceptDcLanguage}
																		/>
																	{:else}
																		<input
																			id="concept-language"
																			type="text"
																			class="input-bordered input input-sm"
																			value={conceptDcLanguage.join(', ')}
																			onchange={(event) => (conceptDcLanguage = arrayInput(event))}
																			placeholder="comma-separated"
																		/>
																	{/if}
																</div>
															</div>
															<div class="form-control">
																<label class="label py-0.5" for="concept-keyword">
																	<span class="label-text text-sm">Keywords</span>
																	<span class="label-text-alt text-xs">comma-separated</span>
																</label>
																<input
																	id="concept-keyword"
																	type="text"
																	class="input-bordered input input-sm"
																	bind:value={conceptDcKeyword}
																/>
															</div>
															<div class="form-control">
																<label class="label py-0.5" for="concept-audience"
																	><span class="label-text text-sm">Audience</span></label
																>
																{#if vocabularyFor('audience').length}
																	<SearchableSelect
																		id="concept-audience"
																		options={optionsFor('audience', conceptDcAudience)}
																		bind:values={conceptDcAudience}
																	/>
																{:else}
																	<input
																		id="concept-audience"
																		type="text"
																		class="input-bordered input input-sm"
																		value={conceptDcAudience.join(', ')}
																		onchange={(event) => (conceptDcAudience = arrayInput(event))}
																		placeholder="comma-separated"
																	/>
																{/if}
															</div>
															<div class="grid grid-cols-2 gap-3">
																<div class="form-control">
																	<label class="label py-0.5" for="concept-country"
																		><span class="label-text text-sm">Countries</span></label
																	>
																	{#if vocabularyFor('country').length}
																		<SearchableSelect
																			id="concept-country"
																			options={optionsFor('country', conceptDcCoverageCountry)}
																			bind:values={conceptDcCoverageCountry}
																		/>
																	{:else}
																		<input
																			id="concept-country"
																			type="text"
																			class="input-bordered input input-sm"
																			value={conceptDcCoverageCountry.join(', ')}
																			onchange={(event) =>
																				(conceptDcCoverageCountry = arrayInput(event))}
																			placeholder="comma-separated"
																		/>
																	{/if}
																</div>
																<div class="form-control">
																	<label class="label py-0.5" for="concept-period"
																		><span class="label-text text-sm">Period</span></label
																	>
																	{#if vocabularyFor('period').length}
																		<SearchableSelect
																			id="concept-period"
																			options={optionsFor('period', conceptDcCoveragePeriod)}
																			bind:values={conceptDcCoveragePeriod}
																		/>
																	{:else}
																		<input
																			id="concept-period"
																			type="text"
																			class="input-bordered input input-sm"
																			value={conceptDcCoveragePeriod.join(', ')}
																			onchange={(event) =>
																				(conceptDcCoveragePeriod = arrayInput(event))}
																			placeholder="comma-separated"
																		/>
																	{/if}
																</div>
															</div>
															<div class="form-control">
																<label class="label py-0.5" for="concept-temporal"
																	><span class="label-text text-sm">Temporal</span></label
																>
																<input
																	id="concept-temporal"
																	type="text"
																	class="input-bordered input input-sm"
																	bind:value={conceptDcCoverageTemporal}
																/>
															</div>
															<div class="form-control">
																<label class="label py-0.5" for="concept-source"
																	><span class="label-text text-sm">Sources</span></label
																>
																{#if vocabularyFor('source').length}
																	<SearchableSelect
																		id="concept-source"
																		options={optionsFor('source', conceptDcSource)}
																		bind:values={conceptDcSource}
																	/>
																{:else}
																	<input
																		id="concept-source"
																		type="text"
																		class="input-bordered input input-sm"
																		value={conceptDcSource.join(', ')}
																		onchange={(event) => (conceptDcSource = arrayInput(event))}
																		placeholder="comma-separated"
																	/>
																{/if}
															</div>
															<div class="grid grid-cols-2 gap-3">
																<div class="form-control">
																	<label class="label py-0.5" for="concept-rights-holder">
																		<span class="label-text text-sm">Rights Holder</span>
																	</label>
																	<input
																		id="concept-rights-holder"
																		type="text"
																		class="input-bordered input input-sm"
																		bind:value={conceptDcRightsHolder}
																	/>
																</div>
																<div class="form-control">
																	<label class="label py-0.5" for="concept-license">
																		<span class="label-text text-sm">Licence</span>
																	</label>
																	{#if vocabularyFor('license').length}
																		<SearchableSelect
																			id="concept-license"
																			options={optionsFor('license', [conceptDcRightsLicense])}
																			values={conceptDcRightsLicense
																				? [conceptDcRightsLicense]
																				: []}
																			multiple={false}
																			onchange={(values) =>
																				(conceptDcRightsLicense = values[0] ?? '')}
																		/>
																	{:else}
																		<input
																			id="concept-license"
																			type="text"
																			class="input-bordered input input-sm"
																			bind:value={conceptDcRightsLicense}
																		/>
																	{/if}
																</div>
															</div>
															<div class="grid grid-cols-2 gap-3">
																<div class="form-control">
																	<label class="label py-0.5" for="concept-contact"
																		><span class="label-text text-sm">Contact</span></label
																	>
																	<input
																		id="concept-contact"
																		type="text"
																		class="input-bordered input input-sm"
																		bind:value={conceptDcContact}
																	/>
																</div>
																<div class="form-control">
																	<label class="label py-0.5" for="concept-date-published"
																		><span class="label-text text-sm">Date published</span></label
																	>
																	<input
																		id="concept-date-published"
																		type="text"
																		class="input-bordered input input-sm"
																		bind:value={conceptDcDatePublished}
																	/>
																</div>
															</div>
															<div class="form-control">
																<label class="label py-0.5" for="concept-provenance"
																	><span class="label-text text-sm">Provenance</span></label
																>
																<textarea
																	id="concept-provenance"
																	class="textarea-bordered textarea min-h-24"
																	bind:value={conceptDcProvenance}
																></textarea>
															</div>
														</div>
													{:else if activeFormTab === 'peer-review' && ![EditionStatus.ConceptAccepted, EditionStatus.AlphaRevisions, EditionStatus.AlphaAccepted, EditionStatus.FinalRevisions, EditionStatus.FinalAccepted].includes(edition.status)}
														<div class="space-y-4">
															<label class="flex cursor-pointer items-start gap-3">
																<input
																	type="checkbox"
																	class="checkbox mt-0.5 checkbox-sm"
																	bind:checked={conceptPeerReview}
																/>
																<div>
																	<span class="text-sm font-semibold">Request peer review</span>
																	<p class="text-xs text-base-content/60">
																		If enabled, the edition will go through alpha and final review
																		stages before publication.
																	</p>
																</div>
															</label>
															{#if edition.status === EditionStatus.ConceptRejected && previousFeedback.length > 0}
																<div class="mt-4">
																	<h3 class="mb-2 text-sm font-semibold">Previous Feedback</h3>
																	{#each previousFeedback as fb (fb.created)}
																		{#if fb.comment}
																			<p class="mt-1 rounded bg-base-300 p-2 text-sm">
																				{fb.comment}
																			</p>
																		{/if}
																	{/each}
																</div>
															{/if}
														</div>
													{:else if !isSandbox && activeFormTab === 'team'}
														<CollaboratorManager
															editionId={edition.id}
															{credits}
															oncreditssaved={saveCollaboratorCredits}
															isReadOnly={(!isAdmin && !canManageCollaborators) ||
																isSaving ||
																isSubmitting}
														/>
													{/if}
													{#if editionRecord && [EditionStatus.AlphaAccepted, EditionStatus.FinalRevisions, EditionStatus.FinalAccepted].includes(edition.status)}
														<div hidden={activeFormTab !== 'peer-review'}>
															<FinalRequestForm
																edition={editionRecord}
																publication={edition.status === EditionStatus.FinalAccepted}
																disabled={editionAssetsBusy || coverBusy}
																canRequest={isAuthor ||
																	isAdmin ||
																	collectionRole === CollectionRole.Owner}
																beforeSubmit={flushEditionForAlpha}
																onbusychange={(busy) => (isSubmitting = busy)}
																onstatuschange={(state) => (alphaContextSaveStatus = state)}
																onsubmitted={() => void loadData()}
															/>
														</div>
													{/if}
												</div>
											</div>
										</div>
									</div>
								</div>
							</div>

							<!-- Action bar -->
							<div
								class="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-base-300 pt-4"
							>
								<a
									href={resolve('/editions/[slug]', { slug: edition.id })}
									class="mr-auto link text-sm link-primary">View Edition</a
								>
								<div class="flex items-center gap-2 text-xs {saveStatusClass}" aria-live="polite">
									{#if saveStatus === 'saving'}
										<span class="loading loading-xs loading-spinner"></span>
									{:else}
										<span class="size-2 rounded-full bg-current"></span>
									{/if}
									<span>{saveStatusText}</span>
									{#if saveStatus === 'error'}
										<span>{saveError || 'Could not save your changes. Try saving again.'}</span>
									{/if}
								</div>
								<button
									type="button"
									class="btn btn-sm btn-primary"
									onclick={saveDraft}
									disabled={isSaving || isSubmitting}
								>
									{#if isSaving}
										<span class="loading loading-xs loading-spinner"></span>
									{/if}
									Save Changes
								</button>
							</div>
						</fieldset>
					</form>
				</div>
			{/if}
		{/if}

		<!-- Review Form (for assigned reviewers) -->
		{#if viewMode === 'review-form' && myAssignment && edition}
			{#if (currentStage === ReviewStage.Alpha || currentStage === ReviewStage.Final) && editionRecord}
				<ReviewWorkspace
					edition={editionRecord}
					stage={currentStage}
					reviewerId={authStore.appUserId || ''}
					{credits}
					{collectionPubNum}
					{editionPubNum}
					onsubmitted={() => {
						toast.success(
							`${currentStage === ReviewStage.Final ? 'Final' : 'Alpha'} Review submitted`
						);
						void goto(resolve('/reviews'));
					}}
				/>
			{:else}
				<div class="space-y-6">
					<section
						id="review"
						class="scroll-mt-24 overflow-hidden rounded-box border border-base-300 bg-base-100 p-5"
					>
						<div class="-mx-5 -mt-5 mb-5 border-b border-base-300 bg-base-200 px-5 py-3">
							<h2 class="text-base font-semibold">Your review</h2>
						</div>
						<div class="grid items-start gap-5 lg:grid-cols-2">
							<div class="min-w-0 overflow-hidden rounded-lg border border-base-300 p-4">
								<h3
									class="-mx-4 -mt-4 mb-4 border-b border-base-300 bg-base-200/50 px-4 py-3 text-base font-semibold"
								>
									Decision & comments
								</h3>
								<ReviewForm
									stacked
									editionId={edition.id}
									reviewStage={myAssignment.reviewStage}
									reviewerId={authStore.appUserId || ''}
									onsubmit={handleReviewSubmitted}
								/>
							</div>

							<!-- Granular feedback (reviewer) -->
							<div
								id="feedback"
								class="min-w-0 scroll-mt-24 overflow-hidden rounded-lg border border-base-300 p-4"
							>
								<h3
									class="-mx-4 -mt-4 mb-4 border-b border-base-300 bg-base-200/50 px-4 py-3 text-base font-semibold"
								>
									Granular Feedback
								</h3>
								<ReviewFeedbackForm
									editionId={edition.id}
									reviewStage={myAssignment.reviewStage}
									reviewerId={authStore.appUserId || ''}
									onsubmit={handleFeedbackSubmitted}
								/>
								<div class="divider"></div>
								<ReviewFeedbackList
									bind:this={feedbackListRef}
									editionId={edition.id}
									reviewStage={myAssignment.reviewStage}
									isAnonymized={myAssignment.reviewStage === 2}
									{userLookup}
								/>
							</div>
						</div>
					</section>

					<!-- Previous round feedback if revision resubmission -->
					{#if previousFeedback.length > 0}
						<div class="alert alert-info">
							<div>
								<p class="font-semibold">Previous Round Feedback</p>
								{#each previousFeedback as fb (fb.created)}
									{#if fb.comment}
										<p class="mt-1 text-sm">{fb.comment}</p>
									{/if}
								{/each}
							</div>
						</div>
					{/if}

					{#if editionRecord}<ReadOnlyProposal record={editionRecord} />{/if}
				</div>
			{/if}
		{/if}

		<!-- Status View (default for authors viewing progress) -->
		{#if viewMode === 'status-view'}
			<div class="space-y-6">
				{#if edition.status === EditionStatus.ConceptRejected && (isAuthor || isAdmin)}
					<div class="alert">
						<span
							>The editorial team returned this proposal. Review the feedback below before revising.</span
						><button class="btn btn-primary" disabled={isSubmitting} onclick={reopenProposal}
							>Revise proposal</button
						>
					</div>
				{/if}
				{#if edition.status === EditionStatus.ConceptSubmitted || edition.status === EditionStatus.EditorialReview}
					<div class="rounded-box border border-info/30 bg-info/10 p-4 text-base-content">
						<span>
							Proposal submitted{edition.proposalSubmittedAt
								? ` ${formatDate(edition.proposalSubmittedAt)}`
								: ''}. It remains private and viewable, but cannot be edited while under editorial
							review.
						</span>
					</div>
				{/if}
				{#if [EditionStatus.FinalReview, EditionStatus.PublicationRequested, EditionStatus.Published].includes(edition.status) && editionRecord}
					<p class="rounded-box border border-info/30 bg-info/10 p-4 text-base-content">
						{#if edition.status === EditionStatus.Published}
							{STATUS_LABELS[edition.status]}. {isAdmin
								? 'Administrators can return it to Final Revisions to edit it.'
								: 'Edition editing is locked.'}
						{:else}{STATUS_LABELS[edition.status]}. Edition editing is locked.{/if}
					</p>
					{#if edition.status === EditionStatus.Published && isAdmin}
						<button
							type="button"
							class="btn btn-outline btn-sm"
							onclick={() => unpublishDialog.showModal()}
						>
							Unpublish for revisions
						</button>
					{/if}
					<VoyagerPreview
						edition={editionRecord}
						{collectionPubNum}
						{editionPubNum}
						title={edition.title}
					/>
					<FinalReviewProgress editionId={edition.id} />
					{#if edition.status !== EditionStatus.Published && (isAdmin || authStore.globalRole === GlobalRole.EditorialBoard)}<FinalEditorialPanel
							editionId={edition.id}
							status={edition.status}
							round={editionRecord.finalReviewRound || 0}
							onchanged={() => void loadData()}
						/>{/if}
				{:else if edition.status === EditionStatus.AlphaReview && editionRecord}
					<div class="rounded-box border border-info/30 bg-info/10 p-4 text-base-content">
						Submitted for Alpha Review. You can view the edition, but editing is locked until the
						editors release their decision.
					</div>
					<div id="alpha">
						<VoyagerPreview
							edition={editionRecord}
							{collectionPubNum}
							{editionPubNum}
							title={edition.title}
						/>
					</div>
					<AlphaReviewProgress editionId={edition.id} open />
					{#if isAdmin || authStore.globalRole === GlobalRole.EditorialBoard}<AlphaEditorialPanel
							editionId={edition.id}
							round={editionRecord.alphaReviewRound || 0}
							onchanged={() => void loadData()}
						/>{/if}
					<details>
						<summary class="cursor-pointer py-3 font-semibold">View submitted proposal</summary
						><ProposalSummary record={editionRecord} />
					</details>
				{:else if editionRecord}
					{#if [EditionStatus.ConceptSubmitted, EditionStatus.EditorialReview].includes(edition.status)}
						<ReadOnlyProposal record={editionRecord} />
					{:else}
						<ProposalSummary record={editionRecord} />
					{/if}
				{/if}

				{#if ![EditionStatus.ConceptSubmitted, EditionStatus.EditorialReview, EditionStatus.AlphaReview, EditionStatus.FinalReview, EditionStatus.PublicationRequested, EditionStatus.Published].includes(edition.status)}
					<div id="alpha" class="scroll-mt-24 rounded-box border border-base-300 bg-base-100 p-6">
						<h2 class="mb-2 text-lg font-semibold">Alpha</h2>
						<p class="text-base-content/70">Review and revise the edition before final review.</p>
						<a
							href={resolve('/editions/[slug]', { slug: edition.id })}
							class="mt-2 inline-block link text-sm link-primary"
						>
							Edit Edition
						</a>
					</div>

					<div id="final" class="scroll-mt-24 rounded-box border border-base-300 bg-base-100 p-6">
						<h2 class="mb-2 text-lg font-semibold">Final</h2>
						<p class="text-base-content/70">Resolve final review feedback before publication.</p>
						<a
							href={resolve('/editions/[slug]', { slug: edition.id })}
							class="mt-2 inline-block link text-sm link-primary"
						>
							Edit Edition
						</a>
					</div>

					<div
						id="published"
						class="scroll-mt-24 rounded-box border border-base-300 bg-base-100 p-6"
					>
						<h2 class="mb-2 text-lg font-semibold">Published</h2>
						<p class="text-base-content/70">Published editions are visible to public visitors.</p>
						<a
							href={resolve('/editions/[slug]', { slug: edition.id })}
							class="mt-2 inline-block link text-sm link-primary"
						>
							View Edition
						</a>
					</div>

					<!-- Review feedback (if any) -->
				{/if}
				{#if displayReviews.length > 0}
					<div class="rounded-box border border-base-300 bg-base-100 p-6">
						<h2 class="mb-4 text-lg font-semibold">Review Feedback</h2>
						<div class="space-y-3">
							{#each displayReviews as review (review.created)}
								<div class="rounded-lg border border-base-300 p-3">
									<div class="flex items-center justify-between">
										<span class="font-medium">{review.displayName}</span>
										<span
											class="badge badge-sm {review.decision === 'approve'
												? 'badge-success'
												: review.decision === 'reject'
													? 'badge-error'
													: 'badge-warning'}"
										>
											{review.decision === 'approve'
												? 'Approve'
												: review.decision === 'reject'
													? 'Reject'
													: 'Revisions'}
										</span>
									</div>
									{#if review.comment}
										<p class="mt-2 text-sm text-base-content/70">{review.comment}</p>
									{/if}
									<p class="mt-1 text-xs text-base-content/40">
										{formatDate(review.created)}
									</p>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Reviewer: already submitted review -->
				{#if isReviewer && myExistingReview}
					<div class="alert alert-success">
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
								d="m4.5 12.75 6 6 9-13.5"
							/>
						</svg>
						<p>
							You have already submitted your review ({myExistingReview.decision === 'approve'
								? 'Approved'
								: myExistingReview.decision === 'reject'
									? 'Rejected'
									: 'Revisions Requested'}).
						</p>
					</div>
				{/if}

				<!-- Granular feedback list (author view) -->
				{#if edition && (isAuthor || isAdmin)}
					<div
						id="feedback"
						class="scroll-mt-24 rounded-box border border-base-300 bg-base-100 p-6"
					>
						<h2 class="mb-4 text-lg font-semibold">Detailed Feedback</h2>
						<ReviewFeedbackList
							editionId={edition.id}
							canResolve={canResolveFeedback}
							isAnonymized={currentStage === 2}
							{userLookup}
						/>
					</div>
				{/if}

				<!-- Collaborator Management (status view) -->
				{#if edition && isAuthor && !isSandbox}
					<div
						id="collaborators"
						class="scroll-mt-24 rounded-box border border-base-300 bg-base-100 p-6"
					>
						<h2 class="mb-4 text-lg font-semibold">Collaborators</h2>
						<CollaboratorManager
							editionId={edition.id}
							{credits}
							oncreditssaved={saveCollaboratorCredits}
							isReadOnly={[
								EditionStatus.AlphaReview,
								EditionStatus.FinalReview,
								EditionStatus.PublicationRequested,
								EditionStatus.Published
							].includes(edition.status) ||
								(!isAdmin && !canManageCollaborators) ||
								isSaving ||
								isSubmitting}
						/>
					</div>
				{/if}
			</div>
		{/if}
	{/if}

	<dialog bind:this={transferDialog} class="modal" aria-labelledby="sandbox-transfer-title">
		<div class="modal-box">
			<h2 id="sandbox-transfer-title" class="text-lg font-semibold">Transfer sandbox work</h2>
			<p class="mt-2 text-sm text-base-content/70">
				This copies your editor metadata, model files, and Voyager scene into an empty approved
				edition. The sandbox is retained so you can confirm the copy before deleting it. The
				approved edition keeps its title, attribution, and review choice.
			</p>
			<label class="mt-4 block" for="sandbox-transfer-target">
				<span class="mb-1 block text-sm font-medium">Approved edition</span>
				<select
					id="sandbox-transfer-target"
					class="select-bordered select w-full"
					bind:value={transferTargetId}
				>
					<option value="" disabled>Select an empty approved edition</option>
					{#each sandboxTargets as target (target.id)}
						<option value={target.id}>{target.dcTitle || target.title || 'Untitled Edition'}</option
						>
					{/each}
				</select>
			</label>
			<div class="modal-action">
				<button
					type="button"
					class="btn btn-outline"
					disabled={isTransferring}
					onclick={() => transferDialog.close()}>Cancel</button
				>
				<button
					type="button"
					class="btn btn-primary"
					disabled={!transferTargetId ||
						isTransferring ||
						editionAssetsBusy ||
						coverBusy ||
						isSaving ||
						effectiveSaveStatus !== 'saved'}
					onclick={transferSandbox}
				>
					{isTransferring ? 'Transferring…' : 'Copy work'}
				</button>
			</div>
		</div>
		<form method="dialog" class="modal-backdrop">
			<button aria-label="Close transfer dialog">close</button>
		</form>
	</dialog>

	<dialog bind:this={alphaRequestDialog} class="modal" aria-label="Request Alpha Review">
		<div class="modal-box w-11/12 max-w-2xl">
			{#if editionRecord && edition && [EditionStatus.ConceptAccepted, EditionStatus.AlphaRevisions].includes(edition.status)}
				<AlphaRequestForm
					edition={editionRecord}
					disabled={editionAssetsBusy || coverBusy}
					canRequest={isAuthor || isAdmin || collectionRole === CollectionRole.Owner}
					beforeSubmit={flushEditionForAlpha}
					onclose={() => alphaRequestDialog.close()}
					onstatuschange={(state) => (alphaContextSaveStatus = state)}
					onbusychange={(busy) => (isSubmitting = busy)}
					onsubmitted={() => {
						alphaRequestDialog.close();
						toast.success('Edition submitted for Alpha Review');
						void loadData();
					}}
				/>
			{/if}
		</div>
	</dialog>

	<dialog bind:this={creditsDialog} class="modal" aria-labelledby="edit-credits-title">
		<div class="modal-box w-11/12 max-w-3xl">
			<h2 id="edit-credits-title" class="mb-4 text-xl font-semibold">Edit authors</h2>
			<CreditsEditor bind:credits={editableCredits} disabled={isSubmitting} />
			<div class="modal-action">
				<button type="button" class="btn btn-outline" onclick={() => creditsDialog.close()}
					>Cancel</button
				>
				<button
					type="button"
					class="btn btn-primary"
					disabled={isSubmitting}
					onclick={() => {
						const error = validateCredits(editableCredits, false);
						if (error) {
							toast.error(error);
							return;
						}
						credits = readCredits(editableCredits);
						creditsDialog.close();
					}}>Apply changes</button
				>
			</div>
		</div>
		<form method="dialog" class="modal-backdrop">
			<button aria-label="Close credit editor">close</button>
		</form>
	</dialog>

	<dialog bind:this={unpublishDialog} class="modal" aria-labelledby="unpublish-edition-title">
		<div class="modal-box">
			<h2 id="unpublish-edition-title" class="text-lg font-semibold">
				Unpublish for final revisions
			</h2>
			<p class="mt-2 text-sm text-base-content/70">
				This removes the edition from public view, clears its publication claim, and returns it to
				Final Revisions. A new Final Review and publication request are required before
				republication.
			</p>
			<label class="mt-4 block" for="unpublish-reason">
				<span class="mb-1 block text-sm font-medium">Reason for this audit entry</span>
				<textarea
					id="unpublish-reason"
					class="textarea-bordered textarea w-full"
					bind:value={unpublishReason}
					maxlength="5000"
					required
				></textarea>
			</label>
			<div class="modal-action">
				<button
					type="button"
					class="btn btn-outline"
					disabled={isSubmitting}
					onclick={() => unpublishDialog.close()}>Cancel</button
				>
				<button
					type="button"
					class="btn btn-primary"
					disabled={isSubmitting || !unpublishReason.trim()}
					onclick={unpublishEdition}>Unpublish</button
				>
			</div>
		</div>
		<form method="dialog" class="modal-backdrop">
			<button aria-label="Close unpublish dialog">close</button>
		</form>
	</dialog>

	<dialog bind:this={submitDialog} class="modal" aria-labelledby="submit-proposal-title">
		<div class="modal-box">
			<h2 id="submit-proposal-title" class="text-lg font-bold">Submit proposal for review?</h2>
			<p class="py-4">
				Your proposal will remain private and viewable, but you and collaborators will no longer be
				able to edit proposal answers or proposal files while it is under editorial review.
			</p>
			<div class="modal-action">
				<button type="button" class="btn" onclick={() => submitDialog.close()}>Keep editing</button
				><button
					type="button"
					class="btn btn-primary"
					onclick={() => {
						submitDialog.close();
						void submitConcept();
					}}>Submit for Review</button
				>
			</div>
		</div>
		<form method="dialog" class="modal-backdrop"><button aria-label="Close">Close</button></form>
	</dialog>

	{#if showDeleteModal && edition}
		<div class="modal-open modal">
			<div class="modal-box">
				<h3 class="text-lg font-bold">Delete edition?</h3>
				<p class="py-4">
					This will permanently delete <strong>{edition.title || 'this edition'}</strong>. This
					action cannot be undone.
				</p>
				<div class="modal-action">
					<button
						type="button"
						class="btn"
						onclick={() => (showDeleteModal = false)}
						disabled={isDeleting}
					>
						Cancel
					</button>
					<button type="button" class="btn btn-error" onclick={deleteEdition} disabled={isDeleting}>
						{#if isDeleting}
							<span class="loading loading-sm loading-spinner"></span>
						{/if}
						Delete
					</button>
				</div>
			</div>
			<button
				type="button"
				class="modal-backdrop"
				onclick={() => !isDeleting && (showDeleteModal = false)}
				aria-label="Close"
			></button>
		</div>
	{/if}
</div>

<style>
	#proposal-models :global(.text-xs) {
		font-size: 0.875rem;
		line-height: 1.5;
	}
	#proposal :global(section) {
		scroll-margin-top: 10rem;
		border-color: color-mix(in srgb, var(--color-base-content) 18%, transparent);
	}
	#proposal :global(.form-control) {
		display: flex;
		flex-direction: column;
	}
	#proposal :global(.input),
	#proposal :global(.select),
	#proposal :global(.textarea) {
		background: var(--color-base-100);
		background: color-mix(in srgb, var(--color-base-100), white 65%);
		border-color: color-mix(in srgb, var(--color-base-content) 25%, transparent);
		font-size: 0.875rem;
	}
	#proposal :global(.input),
	#proposal :global(.select) {
		height: 2.5rem;
	}
	#proposal :global(input[readonly]) {
		background: var(--color-base-200);
	}
	#proposal :global(#credits-editor > fieldset > .grid) {
		gap: 0.75rem;
	}
	#proposal :global(#credits-editor > fieldset > .grid > label:last-child) {
		grid-column: 1 / -1;
	}
</style>
