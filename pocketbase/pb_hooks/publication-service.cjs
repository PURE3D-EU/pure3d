/* eslint-disable @typescript-eslint/no-require-imports -- PocketBase uses CommonJS. */
const fields = [
	'finalRequest',
	'finalReviewRound',
	'finalSubmittedAt',
	'finalFeedbackReleasedAt',
	'publicationRequest',
	'publicationSubmittedAt',
	'workflowDecision'
];
const recommendations = ['without_changes', 'minor_changes', 'major_changes', 'do_not_recommend'];
const words = (text) =>
	String(text || '')
		.trim()
		.split(/\s+/)
		.filter(Boolean).length;
const json = (r, key) => JSON.parse(r.getString(key) || 'null');
const changed = (r, key) => JSON.stringify(r.get(key)) !== JSON.stringify(r.original().get(key));
function answersError(data, submitting) {
	if (!data || typeof data !== 'object' || Array.isArray(data))
		return 'Invalid Final Review answers.';
	const keys = [
		'valueRating',
		'valueExplanation',
		'experienceComments',
		'changesRating',
		'changesExplanation',
		'recommendation',
		'comments',
		'attribution'
	];
	if (Object.keys(data).some((key) => !keys.includes(key)))
		return 'Unsupported Final Review field.';
	for (const key of ['valueExplanation', 'experienceComments', 'changesExplanation', 'comments']) {
		if (data[key] != null && typeof data[key] !== 'string') return 'Review responses must be text.';
		if (submitting && words(data[key]) > 150)
			return 'Each Final Review explanation must be 150 words or fewer.';
		if (submitting && key !== 'comments' && !data[key]?.trim())
			return 'Complete each review explanation.';
	}
	for (const key of ['valueRating', 'changesRating'])
		if (
			(submitting || data[key]) &&
			(!Number.isInteger(data[key]) || data[key] < 1 || data[key] > 5)
		)
			return 'Choose both ratings.';
	if ((submitting || data.recommendation) && !recommendations.includes(data.recommendation))
		return 'Choose a publication recommendation.';
	if ((submitting || data.attribution) && !['named', 'anonymous'].includes(data.attribution))
		return 'Choose whether your name will appear on the public review.';
	return '';
}
function requestError(data, publication) {
	if (!data || typeof data !== 'object' || Array.isArray(data))
		return 'Complete the submission statement.';
	const keys = publication
		? ['comment', 'rightsConfirmed']
		: ['changes', 'notImplemented', 'comment'];
	if (Object.keys(data).some((key) => !keys.includes(key))) return 'Unsupported submission field.';
	for (const key of keys.filter((key) => key !== 'rightsConfirmed'))
		if (typeof data[key] !== 'string') return 'Submission responses must be text.';
	if (
		words(
			keys
				.filter((key) => key !== 'rightsConfirmed')
				.map((key) => data[key])
				.join(' ')
		) > 500
	)
		return 'The submission statement must be 500 words or fewer in total.';
	if (publication ? data.rightsConfirmed !== true : !data.changes.trim())
		return publication
			? 'Confirm rights or permission for all edition materials.'
			: 'Explain how you addressed the Alpha feedback.';
	return '';
}
function metadataError(r) {
	for (const [field, label] of [
		['title', 'title'],
		['dcAbstract', 'description'],
		['dcLanguage', 'language'],
		['dcRightsLicense', 'licence']
	]) {
		if (
			!r
				.getString(field)
				.replace(/<[^>]*>/g, '')
				.trim()
		)
			return `Complete the edition ${label} before submission.`;
	}
	if (!r.getString('sceneDocument') && !r.getString('settingsSceneFile'))
		return 'Save a Voyager scene before submission.';
	return '';
}
function prepareEdition(e) {
	const r = e.record,
		from = r.original().getString('status'),
		to = r.getString('status');
	for (const key of fields.filter((key) => !['finalRequest', 'publicationRequest'].includes(key)))
		if (changed(r, key)) throw new BadRequestError('Publication workflow state is server-owned.');
	if (['final_review', 'publication_requested', 'published'].includes(from)) {
		if (e.collection.fields.some((field) => changed(r, field.name)))
			throw new ForbiddenError('This edition is locked. Use the editorial workflow to release it.');
	}
	if (changed(r, 'finalRequest') && !['alpha_accepted', 'final_revisions'].includes(from))
		throw new ForbiddenError('Final Review context is not editable at this stage.');
	if (changed(r, 'publicationRequest') && from !== 'final_accepted')
		throw new ForbiddenError(
			'Publication can only be requested after the final editorial decision.'
		);
	if (to === from) return;
	if (to === 'final_review' || to === 'publication_requested') {
		const error =
			metadataError(r) ||
			requestError(
				json(r, to === 'final_review' ? 'finalRequest' : 'publicationRequest'),
				to === 'publication_requested'
			);
		if (error) throw new BadRequestError(error);
		if (to === 'final_review') {
			r.set('finalReviewRound', r.original().getInt('finalReviewRound') + 1);
			r.set('finalSubmittedAt', new Date().toISOString());
			r.set('finalFeedbackReleasedAt', '');
		} else r.set('publicationSubmittedAt', new Date().toISOString());
		r.set('workflowDecision', '');
	}
}
function rows(app, collection, edition, stage = 3) {
	return app.findRecordsByFilter(
		collection,
		'editionId = {:id} && reviewStage = {:stage} && reviewRound = {:round}' +
			(collection === 'reviewAssignments' ? ' && status != "declined"' : ''),
		'created,id',
		0,
		0,
		{
			id: edition.id,
			stage,
			round: edition.getInt(stage === 3 ? 'finalReviewRound' : 'alphaReviewRound')
		}
	);
}
function feedback(app, review, index) {
	const data = json(review, 'finalAnswers') || {};
	const result = { reviewer: `Reviewer ${index + 1}`, round: review.getInt('reviewRound') };
	for (const key of [
		'valueRating',
		'valueExplanation',
		'experienceComments',
		'changesRating',
		'changesExplanation',
		'recommendation',
		'comments'
	])
		result[key] = data[key] || '';
	if (data.attribution === 'named') {
		try {
			result.reviewer =
				app.findRecordById('users', review.getString('reviewerId')).getString('nickname') ||
				result.reviewer;
		} catch {
			/* Retain anonymous fallback for deleted accounts. */
		}
	}
	return result;
}
function progress(e, publicOnly = false) {
	const edition = e.app.findRecordById('editions', e.request.pathValue('editionId'));
	if (publicOnly && !edition.getBool('isPublished')) throw new ForbiddenError();
	const roles = publicOnly ? null : require('./orcid-service.cjs').roles(e, edition);
	if (
		!publicOnly &&
		!['admin', 'board', 'owner', 'editor', 'author', 'collaborator'].some((key) => roles[key])
	)
		throw new ForbiddenError();
	const released = e.app.findRecordsByFilter(
		'editionReviews',
		'editionId = {:id} && reviewStage = 3 && feedbackReleasedAt != ""',
		'reviewRound,created,id',
		0,
		0,
		{ id: edition.id }
	);
	const result = { feedback: released.map((r, i) => feedback(e.app, r, i)) };
	if (publicOnly) return e.json(200, result);
	const assigned = rows(e.app, 'reviewAssignments', edition);
	const submitted = rows(e.app, 'editionReviews', edition).filter(
		(r) =>
			r.getString('reviewStatus') === 'submitted' &&
			assigned.some((a) => a.getString('reviewerId') === r.getString('reviewerId'))
	);
	Object.assign(result, {
		total: assigned.length,
		submitted: submitted.length,
		round: edition.getInt('finalReviewRound'),
		released: !!edition.getString('finalFeedbackReleasedAt'),
		decision: edition.getString('workflowDecision')
	});
	return e.json(200, result);
}
function decision(e) {
	if (!require('./alpha-review-service.cjs').isEditor(e)) throw new ForbiddenError();
	const body = e.requestInfo().body;
	if (
		!['accept', 'revisions', 'publish', 'return'].includes(body.decision) ||
		typeof body.comment !== 'string' ||
		!body.comment.trim() ||
		words(body.comment) > 500
	)
		throw new BadRequestError(
			'Choose a decision and provide an editorial explanation (maximum 500 words).'
		);
	let status;
	e.app.runInTransaction((tx) => {
		const edition = tx.findRecordById('editions', e.request.pathValue('editionId'));
		const from = edition.getString('status');
		const context = new Context(
			null,
			'pure3d.actor',
			require('./activity-service.cjs').actor(e.auth)
		);
		if (['accept', 'revisions'].includes(body.decision)) {
			if (from !== 'final_review')
				throw new BadRequestError('This edition is not awaiting a Final Review decision.');
			const assigned = rows(tx, 'reviewAssignments', edition),
				submitted = rows(tx, 'editionReviews', edition).filter(
					(r) =>
						r.getString('reviewStatus') === 'submitted' &&
						assigned.some((a) => a.getString('reviewerId') === r.getString('reviewerId'))
				);
			if (assigned.length < 2 || submitted.length !== assigned.length)
				throw new BadRequestError(
					'At least two active reviewers must submit before the editorial decision.'
				);
			const now = new Date().toISOString();
			for (const review of submitted) {
				review.set('feedbackReleasedAt', now);
				tx.saveWithContext(context, review);
			}
			edition.set('finalFeedbackReleasedAt', now);
			status = body.decision === 'accept' ? 'final_accepted' : 'final_revisions';
		} else {
			if (from !== 'publication_requested')
				throw new BadRequestError('The author must request publication first.');
			if (body.decision === 'publish') {
				const error =
					metadataError(edition) || requestError(json(edition, 'publicationRequest'), true);
				if (error || !edition.getString('finalFeedbackReleasedAt'))
					throw new BadRequestError(error || 'Final Review is incomplete.');
				status = 'published';
				edition.set('isPublished', true);
				edition.set('publishedAt', new Date().toISOString());
				edition.set('publishedBy', e.auth.isSuperuser() ? '' : e.auth.id);
				edition.set('peerReviewStamp', edition.getBool('peerReviewRequested'));
				edition.set(
					'peerReviewKind',
					edition.getBool('peerReviewRequested') ? 'Peer reviewed' : 'No peer review'
				);
			} else status = 'final_accepted';
		}
		edition.set('status', status);
		edition.set('reviewStage', 3);
		edition.set('workflowDecision', body.comment.trim());
		tx.saveWithContext(context, edition);
	});
	return e.json(200, { status });
}
function reinvite(e) {
	if (!require('./alpha-review-service.cjs').isEditor(e)) throw new ForbiddenError();
	const body = e.requestInfo().body;
	if (
		!body.dueAt ||
		!Number.isFinite(Date.parse(body.dueAt)) ||
		Date.parse(body.dueAt) <= Date.now()
	)
		throw new BadRequestError('Choose a future review deadline.');
	let count = 0;
	e.app.runInTransaction((tx) => {
		const edition = tx.findRecordById('editions', e.request.pathValue('editionId'));
		if (edition.getString('status') !== 'final_review')
			throw new BadRequestError('Final Review must be requested first.');
		const previous = rows(tx, 'reviewAssignments', edition, 2).filter(
			(r) => r.getString('status') === 'completed'
		);
		// A declined invitation is a deliberate refusal; never silently invite it again in this round.
		const current = tx.findRecordsByFilter(
			'reviewAssignments',
			'editionId = {:id} && reviewStage = 3 && reviewRound = {:round}',
			'',
			0,
			0,
			{ id: edition.id, round: edition.getInt('finalReviewRound') }
		);
		for (const assignment of previous) {
			const reviewerId = assignment.getString('reviewerId');
			if (current.some((r) => r.getString('reviewerId') === reviewerId)) continue;
			const roles = require('./orcid-service.cjs').roles(
				{ app: tx, auth: tx.findRecordById('users', reviewerId) },
				edition
			);
			if (roles.author || roles.collaborator || roles.owner || roles.editor)
				throw new BadRequestError(
					'A previous reviewer has joined the edition team. Assign an independent replacement.'
				);
			const record = new Record(tx.findCollectionByNameOrId('reviewAssignments'), {
				editionId: edition.id,
				reviewerId,
				reviewStage: 3,
				reviewRound: edition.getInt('finalReviewRound'),
				status: 'pending',
				assignedBy: e.auth.id,
				editionTitle: edition.getString('title'),
				dueAt: body.dueAt
			});
			tx.saveWithContext(
				new Context(null, 'pure3d.actor', require('./activity-service.cjs').actor(e.auth)),
				record
			);
			count++;
		}
	});
	return e.json(200, { count });
}
module.exports = {
	fields,
	answersError,
	requestError,
	metadataError,
	prepareEdition,
	progress,
	decision,
	reinvite,
	feedback
};
