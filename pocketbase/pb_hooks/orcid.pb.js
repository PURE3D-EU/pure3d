/* eslint-disable @typescript-eslint/no-require-imports -- PocketBase Goja supports CommonJS, not ESM. */
// Each Goja handler has an isolated scope; require helpers inside the handler.
onRecordCreateRequest(
	(e) => require(__hooks + '/activity-service.cjs').request(e),
	'users',
	'collections',
	'editions',
	'collectionUsers',
	'editionUsers',
	'reviewAssignments',
	'editionReviews',
	'reviewFeedback',
	'content',
	'documentation'
);
onRecordUpdateRequest(
	(e) => require(__hooks + '/activity-service.cjs').request(e),
	'users',
	'collections',
	'editions',
	'collectionUsers',
	'editionUsers',
	'reviewAssignments',
	'editionReviews',
	'reviewFeedback',
	'content',
	'documentation'
);
onRecordDeleteRequest(
	(e) => require(__hooks + '/activity-service.cjs').request(e),
	'users',
	'collections',
	'editions',
	'collectionUsers',
	'editionUsers',
	'reviewAssignments',
	'editionReviews',
	'reviewFeedback',
	'content',
	'documentation'
);

onRecordCreateRequest(
	() => require(__hooks + '/activity-service.cjs').denyWrite(),
	'auditLog',
	'notifications'
);
onRecordUpdateRequest(() => require(__hooks + '/activity-service.cjs').denyWrite(), 'auditLog');
onRecordDeleteRequest(
	() => require(__hooks + '/activity-service.cjs').denyWrite(),
	'auditLog',
	'notifications'
);
onRecordCreate(
	(e) => require(__hooks + '/activity-service.cjs').createEvent(e),
	'auditLog',
	'notifications'
);
onRecordUpdateRequest(
	(e) => require(__hooks + '/activity-service.cjs').markRead(e),
	'notifications'
);

onRecordCreateRequest(
	(e) => require(__hooks + '/review-service.cjs').request(e, 'create'),
	'reviewAssignments',
	'editionReviews',
	'reviewFeedback'
);
onRecordUpdateRequest(
	(e) => require(__hooks + '/review-service.cjs').request(e, 'update'),
	'reviewAssignments',
	'editionReviews',
	'reviewFeedback'
);
onRecordDeleteRequest(
	(e) => require(__hooks + '/review-service.cjs').request(e, 'delete'),
	'reviewAssignments',
	'editionReviews',
	'reviewFeedback'
);
onRecordValidate(
	(e) => require(__hooks + '/review-service.cjs').validate(e),
	'reviewAssignments',
	'editionReviews',
	'reviewFeedback'
);

routerAdd(
	'GET',
	'/api/pure3d/orcid/config',
	(e) => {
		if (
			!e.auth ||
			(!e.auth.isSuperuser() &&
				(e.auth.collection().name !== 'users' || e.auth.getString('role') !== 'admin'))
		)
			throw new ForbiddenError();
		const { issuer } = require(__hooks + '/orcid-validation.cjs').orcidEndpoints(
			$os.getenv('ORCID_ISSUER') || 'https://orcid.org'
		);
		return e.json(200, {
			backend: 'pure3d-orcid-v1',
			issuer,
			jwksURL: require(__hooks + '/orcid-validation.cjs').orcidJwksURL(
				$os.getenv('ORCID_JWKS_ORIGIN') || undefined
			),
			reviewAccess: 'assignment-scoped-v1',
			activity: 'trusted-events-v1'
		});
	},
	$apis.requireAuth()
);

routerAdd('GET', '/api/pure3d/orcid/jwks', (e) => {
	return require(__hooks + '/orcid-service.cjs').jwks(e);
});

onRecordAuthWithOAuth2Request((e) => {
	return require(__hooks + '/orcid-service.cjs').oauth(e);
}, 'users');

onRecordAuthRequest((e) => {
	// Never expose provider tokens or the raw provider payload in auth meta.
	if (e.authMethod === 'oauth2') e.meta = { isNew: !!(e.meta && e.meta.isNew) };
	return e.next();
}, 'users');

onRecordCreateRequest(
	(e) => {
		return require(__hooks + '/orcid-service.cjs').createRequest(e);
	},
	'users',
	'collections',
	'editions',
	'collectionUsers',
	'editionUsers'
);

routerAdd(
	'GET',
	'/api/pure3d/voyager/save-capability',
	(e) => e.json(200, { protocol: 'scene-and-assets-v1' }),
	$apis.requireAuth('users')
);

onRecordUpdateRequest((e) => {
	if (e.requestInfo().body.voyagerSave === undefined) return e.next();
	return require(__hooks + '/voyager-save-service.cjs').prepare(e);
}, 'editions');

onRecordUpdateRequest(
	(e) => {
		return require(__hooks + '/orcid-service.cjs').updateRequest(e);
	},
	'users',
	'collections',
	'editions',
	'collectionUsers',
	'editionUsers'
);

onRecordsListRequest((e) => {
	const info = e.requestInfo();
	require(__hooks + '/orcid-service.cjs').batchRoles({ app: e.app, auth: info.auth }, e.records);
	return e.next();
}, 'editions');

onRecordEnrich((e) => {
	const access = require(__hooks + '/orcid-service.cjs').roles(
		{ app: e.app, auth: e.requestInfo.auth },
		e.record
	);
	if (!Object.values(access).some(Boolean))
		e.record.hide(
			...require(__hooks + '/proposal-service.cjs').proposalFields,
			...require(__hooks + '/alpha-review-service.cjs').editionFields,
			...require(__hooks + '/publication-service.cjs').fields
		);
	return e.next();
}, 'editions');

onFileDownloadRequest((e) => {
	if (!e.record.getBool('isVisible')) {
		const info = e.requestInfo();
		if (!info.auth && info.query.token) {
			try {
				info.auth = e.app.findAuthRecordByToken(info.query.token, 'file');
			} catch {
				throw new ForbiddenError('A valid private-file token is required.');
			}
		}
		if (!e.app.canAccessRecord(e.record, info, e.record.collection().viewRule))
			throw new ForbiddenError('You do not have access to this private collection file.');
	}
	return e.next();
}, 'collections');

onFileDownloadRequest((e) => {
	if (
		e.fileField &&
		(e.fileField.name.startsWith('proposal') || !e.record.getBool('isPublished'))
	) {
		let auth = e.auth;
		if (!auth) {
			try {
				auth = e.app.findAuthRecordByToken(e.requestInfo().query.token, 'file');
			} catch {
				throw new ForbiddenError('A valid private-file token is required.');
			}
		}
		const access = require(__hooks + '/orcid-service.cjs').roles({ app: e.app, auth }, e.record);
		const info = e.requestInfo();
		info.auth = auth;
		if (
			!Object.values(access).some(Boolean) ||
			!e.app.canAccessRecord(e.record, info, e.record.collection().viewRule)
		)
			throw new ForbiddenError('You do not have access to this private edition file.');
	}
	return e.next();
}, 'editions');

onRecordDeleteRequest(
	(e) => {
		return require(__hooks + '/orcid-service.cjs').deleteRequest(e);
	},
	'users',
	'collections',
	'editions',
	'collectionUsers',
	'editionUsers'
);

onRecordCreate(
	(e) => {
		return require(__hooks + '/orcid-service.cjs').createMembership(e);
	},
	'collections',
	'editions'
);

onRecordCreate(
	(e) => require(__hooks + '/activity-service.cjs').model(e),
	'users',
	'collections',
	'editions',
	'collectionUsers',
	'editionUsers',
	'reviewAssignments',
	'editionReviews',
	'reviewFeedback',
	'content',
	'documentation'
);
onRecordUpdate(
	(e) => require(__hooks + '/activity-service.cjs').model(e),
	'users',
	'collections',
	'editions',
	'collectionUsers',
	'editionUsers',
	'reviewAssignments',
	'editionReviews',
	'reviewFeedback',
	'content',
	'documentation'
);

onRecordUpdate((e) => {
	// A save started in another tab must not overwrite a just-submitted proposal.
	const app = e.app;
	try {
		return app.runInTransaction((tx) => {
			e.app = tx;
			const current = tx.findRecordById('editions', e.record.id);
			if (current.getString('status') !== e.record.original().getString('status'))
				throw new BadRequestError('The workflow changed. Reload before saving again.');
			return e.next();
		});
	} finally {
		e.app = app;
	}
}, 'editions');

onRecordCreate(
	(e) => require(__hooks + '/alpha-review-service.cjs').savedReview(e),
	'editionReviews'
);
onRecordUpdate(
	(e) => require(__hooks + '/alpha-review-service.cjs').savedReview(e),
	'editionReviews'
);
onRecordCreate(
	(e) => require(__hooks + '/proposal-review-service.cjs').savedReview(e),
	'editionReviews'
);
onRecordUpdate(
	(e) => require(__hooks + '/proposal-review-service.cjs').savedReview(e),
	'editionReviews'
);
onRecordCreate(
	(e) => require(__hooks + '/proposal-review-service.cjs').changedAssignment(e),
	'reviewAssignments'
);
onRecordUpdate(
	(e) => require(__hooks + '/proposal-review-service.cjs').changedAssignment(e),
	'reviewAssignments'
);
onRecordDelete(
	(e) => require(__hooks + '/proposal-review-service.cjs').changedAssignment(e),
	'reviewAssignments'
);
onRecordUpdate(
	(e) => require(__hooks + '/proposal-review-service.cjs').changedEdition(e),
	'editions'
);
routerAdd(
	'POST',
	'/api/pure3d/editions/{editionId}/initialize-draft-assets',
	(e) => require(__hooks + '/proposal-review-service.cjs').initialize(e),
	$apis.requireAuth()
);
routerAdd(
	'POST',
	'/api/pure3d/sandboxes',
	(e) => require(__hooks + '/sandbox-service.cjs').create(e),
	$apis.requireAuth('users')
);
routerAdd(
	'POST',
	'/api/pure3d/sandboxes/{sandboxId}/transfer',
	(e) => require(__hooks + '/sandbox-service.cjs').transfer(e),
	$apis.requireAuth('users')
);

routerAdd(
	'GET',
	'/api/pure3d/editions/{editionId}/alpha-progress',
	(e) => require(__hooks + '/alpha-review-service.cjs').progress(e),
	$apis.requireAuth()
);
routerAdd(
	'POST',
	'/api/pure3d/editions/{editionId}/alpha-decision',
	(e) => require(__hooks + '/alpha-review-service.cjs').decide(e),
	$apis.requireAuth()
);

onRecordsListRequest((e) => require(__hooks + '/alpha-review-service.cjs').protectQuery(e));
onRecordViewRequest((e) => require(__hooks + '/alpha-review-service.cjs').protectQuery(e));

routerAdd(
	'GET',
	'/api/pure3d/editions/{editionId}/final-progress',
	(e) => require(__hooks + '/publication-service.cjs').progress(e),
	$apis.requireAuth()
);
routerAdd('GET', '/api/pure3d/editions/{editionId}/public-reviews', (e) =>
	require(__hooks + '/publication-service.cjs').progress(e, true)
);
routerAdd(
	'POST',
	'/api/pure3d/editions/{editionId}/final-decision',
	(e) => require(__hooks + '/publication-service.cjs').decision(e),
	$apis.requireAuth()
);
routerAdd(
	'POST',
	'/api/pure3d/editions/{editionId}/final-invitations',
	(e) => require(__hooks + '/publication-service.cjs').reinvite(e),
	$apis.requireAuth()
);
routerAdd(
	'POST',
	'/api/pure3d/editions/{editionId}/admin-workflow-override',
	(e) => require(__hooks + '/admin-workflow-service.cjs').override(e),
	$apis.requireAuth()
);
routerAdd(
	'POST',
	'/api/pure3d/editions/{editionId}/unpublish',
	(e) => require(__hooks + '/admin-workflow-service.cjs').unpublish(e),
	$apis.requireAuth()
);
onRecordDelete(
	(e) => require(__hooks + '/activity-service.cjs').model(e),
	'users',
	'collections',
	'editions',
	'collectionUsers',
	'editionUsers',
	'reviewAssignments',
	'editionReviews',
	'reviewFeedback',
	'content',
	'documentation'
);

onRecordValidate(
	(e) => {
		return require(__hooks + '/orcid-service.cjs').validateRecord(e);
	},
	'users',
	'collections',
	'editions',
	'collectionUsers',
	'editionUsers'
);

onRecordDelete((e) => {
	return require(__hooks + '/orcid-service.cjs').deleteUser(e);
}, 'users');

onRecordDeleteRequest((e) => {
	if (e.record.getString('collectionRef') === e.app.findCollectionByNameOrId('users').id)
		throw new ForbiddenError('ORCID is the account identity and cannot be unlinked');
	return e.next();
}, '_externalAuths');

routerAdd(
	'POST',
	'/api/pure3d/orcid/profile-refresh',
	(e) => {
		return require(__hooks + '/orcid-service.cjs').refresh(e);
	},
	$apis.requireAuth('users')
);

routerAdd(
	'GET',
	'/api/pure3d/orcid/pending/{userId}',
	(e) => {
		return require(__hooks + '/orcid-service.cjs').pending(e, false);
	},
	$apis.requireAuth()
);

routerAdd(
	'POST',
	'/api/pure3d/orcid/pending/{userId}',
	(e) => {
		return require(__hooks + '/orcid-service.cjs').pending(e, true);
	},
	$apis.requireAuth()
);

routerAdd(
	'POST',
	'/api/pure3d/orcid/curated/{userId}',
	(e) => require(__hooks + '/orcid-service.cjs').curate(e),
	$apis.requireAuth()
);

routerAdd('GET', '/api/pure3d/orcid/ready', (e) => {
	e.response.header().set('Cache-Control', 'no-store');
	try {
		return require(__hooks + '/orcid-readiness.cjs').ready(e);
	} catch {
		return e.json(503, {
			ready: false,
			checks: { hooks: false, auth: false, schema: false, credits: false }
		});
	}
});

routerAdd(
	'GET',
	'/api/pure3d/orcid/credits-audit',
	(e) => {
		e.response.header().set('Cache-Control', 'no-store');
		try {
			return require(__hooks + '/orcid-readiness.cjs').creditsAudit(e);
		} catch {
			return e.json(503, {
				ready: false,
				checks: { hooks: false, auth: false, schema: false, credits: false }
			});
		}
	},
	$apis.requireSuperuserAuth()
);

onBootstrap((e) => {
	e.next();
	e.app.store().set('pure3d.orcid.hooks', 'trusted-events-v1');
});
