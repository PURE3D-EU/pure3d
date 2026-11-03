/* eslint-disable @typescript-eslint/no-require-imports -- PocketBase hooks use Goja's CommonJS loader. */
routerAdd(
	'GET',
	'/api/pure3d/storage',
	(event) => {
		if (!event.auth || event.auth.getString('role') !== 'admin') {
			throw new ForbiddenError('Administrator access required.');
		}
		let filesystem;
		try {
			const service = require(__hooks + '/storage-dashboard-service.cjs');
			const prefix = event.request.url.query().get('prefix') || '';
			const cursor = event.request.url.query().get('cursor') || '';
			if (!service.validPrefix(prefix) || (cursor && !cursor.startsWith(prefix))) {
				throw new BadRequestError('Invalid storage prefix or cursor.');
			}
			const limit = service.pageSize(event.request.url.query().get('limit'));
			filesystem = event.app.newFilesystem();
			const page = service.pageObjects(filesystem.list(prefix), cursor, limit);
			page.objects = page.objects.map((object) => ({
				key: object.key,
				size: object.size,
				modified: object.modTime.format('2006-01-02T15:04:05.000Z07:00')
			}));
			return event.json(200, {
				bucket: event.app.settings().s3.bucket || 'local storage',
				...page,
				prefix,
				scanBounded: false,
				limitation:
					'PocketBase filesystem.list(prefix) returns every matching key; the response is paged, but the backing prefix scan is not memory-bounded.'
			});
		} finally {
			filesystem?.close();
		}
	},
	$apis.requireAuth('users')
);

routerAdd(
	'GET',
	'/api/pure3d/storage/download',
	(event) => {
		if (!event.auth || event.auth.getString('role') !== 'admin') {
			throw new ForbiddenError('Administrator access required.');
		}
		const key = event.request.url.query().get('key');
		if (!key || key.startsWith('/') || key.split('/').includes('..')) {
			throw new BadRequestError('Invalid object key.');
		}
		let filesystem;
		try {
			filesystem = event.app.newFilesystem();
			filesystem.serve(event.response, event.request, key, key.split('/').pop());
		} finally {
			filesystem?.close();
		}
	},
	$apis.requireAuth('users')
);

routerAdd(
	'DELETE',
	'/api/pure3d/storage',
	(event) => {
		if (!event.auth || event.auth.getString('role') !== 'admin') {
			throw new ForbiddenError('Administrator access required.');
		}
		const key = event.request.url.query().get('key');
		if (!key || key.startsWith('/') || key.split('/').includes('..')) {
			throw new BadRequestError('Invalid object key.');
		}
		// PocketBase's filesystem abstraction exposes only unconditional key deletion.
		// Checking attributes first cannot prevent deletion of a concurrent replacement.
		throw new ApiError(501, 'Safe conditional deletion is unavailable. No object was deleted.');
	},
	$apis.requireAuth('users')
);
