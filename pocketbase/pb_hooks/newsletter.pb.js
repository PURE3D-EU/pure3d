/* eslint-disable @typescript-eslint/no-require-imports -- PocketBase uses Goja's CommonJS loader. */
routerAdd(
	'POST',
	'/api/pure3d/newsletter/subscribe',
	(e) => require(__hooks + '/newsletter-service.cjs').subscribe(e),
	$apis.bodyLimit(2048)
);
routerAdd(
	'POST',
	'/api/pure3d/newsletter/confirm',
	(e) => require(__hooks + '/newsletter-service.cjs').preference(e, 'confirm'),
	$apis.bodyLimit(2048)
);
routerAdd(
	'POST',
	'/api/pure3d/newsletter/unsubscribe',
	(e) => require(__hooks + '/newsletter-service.cjs').preference(e, 'unsubscribe'),
	$apis.bodyLimit(2048)
);
routerAdd(
	'POST',
	'/api/pure3d/newsletter/drafts',
	(e) => require(__hooks + '/newsletter-service.cjs').saveDraft(e),
	$apis.requireAuth('users'),
	$apis.bodyLimit(100000)
);
routerAdd(
	'POST',
	'/api/pure3d/newsletter/campaigns/{id}/test',
	(e) => require(__hooks + '/newsletter-service.cjs').testEmail(e),
	$apis.requireAuth('users')
);
routerAdd(
	'POST',
	'/api/pure3d/newsletter/campaigns/{id}/send',
	(e) => require(__hooks + '/newsletter-service.cjs').sendBatch(e),
	$apis.requireAuth('users'),
	$apis.bodyLimit(2048)
);
routerAdd(
	'GET',
	'/api/pure3d/newsletter/campaigns/{id}/progress',
	(e) => {
		const service = require(__hooks + '/newsletter-service.cjs');
		service.admin(e);
		return e.json(200, service.progress(e.app, e.request.pathValue('id')));
	},
	$apis.requireAuth('users')
);
routerAdd(
	'POST',
	'/api/pure3d/newsletter/subscribers',
	(e) => require(__hooks + '/newsletter-service.cjs').addSubscriber(e),
	$apis.requireAuth('users'),
	$apis.bodyLimit(8192)
);
routerAdd(
	'POST',
	'/api/pure3d/newsletter/subscribers/{id}/unsubscribe',
	(e) => require(__hooks + '/newsletter-service.cjs').stopSubscriber(e),
	$apis.requireAuth('users')
);
