/* eslint-disable no-control-regex -- Reject control characters in email addresses and SMTP subjects. */
// Only route handlers may write newsletter records; collection write rules are locked.
const subscribers = 'newsletter_subscribers';
const campaigns = 'newsletter_campaigns';
const deliveries = 'newsletter_deliveries';

function find(app, collection, filter, params) {
	const rows = app.findRecordsByFilter(collection, filter, '', 1, 0, params);
	return rows.length ? rows[0] : null;
}
function admin(event) {
	if (
		!event.auth ||
		event.auth.collection().name !== 'users' ||
		event.auth.getString('role') !== 'admin'
	)
		throw new ForbiddenError('Administrator access required.');
}
function mailSettings(app) {
	const settings = app.settings();
	if (!settings.smtp.enabled) throw new ApiError(503, 'Newsletter email is currently unavailable.');
	const url = String(settings.meta.appURL).replace(/\/+$/, '');
	if (
		!/^https:\/\/[^\s?#]+$/.test(url) &&
		!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[^\s?#]*)?$/.test(url)
	)
		throw new ApiError(503, 'Configure the public application URL before sending newsletters.');
	return { settings, url };
}
function send(app, address, subject, text) {
	const { settings } = mailSettings(app);
	app.newMailClient().send(
		new MailerMessage({
			from: { address: settings.meta.senderAddress, name: settings.meta.senderName },
			to: [{ address }],
			subject,
			text
		})
	);
}
function limit(event) {
	const store = event.app.store();
	const secret = store.getOrSet('pure3d.newsletter.secret', () => $security.randomString(64));
	const client = $security.hs256(event.realIP(), String(secret));
	const now = Date.now();
	let admitted = false;
	store.setFunc('pure3d.newsletter.limits', (old) => {
		const state = old ? JSON.parse(String(old)) : { clients: {}, requests: [] };
		for (const key of Object.keys(state.clients))
			if (state.clients[key] <= now) delete state.clients[key];
		state.requests = state.requests.filter((time) => time > now - 60000);
		if (!state.clients[client] && state.requests.length < 10) {
			state.clients[client] = now + 60000;
			state.requests.push(now);
			admitted = true;
		}
		return JSON.stringify(state);
	});
	if (!admitted) throw new TooManyRequestsError('Please wait a minute before trying again.');
}
function subscribe(event) {
	const body = event.requestInfo().body;
	if (body.website) return event.json(200, { success: true });
	const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
	if (
		email.length > 254 ||
		!/^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$/.test(email)
	)
		throw new BadRequestError('Please enter a valid email address.');
	limit(event);
	const { url } = mailSettings(event.app);
	let token = '';
	event.app.runInTransaction((app) => {
		let record = find(app, subscribers, 'email = {:email}', { email });
		if (
			record &&
			(record.getString('status') === 'subscribed' ||
				Date.parse(record.getString('requestedAt')) > Date.now() - 15 * 60000)
		)
			return;
		if (!record) record = new Record(app.findCollectionByNameOrId(subscribers));
		token = $security.randomString(64);
		record.set('email', email);
		record.set('status', 'pending');
		record.set('confirmationHash', $security.sha256(token));
		// Preserve old unsubscribe links across a renewed request.
		if (!record.getString('unsubscribeToken'))
			record.set('unsubscribeToken', $security.randomString(64));
		record.set('confirmationExpires', new Date(Date.now() + 86400000).toISOString());
		record.set('requestedAt', new Date().toISOString());
		app.save(record);
	});
	if (token) {
		try {
			send(
				event.app,
				email,
				'Confirm your PURE3D newsletter subscription',
				'Confirm your email address to receive PURE3D news, editions and open calls:\n\n' +
					url +
					'/newsletter#confirm=' +
					token +
					'\n\nThis link expires in 24 hours. If you did not request this, ignore this email. You will not be subscribed.'
			);
		} catch {
			// Keep the pending record and cooldown: transport errors may still have delivered mail.
			throw new ApiError(
				503,
				'We could not send the confirmation. Please try again in 15 minutes.'
			);
		}
	}
	return event.json(200, { success: true });
}
function preference(event, action) {
	const token = event.requestInfo().body.token;
	if (typeof token !== 'string' || !/^[a-zA-Z0-9]{64}$/.test(token))
		throw new BadRequestError('This newsletter link is invalid.');
	event.app.runInTransaction((app) => {
		const confirm = action === 'confirm';
		const record = find(
			app,
			subscribers,
			confirm ? 'confirmationHash = {:token}' : 'unsubscribeToken = {:token}',
			{ token: confirm ? $security.sha256(token) : token }
		);
		if (!record) throw new BadRequestError('This newsletter link is invalid or has expired.');
		if (confirm && record.getString('status') !== 'subscribed') {
			if (
				record.getString('status') !== 'pending' ||
				Date.parse(record.getString('confirmationExpires')) < Date.now()
			)
				throw new BadRequestError('This confirmation link has expired. Please subscribe again.');
			record.set('status', 'subscribed');
			record.set('confirmedAt', new Date().toISOString());
			record.set('consentSource', 'email_confirmation');
			record.set('consentNote', '');
			record.set('consentRecordedBy', '');
			record.set('consentRecordedAt', new Date().toISOString());
			record.set('unsubscribedAt', '');
		} else if (!confirm) {
			record.set('status', 'unsubscribed');
			record.set('confirmationHash', '');
			record.set('unsubscribedAt', new Date().toISOString());
		}
		app.save(record);
	});
	return event.json(200, { success: true });
}
function saveDraft(event) {
	admin(event);
	const body = event.requestInfo().body;
	const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
	const text = typeof body.body === 'string' ? body.body.trim() : '';
	if (
		!subject ||
		subject.length > 200 ||
		/[\x00-\x1f\x7f]/.test(subject) ||
		!text ||
		text.length > 20000
	)
		throw new BadRequestError('Enter a subject and message within the length limits.');
	let id;
	event.app.runInTransaction((app) => {
		const record = body.id
			? app.findRecordById(campaigns, String(body.id))
			: new Record(app.findCollectionByNameOrId(campaigns));
		if (
			body.id &&
			(record.getString('status') !== 'draft' || record.getString('updated') !== body.version)
		)
			throw new BadRequestError('This newsletter has changed. Reload it before editing.');
		record.set('subject', subject);
		record.set('body', text);
		record.set('status', 'draft');
		app.save(record);
		id = record.id;
	});
	return event.json(200, event.app.findRecordById(campaigns, id));
}
function testEmail(event) {
	admin(event);
	const record = event.app.findRecordById(campaigns, event.request.pathValue('id'));
	try {
		send(
			event.app,
			event.auth.getString('email'),
			'[Test] ' + record.getString('subject'),
			record.getString('body') +
				'\n\nTest newsletter. Subscriber emails include an unsubscribe link.'
		);
	} catch {
		throw new ApiError(503, 'The test email could not be sent. Check PocketBase mail settings.');
	}
	return event.json(200, { success: true });
}
function progress(app, id) {
	const counts = { pending: 0, sending: 0, sent: 0, failed: 0, skipped: 0 };
	const rows = app.findRecordsByFilter(deliveries, 'campaign = {:id}', '', 1001, 0, { id });
	for (const row of rows) counts[row.getString('status')]++;
	return counts;
}
function sendBatch(event) {
	admin(event);
	const { url } = mailSettings(event.app);
	const id = event.request.pathValue('id');
	const version = event.requestInfo().body.version;
	// Freeze the audience and message atomically, then claim each delivery before SMTP.
	// Failed or interrupted attempts are never automatically retried (SMTP is not transactional).
	event.app.runInTransaction((app) => {
		const campaign = app.findRecordById(campaigns, id);
		if (campaign.getString('status') !== 'draft') return;
		if (campaign.getString('updated') !== version)
			throw new BadRequestError('The draft changed. Reload and review it before sending.');
		const audience = app.findRecordsByFilter(subscribers, 'status = "subscribed"', 'id', 1001, 0);
		if (!audience.length) throw new BadRequestError('There are no confirmed subscribers.');
		if (audience.length > 1000)
			throw new BadRequestError('This simple sender supports up to 1,000 subscribers.');
		for (const person of audience) {
			const delivery = new Record(app.findCollectionByNameOrId(deliveries));
			delivery.set('campaign', id);
			delivery.set('subscriber', person.id);
			delivery.set('status', 'pending');
			app.save(delivery);
		}
		campaign.set('status', 'sending');
		app.save(campaign);
	});
	const campaign = event.app.findRecordById(campaigns, id);
	for (let i = 0; i < 5; i++) {
		let claimed = null;
		event.app.runInTransaction((app) => {
			const row = find(app, deliveries, 'campaign = {:id} && status = "pending"', { id });
			if (!row) return;
			row.set('status', 'sending');
			app.save(row);
			claimed = row.id;
		});
		if (!claimed) break;
		const row = event.app.findRecordById(deliveries, claimed);
		const person = find(event.app, subscribers, 'id = {:id}', { id: row.getString('subscriber') });
		let status = 'skipped';
		if (person && person.getString('status') === 'subscribed') {
			try {
				send(
					event.app,
					person.getString('email'),
					campaign.getString('subject'),
					campaign.getString('body') +
						'\n\nYou received this because you subscribed to the PURE3D newsletter.\nUnsubscribe: ' +
						url +
						'/newsletter#unsubscribe=' +
						person.getString('unsubscribeToken')
				);
				status = 'sent';
			} catch {
				status = 'failed';
			}
		}
		row.set('status', status);
		event.app.save(row);
	}
	const counts = progress(event.app, id);
	if (!counts.pending && !counts.sending) {
		campaign.set('status', 'sent');
		event.app.save(campaign);
	}
	return event.json(200, counts);
}
function addSubscriber(event) {
	admin(event);
	const body = event.requestInfo().body;
	const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
	const note = typeof body.consentNote === 'string' ? body.consentNote.trim() : '';
	if (
		email.length > 254 ||
		!/^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$/.test(email)
	)
		throw new BadRequestError('Please enter a valid email address.');
	if (body.consent !== true || !note || note.length > 1000)
		throw new BadRequestError('Confirm permission and record where and when consent was given.');
	let alreadySubscribed = false;
	event.app.runInTransaction((app) => {
		let person = find(app, subscribers, 'email = {:email}', { email });
		if (person && person.getString('status') === 'subscribed') {
			alreadySubscribed = true;
			return;
		}
		// Do not silently override a previous unsubscribe, even with an admin assertion.
		if (person && person.getString('status') === 'unsubscribed')
			throw new BadRequestError(
				'This address previously unsubscribed. Ask the person to use the public signup form to subscribe again.'
			);
		if (!person) person = new Record(app.findCollectionByNameOrId(subscribers));
		person.set('email', email);
		person.set('status', 'subscribed');
		person.set('confirmationHash', '');
		person.set('confirmationExpires', '');
		if (!person.getString('unsubscribeToken'))
			person.set('unsubscribeToken', $security.randomString(64));
		person.set('consentSource', 'admin_recorded');
		person.set('consentNote', note);
		person.set('consentRecordedBy', event.auth.id);
		person.set('consentRecordedAt', new Date().toISOString());
		app.save(person);
	});
	return event.json(200, { success: true, alreadySubscribed });
}
function stopSubscriber(event) {
	admin(event);
	event.app.runInTransaction((app) => {
		const person = app.findRecordById(subscribers, event.request.pathValue('id'));
		person.set('status', 'unsubscribed');
		person.set('confirmationHash', '');
		person.set('unsubscribedAt', new Date().toISOString());
		app.save(person);
	});
	return event.json(200, { success: true });
}
module.exports = {
	admin,
	subscribe,
	preference,
	saveDraft,
	testEmail,
	sendBatch,
	progress,
	addSubscriber,
	stopSubscriber
};
