/* eslint-disable @typescript-eslint/no-require-imports -- This fixture runs inside PocketBase Goja. */
// Test-only fixture, copied into a disposable --hooksDir. Never deploy this file.
// Loaded before production hooks. Native token exchange/signature verification has already completed.
// Replace only the external SMTP boundary for contact feature requests in this disposable fixture.
onMailerSend((e) => {
	if (e.message.subject.startsWith('PURE3D contact: ')) return;
	return e.next();
});

onRecordAuthWithOAuth2Request((e) => {
	const config = e.app.store().get('test.native.oauth');
	if (config && config.tokenURL && e.providerClient.tokenURL() === config.tokenURL) {
		e.providerClient.setTokenURL(
			($os.getenv('ORCID_ISSUER') || 'https://orcid.org') + '/oauth/token'
		);
		e.providerClient.setExtra({
			jwksURL: require(__hooks + '/orcid-validation.cjs').orcidJwksURL(),
			issuers: [$os.getenv('ORCID_ISSUER') || 'https://orcid.org']
		});
	}
	return e.next();
}, 'users');

routerAdd(
	'POST',
	'/_test/native-oauth',
	(e) => {
		e.app.store().set('test.native.oauth', e.requestInfo().body);
		e.app.store().set('test.native.saves', 0);
		e.app.store().set('test.native.responses', 0);
		return e.noContent(204);
	},
	$apis.requireSuperuserAuth()
);
routerAdd(
	'GET',
	'/_test/native-oauth',
	(e) =>
		e.json(200, {
			saves: e.app.store().get('test.native.saves'),
			responses: e.app.store().get('test.native.responses')
		}),
	$apis.requireSuperuserAuth()
);

onRecordUpdate((e) => {
	const config = e.app.store().get('test.native.oauth');
	if (
		config &&
		config.tokenURL &&
		!e.context.value('pure3d.orcid.proof') &&
		e.record.getString('orcidVerifiedAt')
	)
		e.app.store().set('test.native.saves', e.app.store().get('test.native.saves') + 1);
	return e.next();
}, 'users');

onRecordAuthRequest((e) => {
	const config = e.app.store().get('test.native.oauth');
	if (e.authMethod === 'oauth2' && config && config.tokenURL) {
		const links = e.app.findRecordsByFilter('_externalAuths', 'recordRef = {:id}', '', 0, 0, {
			id: e.record.id
		});
		if (links.length !== 1) throw new Error('Native external link was not saved');
		e.app.store().set('test.native.responses', e.app.store().get('test.native.responses') + 1);
		if (config.fail) throw new BadRequestError('Test native OAuth downstream rollback');
	}
	return e.next();
}, 'users');

onBootstrap((e) => {
	e.next();
	if ($os.getenv('PB_TEST_BOOTSTRAP_ONLY') === '1') {
		const root = new Record(e.app.findCollectionByNameOrId('_superusers'), {
			email: 'root@example.test'
		});
		root.setPassword('local-test-password-only');
		e.app.save(root);
		return;
	}
	const schema = JSON.parse(toString($os.readFile(__hooks + '/schema.json')));
	for (const definition of schema) {
		let collection;
		try {
			collection = e.app.findCollectionByNameOrId(definition.name);
		} catch {
			collection = new Collection({ name: definition.name, type: definition.type });
		}
		for (const field of definition.fields.filter((field) => field.type !== 'relation'))
			collection.fields.add(new Field(field));
		for (const key of ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule'])
			collection[key] = '';
		e.app.save(collection);
	}
	for (const definition of schema) {
		const collection = e.app.findCollectionByNameOrId(definition.name);
		for (const field of definition.fields.filter((field) => field.type === 'relation')) {
			if (!schema.some((item) => item.name === field.collectionId)) continue;
			field.collectionId = e.app.findCollectionByNameOrId(field.collectionId).id;
			collection.fields.add(new RelationField(field));
		}
		e.app.save(collection);
	}
	const users = e.app.findCollectionByNameOrId('users');
	for (const fixture of [
		{ id: 'admin0000000000', role: 'admin', email: 'admin@example.test' },
		{
			id: 'author000000000',
			role: 'user',
			email: 'author@example.test',
			orcid: 'https://orcid.org/0000-0002-1825-0097',
			orcidVerifiedAt: new Date().toISOString()
		},
		{ id: 'other0000000000', role: 'user', email: 'other@example.test' },
		{ id: 'pending00000000', role: 'user', email: 'pending@example.test' }
	]) {
		const record = new Record(users, fixture);
		record.setPassword('local-test-password-only');
		e.app.saveWithContext(new Context(null, 'pure3d.orcid.proof', true), record);
		if (fixture.orcid) {
			const link = new Record(e.app.findCollectionByNameOrId('_externalAuths'), {
				collectionRef: users.id,
				recordRef: record.id,
				provider: 'oidc',
				providerId: fixture.orcid.slice(18)
			});
			e.app.save(link);
		}
	}
	const root = new Record(e.app.findCollectionByNameOrId('_superusers'), {
		email: 'root@example.test'
	});
	root.setPassword('local-test-password-only');
	e.app.save(root);
	const legacy = new Record(e.app.findCollectionByNameOrId('editions'), {
		id: 'legacy000000000',
		title: 'Legacy published',
		status: 'draft',
		credits: [
			{ type: 'person', name: 'Legacy creator', orcid: null, role: 'creator', provenance: 'manual' }
		]
	});
	e.app.save(legacy);
	e.app
		.db()
		.newQuery(
			"UPDATE editions SET status = 'published', isPublished = true, dcCreator = '[\"Legacy creator\"]' WHERE id = {:id}"
		)
		.bind({ id: legacy.id })
		.execute();
});

routerAdd(
	'POST',
	'/_test/null-credits/{id}',
	(e) => {
		// Emulate a persisted pre-migration row; normal record validation intentionally normalizes new drafts.
		const record = e.app.findRecordById('editions', e.request.pathValue('id'));
		e.app
			.db()
			.newQuery('UPDATE editions SET credits = NULL WHERE id = {:id}')
			.bind({ id: record.id })
			.execute();
		return e.noContent(204);
	},
	$apis.requireSuperuserAuth()
);

routerAdd(
	'POST',
	'/_test/jwks',
	(e) => {
		e.app.store().set('test.orcid.jwks', JSON.stringify(e.requestInfo().body));
		return e.noContent(204);
	},
	$apis.requireSuperuserAuth()
);

routerAdd('GET', '/_test/jwks', (e) => {
	const send = $http.send;
	try {
		// Stub only ORCID transport; run the deployed bridge handler and native PB verifier.
		$http.send = (request) => {
			if (request.url !== ($os.getenv('ORCID_ISSUER') || 'https://orcid.org') + '/oauth/jwks')
				throw new Error('Unexpected JWKS source');
			return { statusCode: 200, json: JSON.parse(e.app.store().get('test.orcid.jwks')) };
		};
		return require(__hooks + '/orcid-service.cjs').jwks(e);
	} finally {
		$http.send = send;
	}
});

// This simulates only the event AFTER upstream token verification, never the verifier itself.
routerAdd('POST', '/_test/oauth', (e) => {
	const body = e.requestInfo().body;
	const issuer = $os.getenv('ORCID_ISSUER') || 'https://orcid.org';
	const subject = body.subject || '0000-0002-1694-233X';
	const event = {
		app: e.app,
		auth: e.auth,
		collection: e.app.findCollectionByNameOrId('users'),
		providerName: body.provider || 'oidc',
		providerClient: {
			userInfoURL: () => body.userInfoURL || '',
			tokenURL: () => issuer + '/oauth/token',
			clientId: () => 'test-client',
			extra: () => ({
				jwksURL:
					body.jwksURL ||
					require(__hooks + '/orcid-validation.cjs').orcidJwksURL(
						$os.getenv('ORCID_JWKS_ORIGIN') || undefined
					),
				issuers: [issuer]
			})
		},
		record: body.preselected ? e.app.findRecordById('users', body.preselected) : null,
		createData: body.createData || {},
		oAuth2User: {
			id: subject,
			email: body.email || '',
			rawUser: {
				sub: subject,
				iss: issuer,
				aud: 'test-client',
				exp: Math.floor(Date.now() / 1000) + 3600,
				iat: Math.floor(Date.now() / 1000),
				...(body.claims || {})
			}
		},
		next: () => {
			e.app = event.app;
			if (body.failAfterProof) throw new BadRequestError('Test OAuth rollback');
			const links = e.app.findRecordsByFilter(
				'_externalAuths',
				'collectionRef = {:collection} && provider = "oidc" && providerId = {:subject}',
				'',
				0,
				0,
				{ collection: event.collection.id, subject }
			);
			if (!links.length)
				e.app.save(
					new Record(e.app.findCollectionByNameOrId('_externalAuths'), {
						collectionRef: event.collection.id,
						recordRef: event.record.id,
						provider: 'oidc',
						providerId: subject
					})
				);
			return $apis.recordAuthResponse(e, event.record, 'oauth2', {
				isNew: event.isNewRecord,
				accessToken: 'must-not-leak'
			});
		}
	};
	return require(__hooks + '/orcid-service.cjs').oauth(event);
});

onRecordCreate((e) => {
	const edition = e.app.findRecordById('editions', e.record.getString('editionId'));
	if (edition.getString('title') === 'force-membership-failure')
		throw new BadRequestError('Test rollback');
	return e.next();
}, 'editionUsers');

onRecordCreate((e) => {
	if (
		e.record.getString('action') === 'status_transition' &&
		e.app.findRecordById('editions', e.record.getString('targetId')).getString('title') ===
			'force-audit-failure'
	)
		throw new BadRequestError('Test audit rollback');
	if (
		e.record.getString('action') === 'orcid_mapping_approved' &&
		e.app.findRecordById('users', e.record.getString('targetId')).getString('nickname') ===
			'force-orcid-audit-failure'
	)
		throw new BadRequestError('Test pending mapping audit rollback');
	return e.next();
}, 'auditLog');

onRecordCreate((e) => {
	if (
		e.record.getString('type') === 'concept_submitted' &&
		e.app.findRecordById('editions', e.record.getString('editionId')).getString('title') ===
			'force-notification-failure'
	)
		throw new BadRequestError('Test notification rollback');
	return e.next();
}, 'notifications');

routerAdd(
	'POST',
	'/_test/profile',
	(e) => {
		const send = $http.send;
		const body = e.requestInfo().body;
		const { publicApi } = require(__hooks + '/orcid-validation.cjs').orcidEndpoints(
			$os.getenv('ORCID_ISSUER') || 'https://orcid.org'
		);
		$http.send = (request) => {
			if (
				![
					publicApi + '/v3.0/0000-0002-1825-0097/person',
					publicApi + '/v3.0/0000-0002-1825-0097/employments'
				].includes(request.url) ||
				request.timeout !== 10 ||
				request.headers.Authorization
			)
				throw new Error('Unsafe public profile request');
			if (body.fail)
				return {
					statusCode: 503,
					json: { accessToken: 'must-not-leak', email: 'must-not-leak@example.test' }
				};
			return {
				statusCode: 200,
				json: request.url.endsWith('/person')
					? {
							name: { 'credit-name': { value: 'ORCID Name' } },
							biography: { content: 'Public biography' },
							emails: { email: 'must-not-leak@example.test' },
							role: 'admin',
							accessToken: 'must-not-leak'
						}
					: {}
			};
		};
		try {
			return require(__hooks + '/orcid-service.cjs').refresh(e);
		} finally {
			$http.send = send;
		}
	},
	$apis.requireAuth('users')
);
