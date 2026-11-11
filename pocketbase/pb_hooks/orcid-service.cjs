/* eslint-disable @typescript-eslint/no-require-imports -- PocketBase Goja supports CommonJS, not ESM. */
const v = require('./orcid-validation.cjs');
const proposal = require('./proposal-service.cjs');
const sandbox = require('./sandbox-service.cjs');
const identityFields = ['orcid', 'orcidVerifiedAt', 'pendingOrcid'];
const profileFields = ['nickname', 'affiliation', 'bio', 'titleRole', 'socials'];
const proofContext = 'pure3d.orcid.proof';
const adminWorkflowOverrideContext = 'pure3d.adminWorkflowOverride';

function bad(message) {
	throw new BadRequestError(message);
}
function deny() {
	throw new ForbiddenError('Not authorised for this operation');
}
function checked(fn) {
	try {
		return fn();
	} catch (error) {
		throw new BadRequestError(error.message || 'Invalid ORCID data');
	}
}
function data(record) {
	return { orcid: record.getString('orcid'), orcidVerifiedAt: record.getString('orcidVerifiedAt') };
}
function verifiedAccount(app, record) {
	const user = data(record);
	if (!v.verified(user)) return false;
	const { issuer } = v.orcidEndpoints($os.getenv('ORCID_ISSUER') || 'https://orcid.org');
	const provider = record
		.collection()
		.oauth2.providers.find((provider) => provider.name === 'oidc');
	if (
		!provider ||
		!provider.extra ||
		provider.userInfoURL ||
		provider.tokenURL !== issuer + '/oauth/token' ||
		provider.extra.jwksURL !== v.orcidJwksURL($os.getenv('ORCID_JWKS_ORIGIN') || undefined) ||
		JSON.stringify(provider.extra.issuers) !== JSON.stringify([issuer])
	)
		return false;
	const links = matches(
		app,
		'_externalAuths',
		'collectionRef = {:collection} && recordRef = {:record}',
		{ collection: record.collection().id, record: record.id }
	);
	return (
		links.length === 1 &&
		links[0].getString('provider') === 'oidc' &&
		links[0].getString('providerId') === user.orcid.slice(18)
	);
}
function creditUser(app, id) {
	const record = app.findRecordById('users', id);
	if (!verifiedAccount(app, record)) bad('Credit account has no verified linked ORCID identity');
	return data(record);
}
function json(record, field) {
	return JSON.parse(record.getString(field) || 'null');
}
function changed(record, field) {
	if (field === 'credits')
		return !v.sameCredits(json(record, field), json(record.original(), field));
	return JSON.stringify(record.get(field)) !== JSON.stringify(record.original().get(field));
}
function admin(e) {
	return !!(
		e.auth &&
		(e.auth.isSuperuser() ||
			(e.auth.collection().name === 'users' && e.auth.getString('role') === 'admin'))
	);
}
function actor(e) {
	if (!e.auth || e.auth.collection().name !== 'users') deny();
	return e.app.findRecordById('users', e.auth.id);
}
function matches(app, collection, filter, params) {
	return app.findRecordsByFilter(collection, filter, '', 0, 0, params);
}
function member(app, collection, parentField, parentId, userId, roles) {
	if (!parentId || !userId) return false;
	return matches(app, collection, parentField + ' = {:parent} && userId = {:user}', {
		parent: parentId,
		user: userId
	}).some((row) => roles.indexOf(row.getString('role')) !== -1);
}
const roleBatchField = '@pbInternalPure3dRoles';
function emptyRoles() {
	return {
		admin: false,
		board: false,
		owner: false,
		editor: false,
		author: false,
		collaborator: false,
		reviewer: false
	};
}
function roleIndex(app, userId, edition = true) {
	const groups = { collections: {}, editions: {}, assignments: {} };
	let queryCount = 0;
	const sources = [['collectionUsers', 'collection', 'collections']];
	if (edition)
		sources.push(
			['editionUsers', 'editionId', 'editions'],
			['reviewAssignments', 'editionId', 'assignments']
		);
	for (const [collection, parent, target] of sources) {
		queryCount++;
		const rows = matches(
			app,
			collection,
			collection === 'reviewAssignments'
				? 'reviewerId = {:user} && status != "declined" && status != "completed"'
				: 'userId = {:user}',
			{ user: userId }
		);
		for (const row of rows) {
			const id = row.getString(parent);
			if (!groups[target][id]) groups[target][id] = [];
			groups[target][id].push(row);
		}
	}
	return { groups, queryCount };
}
function indexedRoles(e, record, index) {
	const uid = e.auth ? e.auth.id : '';
	const empty = emptyRoles();
	if (admin(e)) return { ...empty, admin: true };
	if (!uid) return empty;
	const edition = record.collection().name === 'editions';
	const cid = edition ? record.getString('collection') : record.id;
	const collectionRoles = (index.collections[cid] || []).map((row) => row.getString('role'));
	const editionRoles = edition
		? (index.editions[record.id] || []).map((row) => row.getString('role'))
		: [];
	const stage = edition ? v.reviewStage(record.getString('status')) : 0;
	const round = record.getInt(stage === 3 ? 'finalReviewRound' : 'alphaReviewRound');
	return {
		admin: false,
		board: !!(
			e.auth &&
			e.auth.collection().name === 'users' &&
			e.auth.getString('role') === 'editorial_board'
		),
		owner: collectionRoles.includes('owner'),
		editor: collectionRoles.includes('editor'),
		author: editionRoles.includes('author'),
		collaborator: editionRoles.includes('collaborator'),
		reviewer:
			edition &&
			(index.assignments[record.id] || []).some(
				(row) =>
					row.getInt('reviewStage') === stage &&
					(stage === 1 || row.getInt('reviewRound') === round)
			)
	};
}
function batchRoles(e, records) {
	const uid = e.auth ? e.auth.id : '';
	const batch =
		uid && !admin(e) ? roleIndex(e.app, uid) : { groups: emptyRoleIndex(), queryCount: 0 };
	for (const record of records || [])
		record.setRaw(
			roleBatchField,
			JSON.stringify({
				userId: uid,
				queryCount: batch.queryCount,
				access: indexedRoles(e, record, batch.groups)
			})
		);
}
function batchAccess(record, userId) {
	try {
		const batch = JSON.parse(record.getString(roleBatchField) || '');
		if (
			batch.userId === userId &&
			batch.access &&
			Object.keys(emptyRoles()).every((key) => typeof batch.access[key] === 'boolean')
		)
			return batch.access;
	} catch {
		/* Untrusted or absent custom fields fall back to direct server queries. */
	}
	return null;
}
function emptyRoleIndex() {
	return { collections: {}, editions: {}, assignments: {} };
}
function roles(e, record) {
	const uid = e.auth ? e.auth.id : '';
	const batched = batchAccess(record, uid);
	if (batched) return batched;
	const edition = record.collection().name === 'editions';
	const index = uid && !admin(e) ? roleIndex(e.app, uid, edition).groups : emptyRoleIndex();
	return indexedRoles(e, record, index);
}

function oauth(e) {
	if (e.providerName !== 'oidc') deny();
	const { issuer } = v.orcidEndpoints($os.getenv('ORCID_ISSUER') || 'https://orcid.org');
	const provider = e.providerClient;
	const extra = provider.extra();
	// Fail closed if an operator accidentally enables the unverified/userinfo path.
	if (
		provider.userInfoURL() !== '' ||
		provider.tokenURL() !== issuer + '/oauth/token' ||
		extra.jwksURL !== v.orcidJwksURL($os.getenv('ORCID_JWKS_ORIGIN') || undefined) ||
		JSON.stringify(extra.issuers) !== JSON.stringify([issuer])
	)
		deny();
	const claims = e.oAuth2User.rawUser;
	const orcid = checked(() => v.subjectOrcid(e.oAuth2User.id));
	const now = Math.floor(Date.now() / 1000);
	if (
		!claims ||
		claims.sub !== e.oAuth2User.id ||
		claims.iss !== issuer ||
		typeof claims.exp !== 'number' ||
		claims.exp <= now ||
		typeof claims.iat !== 'number' ||
		claims.iat > now + 60
	)
		deny();
	const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
	if (
		audience.indexOf(provider.clientId()) === -1 ||
		(audience.length > 1 && claims.azp !== provider.clientId()) ||
		(claims.azp && claims.azp !== provider.clientId())
	)
		deny();
	const app = e.app;
	app.runInTransaction((tx) => {
		e.app = tx;
		const links = matches(
			tx,
			'_externalAuths',
			'collectionRef = {:collection} && provider = "oidc" && providerId = {:subject}',
			{ collection: e.collection.id, subject: e.oAuth2User.id }
		);
		const candidates = matches(tx, 'users', 'orcid = {:orcid} || pendingOrcid = {:orcid}', {
			orcid
		});
		if (links.length > 1 || candidates.length > 1) bad('Conflicting ORCID identity');
		let target = links.length ? tx.findRecordById('users', links[0].getString('recordRef')) : null;
		if (target && candidates.length && candidates[0].id !== target.id)
			bad('Conflicting ORCID identity');
		if (!target && candidates.length) {
			// A stored ORCID is curated account data. OAuth proves control of that exact ID;
			// never infer an account from a name or email alone.
			target = candidates[0];
		}
		// PB already chose e.record by external link, logged-in account, or email.
		// A fallback is never authority, even when it happens to have a matching email/name.
		if (e.record && (!target || e.record.id !== target.id))
			bad('Automatic account linking is disabled; ask an administrator to approve the exact ORCID');
		if (e.auth && (!target || e.auth.id !== target.id || e.auth.collection().name !== 'users'))
			bad('Sign out before signing in with another ORCID');
		if (target) {
			if (target.getString('orcidVerifiedAt') && target.getString('orcid') !== orcid)
				bad('Account already has another verified ORCID');
			const otherLinks = matches(
				tx,
				'_externalAuths',
				'collectionRef = {:collection} && recordRef = {:record}',
				{ collection: e.collection.id, record: target.id }
			);
			if (
				otherLinks.some(
					(link) =>
						link.getString('provider') !== 'oidc' ||
						link.getString('providerId') !== e.oAuth2User.id
				)
			)
				bad('Account has a conflicting external identity');
		} else {
			target = new Record(e.collection);
			target.setRandomPassword();
			target.set('role', 'user');
		}
		e.isNewRecord = target.isNew();
		target.set('orcid', orcid);
		target.set('orcidVerifiedAt', target.getString('orcidVerifiedAt') || new Date().toISOString());
		target.set('pendingOrcid', '');
		tx.saveWithContext(
			new Context(new Context(null, proofContext, true), 'pure3d.actor', 'oauth'),
			target
		);
		// Native OAuth saves again without proof context; reload the saved identity baseline inside this transaction.
		e.record = tx.findRecordById('users', target.id);
		e.createData = {};
		e.oAuth2User.email = '';
		e.oAuth2User.name = '';
		e.oAuth2User.avatarURL = '';
		e.oAuth2User.accessToken = '';
		e.oAuth2User.refreshToken = '';
		e.oAuth2User.rawUser = {};
		return e.next();
	});
	e.app = app;
}

function createRequest(e) {
	const name = e.collection.name;
	// Never trust an import/client-supplied creator marker.
	e.record.set('__pure3dCreator', null);
	if (name === 'users') {
		if (!e.auth || !e.auth.isSuperuser()) deny();
		if (identityFields.some((field) => e.record.getString(field)))
			bad('Imports cannot assert ORCID identity or approval');
		return e.next();
	}
	if (name === 'collectionUsers' || name === 'editionUsers') {
		membershipAccess(e);
		return e.next();
	}
	// Superuser imports have no corresponding users record. Model validation still gates credits/publication.
	if (e.auth && e.auth.isSuperuser()) return e.next();
	const user = actor(e);
	if (name === 'collections' && !admin(e)) deny();
	if (name === 'editions') {
		sandbox.rejectExternalCreate(e.record);
		if (!checked(() => verifiedAccount(e.app, user)))
			bad('A verified ORCID is required to author an edition');
		const cid = e.record.getString('collection');
		if (
			cid &&
			!admin(e) &&
			!member(e.app, 'collectionUsers', 'collection', cid, user.id, ['owner'])
		)
			deny();
		if (e.record.getString('status') && e.record.getString('status') !== 'draft')
			bad('New editions must start as drafts');
		if (e.record.getBool('isPublished')) bad('New editions must start as drafts');
		e.record.set('status', 'draft');
		proposal.validateOpenCallSelection(e.app, e.record);
		for (const field of [
			'publishedAt',
			'publishedBy',
			'reviewStage',
			'peerReviewStamp',
			'proposalSubmittedAt',
			'proposalSnapshot',
			'proposalModels',
			'proposalAuthorAffiliations'
		])
			e.record.set(field, null);
		proposal.syncModels(e.record);
		for (const field of require('./alpha-review-service.cjs').editionFields)
			e.record.set(field, null);
		for (const field of require('./publication-service.cjs').fields) e.record.set(field, null);
	}
	e.record.set('__pure3dCreator', user.id);
	return e.next();
}

function updateRequest(e) {
	const r = e.record;
	const name = e.collection.name;
	if (name === 'users') {
		if (!admin(e) && (!e.auth || e.auth.id !== r.id || e.auth.collection().name !== 'users'))
			deny();
		const importedProfile =
			e.auth && e.auth.isSuperuser() && !r.original().getString('orcidVerifiedAt');
		if (
			identityFields.concat(importedProfile ? [] : profileFields).some((field) => changed(r, field))
		)
			bad('ORCID identity and profile fields are server-owned');
		if (changed(r, 'role') && !admin(e)) deny();
		if (!importedProfile) {
			for (const field of ['email', 'emailVisibility', 'verified', 'password', 'tokenKey'])
				if (changed(r, field)) bad('OAuth account credentials are server-owned');
		}
	} else if (name === 'collectionUsers' || name === 'editionUsers') {
		membershipAccess(e);
		for (const field of ['user', 'userId', 'edition', 'editionId', 'collection'])
			if (changed(r, field))
				bad('Membership targets are immutable; remove and add the membership instead');
	} else {
		if (name === 'editions' && sandbox.isSandbox(r.original())) {
			sandbox.prepareUpdate(e);
			return e.next();
		}
		if (name === 'editions') sandbox.assertNoSandboxMutation(r);
		const access = roles(e, r.original());
		const edition = name === 'editions';
		const statusChanged = edition && changed(r, 'status');
		if (
			statusChanged &&
			!v.canTransition(r.original().getString('status') || 'draft', r.getString('status'), access)
		)
			deny();
		const canEdit =
			access.admin || access.owner || access.editor || access.author || access.collaborator;
		if (!canEdit) {
			if (!statusChanged) deny();
			const workflow = [
				'status',
				'isPublished',
				'reviewStage',
				'publishedAt',
				'publishedBy',
				'proposalSubmittedAt'
			];
			for (const field of e.collection.fields)
				if (workflow.indexOf(field.name) === -1 && changed(r, field.name)) deny();
		}
		if (edition) {
			r.ignoreUnchangedFields(true);
			require('./alpha-review-service.cjs').prepareEdition(e);
			const changedFields = e.collection.fields
				.filter((field) => changed(r, field.name))
				.map((field) => field.name);
			if (
				!access.admin &&
				!proposal.canAuthorEditProposal(r.original().getString('status') || 'draft', changedFields)
			)
				deny();
			if (
				[
					'proposalSubmittedAt',
					'proposalSnapshot',
					'proposalModels',
					'proposalAuthorAffiliations'
				].some((field) => changed(r, field))
			)
				bad('Proposal submission and file metadata are server-owned');
			if (changed(r, 'proposalOpenCall')) proposal.validateOpenCallSelection(e.app, r);
			if (
				changedFields.some((field) =>
					['proposalModelFiles', 'proposalModelAssets', 'proposalModelScenes'].includes(field)
				)
			)
				proposal.syncModels(r);
			if (
				statusChanged &&
				['draft', 'concept_rejected'].includes(r.original().getString('status')) &&
				r.getString('status') === 'concept_submitted'
			) {
				proposal.validateSubmission(r, e.app);
				r.set('proposalSubmittedAt', new Date().toISOString());
				r.set('proposalSnapshot', {
					title: r.getString('title'),
					credits: json(r, 'credits'),
					openCall: proposal.openCallSnapshot(e.app, r)
				});
			}
			if (
				changed(r, 'credits') ||
				(statusChanged && r.getString('status') === 'concept_submitted')
			) {
				if (['draft', 'concept_rejected'].includes(r.original().getString('status'))) {
					r.set(
						'proposalAuthorAffiliations',
						(json(r, 'credits') || []).map((credit) => {
							let affiliation = '';
							if (credit.userId)
								affiliation = e.app.findRecordById('users', credit.userId).getString('affiliation');
							return { name: credit.name, userId: credit.userId || '', affiliation };
						})
					);
				}
			}
			if (changed(r, 'collection')) {
				if (!access.admin && !access.owner && !access.author) deny();
				const cid = r.getString('collection');
				if (
					cid &&
					!access.admin &&
					!member(e.app, 'collectionUsers', 'collection', cid, e.auth.id, ['owner'])
				)
					deny();
			}
			if (
				!statusChanged &&
				['isPublished', 'publishedAt', 'publishedBy', 'reviewStage', 'peerReviewStamp'].some(
					(field) => changed(r, field)
				)
			)
				bad('Publication and review state must change through the status workflow');
			if (statusChanged) {
				const status = r.getString('status');
				r.set('isPublished', status === 'published');
				r.set(
					'reviewStage',
					/^concept_|^editorial_/.test(status)
						? 1
						: /^alpha_/.test(status)
							? 2
							: /^final_/.test(status)
								? 3
								: 0
				);
				r.set('publishedAt', status === 'published' ? new Date().toISOString() : '');
				r.set('publishedBy', status === 'published' && !e.auth.isSuperuser() ? actor(e).id : '');
				let reviewed = false;
				if (status === 'published' && r.getBool('peerReviewRequested')) {
					const assignments = matches(
						e.app,
						'reviewAssignments',
						'editionId = {:id} && reviewStage = 3 && status != "declined"',
						{ id: r.id }
					);
					const approvals = matches(
						e.app,
						'editionReviews',
						'editionId = {:id} && reviewStage = 3 && decision = "approve"',
						{ id: r.id }
					);
					reviewed =
						assignments.length > 0 &&
						assignments.every((assignment) =>
							approvals.some(
								(review) => review.getString('reviewerId') === assignment.getString('reviewerId')
							)
						);
				}
				r.set('peerReviewStamp', reviewed);
				if (status === 'published')
					r.set('peerReviewKind', reviewed ? 'Peer reviewed' : 'No peer review');
			}
		} else if (changed(r, 'isVisible') && !access.admin && !access.owner) deny();
	}
	return e.next();
}

function membershipAccess(e) {
	const r = e.record;
	if (e.collection.name === 'editionUsers') {
		const edition = e.app.findRecordById('editions', r.getString('editionId'));
		if (sandbox.isSandbox(edition))
			throw new ForbiddenError(
				'Private sandboxes cannot be shared or added to the editorial workflow.'
			);
	}
	if (admin(e)) return;
	actor(e);
	if (e.collection.name === 'collectionUsers') {
		if (
			!member(e.app, 'collectionUsers', 'collection', r.getString('collection'), e.auth.id, [
				'owner'
			])
		)
			deny();
		if (r.getString('role') === 'owner' || r.original().getString('role') === 'owner') deny();
	} else {
		const edition = e.app.findRecordById('editions', r.getString('editionId'));
		if (
			['alpha_review', 'final_review', 'publication_requested', 'published'].includes(
				edition.getString('status')
			)
		)
			deny();
		const access = roles(e, edition);
		if (!access.owner && !access.author) deny();
		if (
			r.getString('role') !== 'collaborator' ||
			(!r.isNew() && r.original().getString('role') !== 'collaborator')
		)
			deny();
	}
}

function deleteRequest(e) {
	const name = e.collection.name;
	if (name === 'users') {
		if (!admin(e)) deny();
	} else if (name === 'collectionUsers' || name === 'editionUsers') membershipAccess(e);
	else {
		if (name === 'editions' && sandbox.isSandbox(e.record)) {
			sandbox.prepareDelete(e);
			return e.next();
		}
		const access = roles(e, e.record);
		if (!access.admin && !access.owner) deny();
	}
	return e.next();
}

function createMembership(e) {
	const creator = e.record.getString('__pure3dCreator');
	if (!creator) return e.next(); // Internal imports have no current request user.
	e.record.set('__pure3dCreator', null);
	e.app.runInTransaction((tx) => {
		e.app = tx;
		e.next();
		const edition = e.record.collection().name === 'editions';
		const membership = new Record(
			tx.findCollectionByNameOrId(edition ? 'editionUsers' : 'collectionUsers')
		);
		membership.set('userId', creator);
		membership.set('user', creator);
		membership.set(edition ? 'editionId' : 'collection', e.record.id);
		if (edition) membership.set('edition', e.record.id);
		membership.set('role', edition ? 'author' : 'owner');
		tx.saveWithContext(new Context(null, 'pure3d.actor', 'users/' + creator), membership);
	});
}

function validateRecord(e) {
	const r = e.record;
	const name = r.collection().name;
	if (name === 'users') {
		if (
			!e.context.value(proofContext) &&
			identityFields
				.concat(
					r.original().getString('orcidVerifiedAt') || r.getString('orcidVerifiedAt')
						? profileFields
						: []
				)
				.some((field) => changed(r, field))
		)
			bad('ORCID fields may only be changed by the ORCID endpoints');
	} else if (name === 'collectionUsers' || name === 'editionUsers') {
		const uid = r.getString('userId');
		if (!uid || (r.getString('user') && r.getString('user') !== uid))
			bad('Membership user and userId must agree');
		r.set('user', uid);
		if (name === 'editionUsers') {
			if (
				!r.getString('editionId') ||
				(r.getString('edition') && r.getString('edition') !== r.getString('editionId'))
			)
				bad('Membership edition and editionId must agree');
			r.set('edition', r.getString('editionId'));
			if (
				r.getString('role') === 'author' &&
				(r.isNew() || changed(r, 'role') || changed(r, 'userId')) &&
				!sandbox.isSandbox(e.app.findRecordById('editions', r.getString('editionId'))) &&
				!checked(() => verifiedAccount(e.app, e.app.findRecordById('users', uid)))
			)
				bad('Edition authors require a verified ORCID');
		} else if (!r.getString('collection')) bad('Membership collection is required');
	} else {
		const edition = name === 'editions';
		const adminWorkflowOverride =
			edition && !!e.context.value(adminWorkflowOverrideContext) && !r.isNew();
		if (adminWorkflowOverride && changed(r, 'credits'))
			bad('Administrative workflow overrides cannot alter credits.');
		const publishField = edition ? 'isPublished' : 'isVisible';
		const entering =
			(r.getBool(publishField) && !r.original().getBool(publishField)) ||
			(edition && changed(r, 'status') && r.getString('status') !== 'draft');
		const active =
			r.getBool(publishField) ||
			(edition && r.getString('status') !== '' && r.getString('status') !== 'draft');
		const editingUnpublished =
			edition &&
			!r.getBool(publishField) &&
			[
				'draft',
				'concept_rejected',
				'concept_accepted',
				'alpha_rejected',
				'alpha_revisions',
				'alpha_accepted',
				'final_revisions',
				'final_accepted'
			].includes(r.getString('status'));
		const editingPublic = active && !editingUnpublished && changed(r, 'credits');
		if (active && !r.isNew() && ['dcCreator', 'dcContributor'].some((field) => changed(r, field)))
			bad('Use canonical credits; legacy published attribution can only be preserved');
		if (r.isNew() || changed(r, 'credits') || entering) {
			const validated = checked(() =>
				v.credits(
					json(r, 'credits') || [],
					json(r.original(), 'credits') || [],
					entering || editingPublic,
					(id) => creditUser(e.app, id),
					adminWorkflowOverride
				)
			);
			r.set('credits', validated);
		}
		if (
			(entering || (active && changed(r, 'collection'))) &&
			edition &&
			r.getString('collection')
		) {
			const parent = e.app.findRecordById('collections', r.getString('collection'));
			checked(() =>
				v.credits(
					json(parent, 'credits') || [],
					json(parent, 'credits') || [],
					true,
					(id) => creditUser(e.app, id),
					adminWorkflowOverride
				)
			);
		}
	}
	return e.next();
}

function deleteUser(e) {
	e.app.runInTransaction((tx) => {
		e.app = tx;
		for (const name of ['collections', 'editions']) {
			// JSON attribution is durable, unlike a relation field. Preserve everything but the account link.
			for (const row of matches(tx, name, 'credits ~ {:id}', { id: e.record.id })) {
				const credits = json(row, 'credits');
				if (!Array.isArray(credits) || !credits.some((credit) => credit.userId === e.record.id))
					continue;
				for (const credit of credits) if (credit.userId === e.record.id) delete credit.userId;
				// SQL inside the deletion transaction avoids revalidating historical published attribution.
				tx.db()
					.newQuery('UPDATE {{' + name + '}} SET [[credits]] = {:credits} WHERE [[id]] = {:id}')
					.bind({ credits: JSON.stringify(credits), id: row.id })
					.execute();
			}
		}
		return e.next();
	});
}

function pending(e, apply) {
	if (!admin(e)) deny();
	const collection = e.app.findCollectionByNameOrId('users');
	const field = collection.fields.getByName('pendingOrcid');
	if (!field || !field.getHidden() || !collection.fields.getByName('orcidVerifiedAt'))
		bad('Run configure-orcid.ts --prepare before approving ORCID mappings');
	let result;
	e.app.runInTransaction((tx) => {
		let user = tx.findRecordById('users', e.request.pathValue('userId'));
		if (apply) {
			const body = e.requestInfo().body;
			if (!Object.prototype.hasOwnProperty.call(body, 'orcid'))
				bad('orcid is required (use null to clear)');
			const orcid = body.orcid === null ? '' : checked(() => v.canonicalOrcid(body.orcid));
			if (user.getString('orcidVerifiedAt')) bad('A verified ORCID cannot be remapped');
			if (orcid) {
				if (
					matches(tx, 'users', 'id != {:id} && (orcid = {:orcid} || pendingOrcid = {:orcid})', {
						id: user.id,
						orcid
					}).length
				)
					bad('Conflicting ORCID identity');
				if (
					matches(
						tx,
						'_externalAuths',
						'collectionRef = {:collection} && ((provider = "oidc" && providerId = {:subject}) || recordRef = {:id})',
						{ collection: user.collection().id, subject: orcid.slice(18), id: user.id }
					).length
				)
					bad('Conflicting external identity');
			}
			user.set('pendingOrcid', orcid);
			tx.saveWithContext(
				new Context(
					new Context(null, proofContext, true),
					'pure3d.actor',
					require('./activity-service.cjs').actor(e.auth)
				),
				user
			);
			user = tx.findRecordById('users', user.id);
			if (user.getString('pendingOrcid') !== orcid) bad('Pending ORCID mapping readback failed');
		}
		result = {
			userId: user.id,
			pendingOrcid: user.getString('pendingOrcid') || null,
			orcid: user.getString('orcid') || null,
			orcidVerifiedAt: user.getString('orcidVerifiedAt') || null
		};
	});
	return e.json(200, result);
}

function curate(e) {
	if (!admin(e)) deny();
	const orcid = checked(() => v.canonicalOrcid(e.requestInfo().body.orcid));
	let result;
	e.app.runInTransaction((tx) => {
		let user = tx.findRecordById('users', e.request.pathValue('userId'));
		if (user.getString('orcidVerifiedAt')) bad('A verified ORCID cannot be remapped');
		if (
			(user.getString('orcid') && user.getString('orcid') !== orcid) ||
			(user.getString('pendingOrcid') && user.getString('pendingOrcid') !== orcid)
		)
			bad('Existing ORCID mapping must be reviewed before changing it');
		if (
			matches(tx, 'users', 'id != {:id} && (orcid = {:orcid} || pendingOrcid = {:orcid})', {
				id: user.id,
				orcid
			}).length ||
			matches(
				tx,
				'_externalAuths',
				'collectionRef = {:collection} && ((provider = "oidc" && providerId = {:subject}) || recordRef = {:id})',
				{ collection: user.collection().id, subject: orcid.slice(18), id: user.id }
			).length
		)
			bad('Conflicting ORCID identity');
		if (user.getString('orcid') !== orcid || user.getString('pendingOrcid')) {
			user.set('orcid', orcid);
			user.set('pendingOrcid', '');
			tx.saveWithContext(
				new Context(
					new Context(null, proofContext, true),
					'pure3d.actor',
					require('./activity-service.cjs').actor(e.auth)
				),
				user
			);
			user = tx.findRecordById('users', user.id);
		}
		if (user.getString('orcid') !== orcid || user.getString('orcidVerifiedAt'))
			bad('Curated ORCID readback failed');
		result = { userId: user.id, orcid, orcidVerifiedAt: null };
	});
	return e.json(200, result);
}

function jwks(e) {
	const { issuer } = v.orcidEndpoints($os.getenv('ORCID_ISSUER') || 'https://orcid.org');
	try {
		const response = $http.send({
			url: issuer + '/oauth/jwks',
			headers: { Accept: 'application/json' },
			timeout: 10
		});
		if (response.statusCode !== 200) throw new Error('JWKS fetch failed');
		e.response.header().set('Cache-Control', 'no-store');
		return e.json(200, v.normalizeOrcidJwks(response.json));
	} catch {
		throw new ApiError(502, 'ORCID signing keys are temporarily unavailable');
	}
}

function refresh(e) {
	const user = actor(e);
	if (!checked(() => verifiedAccount(e.app, user)))
		bad('Sign in with ORCID before refreshing your profile');
	const id = checked(() => v.canonicalOrcid(user.getString('orcid'))).slice(18);
	const { publicApi } = v.orcidEndpoints($os.getenv('ORCID_ISSUER') || 'https://orcid.org');
	let person, employments;
	try {
		person = $http.send({
			url: publicApi + '/v3.0/' + id + '/person',
			headers: { Accept: 'application/json' },
			timeout: 10
		});
		employments = $http.send({
			url: publicApi + '/v3.0/' + id + '/employments',
			headers: { Accept: 'application/json' },
			timeout: 10
		});
	} catch {
		throw new ApiError(502, 'ORCID public profile is temporarily unavailable');
	}
	if (
		person.statusCode !== 200 ||
		employments.statusCode !== 200 ||
		!person.json ||
		!employments.json
	)
		throw new ApiError(502, 'ORCID public profile is temporarily unavailable');
	const profile = v.publicProfile(person.json, employments.json);
	e.app.runInTransaction((tx) => {
		const current = tx.findRecordById('users', user.id);
		if (current.getString('orcid') !== user.getString('orcid') || !v.verified(data(current)))
			deny();
		for (const field of profileFields) current.set(field, profile[field]);
		tx.saveWithContext(
			new Context(
				new Context(null, proofContext, true),
				'pure3d.actor',
				require('./activity-service.cjs').actor(e.auth)
			),
			current
		);
	});
	return e.json(200, {
		orcid: user.getString('orcid'),
		orcidVerifiedAt: user.getString('orcidVerifiedAt'),
		...profile
	});
}

module.exports = {
	jwks,
	creditUser,
	admin,
	roles,
	batchRoles,
	oauth,
	createRequest,
	updateRequest,
	deleteRequest,
	createMembership,
	validateRecord,
	deleteUser,
	pending,
	curate,
	refresh
};
