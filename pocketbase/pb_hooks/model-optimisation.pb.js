routerAdd(
	'GET',
	'/api/pure3d/model-optimisation/capability',
	(e) =>
		e.json(200, { protocol: 'viewing-copy-v1', maxModelBytes: 268435456, maxSceneBytes: 5242880 }),
	$apis.requireAuth()
);

// This file loads before orcid.pb.js: preparation wraps the ordinary permission,
// workflow, sandbox, file-validation and audit chain rather than bypassing it.
onRecordUpdateRequest(
	(e) => require(__hooks + '/model-optimisation-service.cjs').prepare(e),
	'editions'
);
