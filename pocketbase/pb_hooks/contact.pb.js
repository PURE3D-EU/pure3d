routerAdd(
	'POST',
	'/api/pure3d/contact',
	(event) => {
		const body = event.requestInfo().body;
		if (body.website) throw new BadRequestError('Unable to send message.');
		const limits = { name: 120, email: 254, subject: 200, message: 10000 };
		const values = {};
		for (const field in limits) {
			if (
				typeof body[field] !== 'string' ||
				!body[field].trim() ||
				body[field].length > limits[field]
			) {
				throw new BadRequestError('Please provide a valid ' + field + '.');
			}
			values[field] = body[field].trim();
		}
		if (
			!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email) ||
			/[\r\n\x00-\x1f\x7f]/.test(values.name + values.email + values.subject)
		) {
			throw new BadRequestError('Please check your name, email and subject.');
		}
		const settings = event.app.settings();
		if (!settings.smtp.enabled) {
			throw new ApiError(503, 'Contact email is currently unavailable.');
		}
		// SetFunc holds the store lock for the complete read/modify/write operation.
		// Check the client first so repeated requests cannot consume the global allowance.
		const store = event.app.store();
		const now = Date.now();
		const secret = store.getOrSet('pure3d.contact.secret', () => $security.randomString(64));
		const client = $security.hs256(event.realIP(), String(secret));
		let admitted = false;
		store.setFunc('pure3d.contact.limits', (old) => {
			const state = old ? JSON.parse(String(old)) : { clients: {}, sends: [] };
			for (const key of Object.keys(state.clients))
				if (state.clients[key] <= now) delete state.clients[key];
			state.sends = state.sends.filter((sent) => sent > now - 60000);
			if (!state.clients[client] && state.sends.length < 10) {
				state.clients[client] = now + 60000;
				state.sends.push(now);
				admitted = true;
			}
			return JSON.stringify(state);
		});
		if (!admitted) {
			throw new TooManyRequestsError('Please wait a moment before sending another message.');
		}
		try {
			event.app.newMailClient().send(
				new MailerMessage({
					from: { address: settings.meta.senderAddress, name: settings.meta.senderName },
					to: [{ address: 'info@pure3d.eu' }],
					headers: { 'Reply-To': values.email },
					subject: 'PURE3D contact: ' + values.subject,
					text: 'Name: ' + values.name + '\nEmail: ' + values.email + '\n\n' + values.message
				})
			);
		} catch {
			throw new ApiError(503, 'Your message could not be sent. Please try again later.');
		}
		return event.json(200, { success: true });
	},
	$apis.bodyLimit(65536)
);
