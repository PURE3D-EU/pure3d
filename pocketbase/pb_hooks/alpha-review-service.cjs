/* eslint-disable @typescript-eslint/no-require-imports -- PocketBase uses CommonJS. */
const answerFields = [
	'technicalComments',
	'valueRating',
	'valueExplanation',
	'experienceComments',
	'generalComments',
	'decision',
	'recommendationExplanation',
	'collaborationInterest'
];
const editionFields = [
	'alphaRequest',
	'alphaReviewRound',
	'alphaSubmittedAt',
	'alphaFeedbackReleasedAt'
];
function words(value) {
	return String(value || '')
		.trim()
		.split(/\s+/)
		.filter(Boolean).length;
}
function value(record, key) {
	return record.get ? record.get(key) : record[key];
}
function json(record, key) {
	return record.getString ? JSON.parse(record.getString(key) || 'null') : record[key];
}
function changed(record, key) {
	return JSON.stringify(record.get(key)) !== JSON.stringify(record.original().get(key));
}
function requestErrors(data) {
	if (!data || typeof data !== 'object' || Array.isArray(data))
		return ['Describe what is ready and what reviewers should focus on.'];
	if (
		Object.keys(data).some((key) => !['ready', 'focus', 'workInProgress'].includes(key)) ||
		Object.values(data).some((v) => typeof v !== 'string')
	)
		return ['Invalid Alpha Review context.'];
	if (!data.ready?.trim() || !data.focus?.trim())
		return ['Describe what is ready and what reviewers should focus on.'];
	return words(Object.values(data).join(' ')) > 500
		? ['Review context must be 500 words or fewer in total.']
		: [];
}
function reviewErrors(data, submitting) {
	const errors = [];
	for (const [field, max] of [
		['technicalComments', 150],
		['valueExplanation', 150],
		['experienceComments', 150],
		['generalComments', 500],
		['recommendationExplanation', 500]
	]) {
		const text = value(data, field);
		if (text != null && typeof text !== 'string') errors.push('Review answers must be text.');
		if (submitting && words(text) > max) errors.push(`${field} must be ${max} words or fewer.`);
		if (submitting && field !== 'generalComments' && !String(text || '').trim())
			errors.push('Complete each review section and the recommendation explanation.');
	}
	const rating = Number(value(data, 'valueRating') || 0);
	if ((submitting || rating !== 0) && (!Number.isInteger(rating) || rating < 1 || rating > 5))
		errors.push('Choose a Value rating.');
	const decision = value(data, 'decision');
	if ((submitting || decision) && !['approve', 'request_revisions'].includes(decision))
		errors.push('Choose whether the edition can pass Alpha Review.');
	const interest = value(data, 'collaborationInterest');
	if ((submitting || interest) && !['yes', 'no'].includes(interest))
		errors.push('Choose whether you are interested in collaborating.');
	return errors;
}
function publicFeedback(record, index) {
	const result = { reviewer: 'Reviewer ' + String.fromCharCode(65 + index) };
	for (const key of [
		'technicalComments',
		'valueRating',
		'valueExplanation',
		'experienceComments',
		'generalComments'
	])
		result[key] = value(record, key) || (key === 'valueRating' ? 0 : '');
	return result;
}
function assignments(app, edition, round, stage = 2) {
	return app.findRecordsByFilter(
		'reviewAssignments',
		'editionId = {:id} && reviewStage = {:stage} && reviewRound = {:round} && status != "declined"',
		'created,id',
		0,
		0,
		{ id: edition.id, round, stage }
	);
}
function reviews(app, edition, round) {
	return app.findRecordsByFilter(
		'editionReviews',
		'editionId = {:id} && reviewStage = 2 && reviewRound = {:round}',
		'created,id',
		0,
		0,
		{ id: edition.id, round }
	);
}
function isEditor(e) {
	return (
		require('./orcid-service.cjs').admin(e) ||
		(e.auth?.collection().name === 'users' && e.auth.getString('role') === 'editorial_board')
	);
}

function protectQuery(e) {
	if (!e.auth?.isSuperuser()) {
		const query = e.requestInfo().query;
		const privateFields = require('./proposal-service.cjs').proposalFields.concat(
			editionFields,
			require('./publication-service.cjs').fields
		);
		// Fail closed to schema-local fields and JSON paths. Bare relation IDs remain usable;
		// traversals, reverse relations and @collection/@request lookups are not API search fields.
		// This is a lexical allowlist, NOT a filter parser: PocketBase still validates the grammar.
		// Quoted text uses fexpr's scanText rules (single/double quotes; backslash escapes one rune).
		// See github.com/ganigeorgiev/fexpr v0.6.0/scanner.go. Comments/unknown tokens are rejected.
		for (const expression of [String(query.filter || ''), String(query.sort || '')]) {
			if (expression.includes(String.fromCharCode(0))) throw new ForbiddenError('Invalid query.');
			const tokens =
				/"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|[A-Za-z_@#][A-Za-z0-9_.:]*|-?\d+(?:\.\d+)?|[ \t\n]+|[(),=?!<>~&|+-]/gy;
			let offset = 0;
			while (offset < expression.length) {
				tokens.lastIndex = offset;
				const match = tokens.exec(expression);
				if (!match) throw new ForbiddenError('Unsupported query syntax.');
				const token = match[0];
				offset = tokens.lastIndex;
				if (!/^[A-Za-z_@#]/.test(token) || /^(true|false|null)$/i.test(token)) continue;
				const root = token.split(/[.:]/)[0];
				const field = e.collection.fields.getByName(root);
				if (
					!field ||
					field.getHidden() ||
					privateFields.some((name) => name.toLowerCase() === root.toLowerCase()) ||
					(token.includes('.') && !['json', 'geoPoint'].includes(field.type()))
				)
					throw new ForbiddenError('Only public, local fields can be filtered or sorted.');
			}
		}
	}
	return e.next();
}

function prepareEdition(e) {
	require('./publication-service.cjs').prepareEdition(e);
	const record = e.record;
	const from = record.original().getString('status');
	const to = record.getString('status');
	for (const key of editionFields.filter((key) => key !== 'alphaRequest'))
		if (changed(record, key)) throw new BadRequestError('Alpha Review state is server-owned.');
	if (from === 'alpha_review') {
		const allowed = ['status', 'isPublished', 'reviewStage', 'publishedAt', 'publishedBy'];
		if (
			e.collection.fields.some(
				(field) => !allowed.includes(field.name) && changed(record, field.name)
			)
		)
			throw new ForbiddenError('This edition is locked during Alpha Review.');
		if (from !== to)
			throw new BadRequestError(
				'Release the Alpha feedback and editorial decision through the review workspace.'
			);
	}
	if (changed(record, 'alphaRequest') && !['concept_accepted', 'alpha_revisions'].includes(from))
		throw new ForbiddenError(
			'Alpha Review context can only be edited while preparing the edition.'
		);
	if (to === 'alpha_review' && from !== to) {
		const errors = requestErrors(json(record, 'alphaRequest'));
		if (errors.length) throw new BadRequestError(errors[0]);
		if (
			!record.getString('sceneDocument') &&
			!record.getString('settingsSceneFile') &&
			!record.getString('sceneFile')
		)
			throw new BadRequestError('Save a Voyager scene before requesting Alpha Review.');
		record.set('alphaReviewRound', record.original().getInt('alphaReviewRound') + 1);
		record.set('alphaSubmittedAt', new Date().toISOString());
		record.set('alphaFeedbackReleasedAt', '');
	}
}

function reviewRequest(e, action, edition) {
	const record = e.record;
	const stage = record.getInt('reviewStage');
	const prefix = stage === 3 ? 'final' : 'alpha';
	if (
		!e.auth ||
		e.auth.collection().name !== 'users' ||
		record.getString('reviewerId') !== e.auth.id
	)
		throw new ForbiddenError('Only the assigned reviewer can write this review.');
	if (edition.getString('status') !== prefix + '_review')
		throw new ForbiddenError('This review stage is not open.');
	const round = edition.getInt(prefix + 'ReviewRound');
	if (action === 'create') record.set('reviewRound', round);
	if (record.getInt('reviewRound') !== round)
		throw new ForbiddenError('This review round is closed.');
	const assignment = assignments(e.app, edition, round, stage).find(
		(item) => item.getString('reviewerId') === e.auth.id
	);
	if (!assignment || !['pending', 'accepted'].includes(assignment.getString('status')))
		throw new ForbiddenError('An active review invitation is required.');
	if (action === 'update' && record.original().getString('reviewStatus') === 'submitted')
		throw new ForbiddenError('Submitted reviews cannot be edited.');
	for (const field of ['submittedAt', 'feedbackReleasedAt'])
		if (changed(record, field)) throw new ForbiddenError('Review timestamps are server-owned.');
	const status = record.getString('reviewStatus') || 'draft';
	if (!['draft', 'submitted'].includes(status)) throw new BadRequestError('Invalid review status.');
	record.set('reviewStatus', status);
	const errors =
		stage === 3
			? [
					require('./publication-service.cjs').answersError(
						json(record, 'finalAnswers'),
						status === 'submitted'
					)
				].filter(Boolean)
			: reviewErrors(record, status === 'submitted');
	if (errors.length) throw new BadRequestError(errors[0]);
	if (stage === 3)
		record.set(
			'decision',
			json(record, 'finalAnswers')?.recommendation === 'without_changes'
				? 'approve'
				: 'request_revisions'
		);
	if (status === 'submitted') record.set('submittedAt', new Date().toISOString());
	return e.next();
}

function savedReview(e) {
	const stage = e.record.getInt('reviewStage');
	if (![2, 3].includes(stage)) return e.next();
	const prefix = stage === 3 ? 'final' : 'alpha';
	const app = e.app;
	try {
		return app.runInTransaction((tx) => {
			e.app = tx;
			const record = e.record;
			const edition = tx.findRecordById('editions', record.getString('editionId'));
			if (
				edition.getString('status') !== prefix + '_review' ||
				record.getInt('reviewRound') !== edition.getInt(prefix + 'ReviewRound')
			)
				throw new BadRequestError('This Alpha Review round is closed.');
			const assigned = assignments(tx, edition, record.getInt('reviewRound'), stage).find(
				(item) => item.getString('reviewerId') === record.getString('reviewerId')
			);
			if (
				!assigned ||
				(record.original().getString('reviewStatus') !== 'submitted' &&
					!['pending', 'accepted'].includes(assigned.getString('status')))
			)
				throw new ForbiddenError('This review invitation is no longer active.');
			if (!record.isNew()) {
				const current = tx.findRecordById('editionReviews', record.id);
				if (current.getString('reviewStatus') !== record.original().getString('reviewStatus'))
					throw new BadRequestError(
						'The review was submitted in another window. Reload before continuing.'
					);
			}
			e.next();
			if (
				record.getString('reviewStatus') === 'submitted' &&
				record.original().getString('reviewStatus') !== 'submitted'
			) {
				const edition = tx.findRecordById('editions', record.getString('editionId'));
				const assignment = assignments(tx, edition, record.getInt('reviewRound'), stage).find(
					(item) => item.getString('reviewerId') === record.getString('reviewerId')
				);
				if (assignment) {
					assignment.set('status', 'completed');
					tx.saveWithContext(e.context, assignment);
				}
			}
		});
	} finally {
		e.app = app;
	}
}

function progress(e) {
	const edition = e.app.findRecordById('editions', e.request.pathValue('editionId'));
	const roles = require('./orcid-service.cjs').roles(e, edition);
	if (
		!roles.admin &&
		!roles.board &&
		!roles.owner &&
		!roles.editor &&
		!roles.author &&
		!roles.collaborator
	)
		throw new ForbiddenError();
	const round = edition.getInt('alphaReviewRound');
	const assigned = assignments(e.app, edition, round);
	const submitted = reviews(e.app, edition, round).filter(
		(review) =>
			review.getString('reviewStatus') === 'submitted' &&
			assigned.some(
				(assignment) => assignment.getString('reviewerId') === review.getString('reviewerId')
			)
	);
	const released = e.app.findRecordsByFilter(
		'editionReviews',
		'editionId = {:id} && reviewStage = 2 && feedbackReleasedAt != ""',
		'reviewRound,created,id',
		0,
		0,
		{ id: edition.id }
	);
	return e.json(200, {
		round,
		total: assigned.length,
		submitted: submitted.length,
		released: !!edition.getString('alphaFeedbackReleasedAt'),
		feedback: released.map((review, index) => ({
			...publicFeedback(review, index),
			round: review.getInt('reviewRound')
		}))
	});
}

function decide(e) {
	if (!isEditor(e)) throw new ForbiddenError('An editor must release Alpha Review feedback.');
	const body = e.requestInfo().body;
	if (!['accept', 'revisions'].includes(body.decision))
		throw new BadRequestError('Choose accept or revisions.');
	const id = e.request.pathValue('editionId');
	let status;
	e.app.runInTransaction((tx) => {
		const edition = tx.findRecordById('editions', id);
		if (edition.getString('status') !== 'alpha_review')
			throw new BadRequestError('This edition is not awaiting an Alpha decision.');
		const round = edition.getInt('alphaReviewRound');
		const assigned = assignments(tx, edition, round);
		const submitted = reviews(tx, edition, round).filter(
			(review) =>
				review.getString('reviewStatus') === 'submitted' &&
				assigned.some(
					(assignment) => assignment.getString('reviewerId') === review.getString('reviewerId')
				)
		);
		if (
			assigned.length < 2 ||
			assigned.some(
				(assignment) =>
					!submitted.some(
						(review) => review.getString('reviewerId') === assignment.getString('reviewerId')
					)
			)
		)
			throw new BadRequestError(
				'Wait for all active reviewers to submit before releasing feedback.'
			);
		const context = new Context(
			null,
			'pure3d.actor',
			require('./activity-service.cjs').actor(e.auth)
		);
		const now = new Date().toISOString();
		for (const review of submitted) {
			review.set('feedbackReleasedAt', now);
			tx.saveWithContext(context, review);
		}
		status = body.decision === 'accept' ? 'alpha_accepted' : 'alpha_revisions';
		edition.set('status', status);
		edition.set('alphaFeedbackReleasedAt', now);
		tx.saveWithContext(context, edition);
	});
	return e.json(200, { status });
}

module.exports = {
	answerFields,
	editionFields,
	requestErrors,
	reviewErrors,
	publicFeedback,
	prepareEdition,
	reviewRequest,
	savedReview,
	progress,
	decide,
	isEditor,
	protectQuery
};
