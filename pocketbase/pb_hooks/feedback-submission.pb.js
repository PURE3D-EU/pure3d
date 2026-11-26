/* eslint-disable @typescript-eslint/no-require-imports -- PocketBase hooks use Goja's CommonJS loader. */
routerAdd(
	'POST',
	'/api/pure3d/feedback',
	(event) => {
		const raw = event.requestInfo().body.feedback;
		if (typeof raw !== 'string' || raw.length > 65536)
			throw new BadRequestError('Invalid feedback submission.');

		let input;
		try {
			input = JSON.parse(raw);
		} catch {
			throw new BadRequestError('Invalid feedback submission.');
		}
		if (!input || typeof input !== 'object' || Array.isArray(input))
			throw new BadRequestError('Invalid feedback submission.');

		const values = {};
		const limits = {
			participantName: 120,
			participantEmail: 254,
			editionUrl: 2048,
			category: 32,
			severity: 32,
			note: 10000,
			pageUrl: 2048
		};
		for (const key in limits) {
			if (typeof input[key] !== 'string' || input[key].length > limits[key])
				throw new BadRequestError(
					key === 'note' ? 'Keep your note under 10,000 characters.' : 'Check the feedback fields.'
				);
			values[key] = input[key].trim();
		}
		if (values.participantEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.participantEmail))
			throw new BadRequestError('Enter a valid email address or leave it blank.');

		const count = input.imageCount;
		if (!Number.isInteger(count) || count < 0 || count > 20)
			throw new BadRequestError('Attach up to 20 screenshots.');
		if (!values.note && !count) throw new BadRequestError('Add a short note or a screenshot.');

		// Limit writes before touching storage. One bounded window covers guests and members.
		const store = event.app.store();
		const key = store.getOrSet('pure3d.feedback.secret', () => $security.randomString(64));
		const client = $security.hs256(event.realIP(), String(key));
		const now = Date.now();
		let admitted = false;
		store.setFunc('pure3d.feedback.limits', (old) => {
			const window = (old ? JSON.parse(String(old)) : []).filter(
				(entry) => entry.time > now - 60000
			);
			if (window.length < 30 && window.filter((entry) => entry.client === client).length < 3) {
				window.push({ time: now, client });
				admitted = true;
			}
			return JSON.stringify(window);
		});
		if (!admitted)
			throw new TooManyRequestsError('Please wait a minute before sending feedback again.');

		const images = count ? event.findUploadedFiles('images') : [];
		if (
			images.length !== count ||
			images.reduce((total, image) => total + image.size, 0) > 20 * 1024 * 1024
		) {
			throw new BadRequestError('Attach up to 20 screenshots with a combined size of 20 MB.');
		}
		const collection = event.app.findCollectionByNameOrId('feedback');
		const record = new Record(collection, {
			participantName: values.participantName,
			participantEmail: values.participantEmail,
			editionUrl: values.editionUrl,
			category: values.category,
			severity: values.severity,
			feedbackHtml: values.note.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
			pageUrl: values.pageUrl,
			status: 'submitted',
			createdBy: event.auth?.collection().name === 'users' ? event.auth.id : ''
		});
		const browserInfo = {};
		for (const [field, max] of [
			['userAgent', 512],
			['language', 64],
			['viewport', 32]
		]) {
			const value = input.browserInfo?.[field];
			if (typeof value === 'string') browserInfo[field] = value.slice(0, max);
		}
		record.set('browserInfo', browserInfo);
		if (images.length) record.set('images', images);
		if (collection.fields.getByName('emailQueuedAt')) {
			const service = require(__hooks + '/feedback-email-service.cjs');
			const queue = service.queueState(
				'',
				'submitted',
				new Date().toISOString(),
				{},
				$os.getenv('PURE3D_FEEDBACK_EMAIL_ENABLED') === 'true'
			);
			for (const field in queue) record.set(field, queue[field]);
		}
		try {
			event.app.save(record);
		} catch (error) {
			throw new BadRequestError(
				'Could not save feedback. Check the fields and screenshot format, then try again.',
				error
			);
		}
		return event.json(201, { success: true });
	},
	$apis.bodyLimit(21 * 1024 * 1024)
);

onFileDownloadRequest((event) => {
	const info = event.requestInfo().clone();
	try {
		info.auth = event.app.findAuthRecordByToken(info.query.token || '', 'file');
	} catch {
		throw new ForbiddenError('A valid private-file token is required.');
	}
	if (
		!info.auth ||
		!event.app.canAccessRecord(event.record, info, event.record.collection().viewRule)
	)
		throw new ForbiddenError('You do not have access to this feedback screenshot.');
	event.response.header().set('Cache-Control', 'private, no-store');
	return event.next();
}, 'feedback');
