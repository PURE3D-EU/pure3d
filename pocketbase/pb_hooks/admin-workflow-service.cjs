/* eslint-disable @typescript-eslint/no-require-imports -- PocketBase uses CommonJS. */
const transitions = {
	draft: ['concept_submitted'],
	concept_submitted: ['editorial_review'],
	editorial_review: ['concept_accepted', 'concept_rejected'],
	concept_accepted: ['alpha_review'],
	concept_rejected: ['draft'],
	alpha_review: ['alpha_accepted', 'alpha_rejected', 'alpha_revisions'],
	alpha_revisions: ['alpha_review'],
	alpha_accepted: ['final_review', 'alpha_review'],
	alpha_rejected: ['draft', 'alpha_review'],
	final_review: ['final_accepted', 'final_revisions'],
	final_revisions: ['final_review'],
	final_accepted: ['publication_requested', 'final_review'],
	publication_requested: ['final_accepted', 'final_review']
};
const overrideContext = 'pure3d.adminWorkflowOverride';
const republishStatuses = [
	'final_revisions',
	'final_review',
	'final_accepted',
	'publication_requested'
];

function words(value) {
	return String(value || '')
		.trim()
		.split(/\s+/)
		.filter(Boolean).length;
}

function error(from, to, reason) {
	if (!transitions[from]) return 'Published editions cannot be changed by an override.';
	if (!transitions[from].includes(to)) return 'This administrative transition is not supported.';
	if (typeof reason !== 'string' || !reason.trim() || reason.length > 5000 || words(reason) > 500)
		return 'Provide an override reason of no more than 500 words or 5,000 characters.';
	return '';
}

function unpublishError(expectedStatus, reason) {
	if (expectedStatus !== 'published') return 'The workflow changed. Reload before unpublishing.';
	if (typeof reason !== 'string' || !reason.trim() || reason.length > 5000 || words(reason) > 500)
		return 'Provide an unpublish reason of no more than 500 words or 5,000 characters.';
	return '';
}

function reviewStage(status) {
	if (
		['concept_submitted', 'editorial_review', 'concept_accepted', 'concept_rejected'].includes(
			status
		)
	)
		return 1;
	if (status.startsWith('alpha_')) return 2;
	if (status.startsWith('final_') || status === 'publication_requested') return 3;
	return 0;
}

function override(e) {
	if (!require('./orcid-service.cjs').admin(e))
		throw new ForbiddenError('Administrator access is required.');
	const body = e.requestInfo().body || {};
	const to = body.status;
	const expectedStatus = body.expectedStatus;
	const reason = typeof body.reason === 'string' ? body.reason.trim() : body.reason;
	const id = e.request.pathValue('editionId');
	let result;
	e.app.runInTransaction((tx) => {
		const edition = tx.findRecordById('editions', id);
		if (edition.getBool('isSandbox'))
			throw new ForbiddenError('Private sandboxes cannot enter the editorial workflow.');
		const from = edition.getString('status') || 'draft';
		if (expectedStatus !== from)
			throw new BadRequestError('The workflow changed. Reload before applying an intervention.');
		const message = error(from, to, reason);
		if (message) throw new BadRequestError(message);
		const now = new Date().toISOString();
		const context = new Context(
			new Context(null, overrideContext, true),
			'pure3d.actor',
			require('./activity-service.cjs').actor(e.auth)
		);

		edition.set('status', to);
		edition.set('isPublished', false);
		edition.set('reviewStage', reviewStage(to));
		if (to === 'alpha_review') {
			edition.set('alphaReviewRound', edition.getInt('alphaReviewRound') + 1);
			edition.set('alphaSubmittedAt', now);
			edition.set('alphaFeedbackReleasedAt', '');
		}
		if (to === 'final_review') {
			edition.set('finalReviewRound', edition.getInt('finalReviewRound') + 1);
			edition.set('finalSubmittedAt', now);
			edition.set('finalFeedbackReleasedAt', '');
		}
		// An override only changes workflow state. It never manufactures reviews, releases feedback,
		// confirms rights, or applies a peer-review/publication claim.
		tx.saveWithContext(context, edition);
		require('./activity-service.cjs').audit(
			tx,
			require('./activity-service.cjs').actor(e.auth),
			'workflow_override',
			'edition',
			edition.id,
			{ from, to, reason }
		);
		result = {
			status: to,
			alphaReviewRound: edition.getInt('alphaReviewRound'),
			finalReviewRound: edition.getInt('finalReviewRound')
		};
	});
	return e.json(200, result);
}

function unpublish(e) {
	if (!require('./orcid-service.cjs').admin(e))
		throw new ForbiddenError('Administrator access is required.');
	const body = e.requestInfo().body || {};
	const reason = typeof body.reason === 'string' ? body.reason.trim() : body.reason;
	const message = unpublishError(body.expectedStatus, reason);
	if (message) throw new BadRequestError(message);
	const id = e.request.pathValue('editionId');
	let result;
	e.app.runInTransaction((tx) => {
		const edition = tx.findRecordById('editions', id);
		if (edition.getBool('isSandbox'))
			throw new ForbiddenError('Private sandboxes cannot enter the editorial workflow.');
		if (edition.getString('status') !== body.expectedStatus)
			throw new BadRequestError('The workflow changed. Reload before unpublishing.');
		const now = new Date().toISOString();
		const actor = require('./activity-service.cjs').actor(e.auth);
		const context = new Context(new Context(null, overrideContext, true), 'pure3d.actor', actor);

		// Revisions preserve the review trail and require a fresh Final Review before republication.
		edition.set('status', 'final_revisions');
		edition.set('isPublished', false);
		edition.set('reviewStage', 3);
		edition.set('publishedAt', '');
		edition.set('publishedBy', '');
		edition.set('dcDateUnPublished', now);
		edition.set('peerReviewStamp', false);
		edition.set('peerReviewKind', '');
		edition.set('publicationRequest', '');
		edition.set('publicationSubmittedAt', '');
		edition.set('workflowDecision', '');
		tx.saveWithContext(context, edition);
		require('./activity-service.cjs').audit(
			tx,
			actor,
			'edition_unpublished',
			'edition',
			edition.id,
			{
				from: 'published',
				to: 'final_revisions',
				reason
			}
		);
		result = { status: 'final_revisions', unpublishedAt: now };
	});
	return e.json(200, result);
}

function canRepublish(app, edition) {
	if (
		edition.getBool('isSandbox') ||
		edition.getBool('isPublished') ||
		!republishStatuses.includes(edition.getString('status'))
	)
		return false;
	const [event] = app.findRecordsByFilter(
		'auditLog',
		'targetType = "edition" && targetId = {:id} && (action = "edition_unpublished" || action = "edition_republished" || (action = "status_transition" && details.after.status = "published"))',
		'-created,-id',
		1,
		0,
		{ id: edition.id }
	);
	// Historical metadata is editable; only a server-written unpublish event grants eligibility.
	return !!event && event.getString('action') === 'edition_unpublished';
}

function republishEligibility(e) {
	if (!require('./orcid-service.cjs').admin(e))
		throw new ForbiddenError('Administrator access is required.');
	const edition = e.app.findRecordById('editions', e.request.pathValue('editionId'));
	e.response.header().set('Cache-Control', 'no-store');
	return e.json(200, { eligible: canRepublish(e.app, edition) });
}

function republish(e) {
	if (!require('./orcid-service.cjs').admin(e))
		throw new ForbiddenError('Administrator access is required.');
	const id = e.request.pathValue('editionId');
	const body = e.requestInfo().body || {};
	const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
	if (!reason || reason.length > 5000 || words(reason) > 500)
		throw new BadRequestError(
			'Provide a republication reason of no more than 500 words or 5,000 characters.'
		);
	if (body.rightsConfirmed !== true)
		throw new BadRequestError('Confirm that you have permission to publish the revised edition.');

	e.app.runInTransaction((tx) => {
		const edition = tx.findRecordById('editions', id);
		const from = edition.getString('status');
		if (from !== body.expectedStatus || edition.getString('updated') !== body.expectedUpdated)
			throw new BadRequestError('The edition changed. Reload and review it before republishing.');
		if (!canRepublish(tx, edition))
			throw new BadRequestError(
				'Only previously published editions withdrawn by an administrator can be republished here.'
			);
		const metadataError = require('./publication-service.cjs').metadataError(edition);
		if (metadataError) throw new BadRequestError(metadataError);

		const activity = require('./activity-service.cjs');
		const actor = activity.actor(e.auth);
		edition.set('status', 'published');
		edition.set('isPublished', true);
		edition.set('reviewStage', 3);
		edition.set('publishedAt', new Date().toISOString());
		edition.set('publishedBy', e.auth.isSuperuser() ? '' : e.auth.id);
		edition.set('dcDateUnPublished', '');
		edition.set('peerReviewStamp', false);
		edition.set('peerReviewKind', 'No peer review');
		edition.set('publicationRequest', '');
		edition.set('publicationSubmittedAt', '');
		edition.set('workflowDecision', '');
		// Run the normal publication-time credit checks, without an administrative exemption.
		tx.saveWithContext(new Context(null, 'pure3d.actor', actor), edition);
		activity.audit(tx, actor, 'edition_republished', 'edition', id, {
			from,
			to: 'published',
			reason,
			rightsConfirmed: true
		});
	});
	return e.json(200, { status: 'published' });
}

module.exports = {
	transitions,
	error,
	unpublishError,
	reviewStage,
	override,
	unpublish,
	republishEligibility,
	republish,
	overrideContext
};
