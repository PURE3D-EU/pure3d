import { afterAll, beforeAll, expect, test } from 'bun:test';
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import PocketBase from 'pocketbase';
import { ensureNewsletter } from '../../scripts/newsletter-schema';

const binary = process.env.PB_TEST_BINARY;
const integration = binary ? test : test.skip;
let directory: string;
let backend: ReturnType<typeof Bun.spawn>;
let root: PocketBase;
let admin: PocketBase;
let reader: PocketBase;
let anonymous: PocketBase;

type Message = { to: { address: string }[]; subject: string; text: string; rejected?: boolean };
async function messages(): Promise<Message[]> {
	const files = await readdir(join(directory, 'mail'));
	return Promise.all(files.map((file) => Bun.file(join(directory, 'mail', file)).json()));
}
function route(client: PocketBase, path: string, body?: object) {
	return client.send(`/api/pure3d/newsletter/${path}`, {
		method: body === undefined ? 'GET' : 'POST',
		body,
		requestKey: null
	});
}
function token(message: Message, action: string) {
	const value = message.text.match(new RegExp(`#${action}=([a-zA-Z0-9]{64})`))?.[1];
	expect(value).toBeDefined();
	return value!;
}
async function draft(subject: string) {
	return route(admin, 'drafts', { subject, body: 'News from the archive.' });
}
async function person(email: string, status = 'subscribed') {
	return root.collection('newsletter_subscribers').create({
		email,
		status,
		unsubscribeToken: 'U'.repeat(48) + crypto.randomUUID().replaceAll('-', '').slice(0, 16)
	});
}

beforeAll(async () => {
	if (!binary) return;
	directory = await mkdtemp(join(tmpdir(), 'pure3d-newsletter-integration-'));
	const hooks = join(directory, 'hooks');
	await mkdir(hooks);
	await mkdir(join(directory, 'mail'));
	for (const file of ['newsletter.pb.js', 'newsletter-service.cjs'])
		await copyFile(resolve('pocketbase/pb_hooks', file), join(hooks, file));
	await writeFile(
		join(hooks, '00-test-fixture.pb.js'),
		`onBootstrap((e) => {
			e.next();
			const root = new Record(e.app.findCollectionByNameOrId('_superusers'), { email: 'root@example.test' });
			root.setPassword('local-test-password-only');
			e.app.save(root);
		});
		// Replace only the external mail transport. All application hooks, routes,
		// permissions, transactions and schema are the unmodified production code.
		onMailerSend((e) => {
			const message = JSON.parse(JSON.stringify(e.message));
			message.rejected = message.subject === 'Transport failure';
			$os.writeFile(__hooks + '/../mail/' + $security.randomString(32) + '.json', JSON.stringify(message), 0o600);
			if (message.rejected) throw new Error('Simulated SMTP rejection');
		});`
	);
	const listener = createServer();
	await new Promise<void>((done) => listener.listen(0, '127.0.0.1', done));
	const port = (listener.address() as { port: number }).port;
	await new Promise<void>((done) => listener.close(() => done()));
	const origin = `http://127.0.0.1:${port}`;
	backend = Bun.spawn(
		[
			binary,
			'serve',
			'--hooksWatch=false',
			`--http=127.0.0.1:${port}`,
			`--dir=${join(directory, 'data')}`,
			`--hooksDir=${hooks}`,
			`--migrationsDir=${join(directory, 'migrations')}`
		],
		{ stdout: Bun.file(join(directory, 'backend.log')), stderr: 'pipe' }
	);
	let healthy = false;
	for (let attempt = 0; attempt < 300; attempt++) {
		if (backend.exitCode !== null)
			throw new Error(`Disposable backend exited: ${await new Response(backend.stderr).text()}`);
		try {
			if ((await fetch(`${origin}/api/health`)).ok) {
				healthy = true;
				break;
			}
		} catch {
			/* starting */
		}
		await Bun.sleep(50);
	}
	if (!healthy) throw new Error('Disposable backend did not become healthy.');
	root = new PocketBase(origin);
	root.autoCancellation(false);
	await root
		.collection('_superusers')
		.authWithPassword('root@example.test', 'local-test-password-only');
	const users = await root.collections.getOne('users');
	await root.collections.update(users.id, {
		fields: [
			...users.fields,
			{ name: 'role', type: 'select', values: ['admin', 'user'], maxSelect: 1 }
		]
	});
	for (const role of ['admin', 'user'])
		await root.collection('users').create({
			email: `${role}@example.test`,
			password: 'local-test-password-only',
			passwordConfirm: 'local-test-password-only',
			role
		});
	admin = new PocketBase(origin);
	reader = new PocketBase(origin);
	anonymous = new PocketBase(origin);
	for (const [client, role] of [
		[admin, 'admin'],
		[reader, 'user']
	] as const) {
		client.autoCancellation(false);
		await client
			.collection('users')
			.authWithPassword(`${role}@example.test`, 'local-test-password-only');
	}
	await ensureNewsletter(root);
	await ensureNewsletter(root);
	await root.settings.update({
		meta: {
			appURL: 'http://127.0.0.1:60020',
			senderAddress: 'newsletter@example.test',
			senderName: 'PURE3D'
		},
		smtp: { enabled: true, host: '127.0.0.1', port: 1, tls: false }
	});
}, 30000);

afterAll(async () => {
	if (backend) {
		backend.kill();
		await backend.exited;
	}
	if (directory) await rm(directory, { recursive: true, force: true });
});

integration('empty audience cannot freeze a draft or create deliveries', async () => {
	const campaign = await draft('Empty audience');
	await expect(
		route(admin, `campaigns/${campaign.id}/send`, { version: campaign.updated })
	).rejects.toMatchObject({ status: 400 });
	expect((await admin.collection('newsletter_campaigns').getOne(campaign.id)).status).toBe('draft');
	expect(await route(admin, `campaigns/${campaign.id}/progress`)).toEqual({
		pending: 0,
		sending: 0,
		sent: 0,
		failed: 0,
		skipped: 0
	});
});

integration(
	'public signup sends confirmation, persists pending and confirms idempotently',
	async () => {
		expect(await route(anonymous, 'subscribe', { email: '  Signup@Example.test  ' })).toEqual({
			success: true
		});
		const subscriber = await root
			.collection('newsletter_subscribers')
			.getFirstListItem('email="signup@example.test"');
		expect(subscriber.status).toBe('pending');
		expect(subscriber.confirmedAt).toBe('');
		const mail = (await messages()).filter((item) => item.to[0].address === 'signup@example.test');
		expect(mail).toHaveLength(1);
		expect(mail[0].subject).toBe('Confirm your PURE3D newsletter subscription');
		const confirmation = token(mail[0], 'confirm');
		expect(await route(anonymous, 'confirm', { token: confirmation })).toEqual({ success: true });
		const confirmed = await root.collection('newsletter_subscribers').getOne(subscriber.id);
		expect(confirmed.status).toBe('subscribed');
		expect(confirmed.confirmedAt).not.toBe('');
		await route(anonymous, 'confirm', { token: confirmation });
		expect(
			(await root.collection('newsletter_subscribers').getOne(subscriber.id)).confirmedAt
		).toBe(confirmed.confirmedAt);
		await expect(
			route(anonymous, 'subscribe', { email: 'signup@example.test' })
		).rejects.toMatchObject({ status: 429 });
	}
);

integration(
	'expired and invalid confirmation cannot subscribe; unsubscribe is idempotent',
	async () => {
		const expiredToken = 'E'.repeat(64);
		const expired = await root.collection('newsletter_subscribers').create({
			email: 'expired@example.test',
			status: 'pending',
			confirmationHash: new Bun.CryptoHasher('sha256').update(expiredToken).digest('hex'),
			confirmationExpires: '2020-01-01 00:00:00.000Z',
			unsubscribeToken: 'X'.repeat(64)
		});
		await expect(route(anonymous, 'confirm', { token: expiredToken })).rejects.toMatchObject({
			status: 400
		});
		await expect(route(anonymous, 'confirm', { token: 'invalid' })).rejects.toMatchObject({
			status: 400
		});
		expect((await root.collection('newsletter_subscribers').getOne(expired.id)).status).toBe(
			'pending'
		);
		const subscribed = await person('unsubscribe@example.test');
		// Seed a known token through the superuser API; preference changes use the real public route.
		await root
			.collection('newsletter_subscribers')
			.update(subscribed.id, { unsubscribeToken: 'Z'.repeat(64) });
		await route(anonymous, 'unsubscribe', { token: 'Z'.repeat(64) });
		await route(anonymous, 'unsubscribe', { token: 'Z'.repeat(64) });
		expect((await root.collection('newsletter_subscribers').getOne(subscribed.id)).status).toBe(
			'unsubscribed'
		);
	}
);

integration(
	'private collection reads/writes and all administrative routes enforce permissions',
	async () => {
		const subscriber = await person('private@example.test', 'pending');
		const campaign = await draft('Permission checks');
		for (const collection of [
			'newsletter_subscribers',
			'newsletter_campaigns',
			'newsletter_deliveries'
		]) {
			for (const client of [anonymous, reader]) {
				expect((await client.collection(collection).getList()).items).toEqual([]);
				await expect(client.collection(collection).create({})).rejects.toMatchObject({
					status: 403
				});
			}
		}
		for (const client of [anonymous, reader]) {
			await expect(
				client.collection('newsletter_subscribers').getOne(subscriber.id)
			).rejects.toMatchObject({ status: 404 });
			for (const [path, body] of [
				['drafts', { subject: 'Unauthorised', body: 'No' }],
				[`campaigns/${campaign.id}/test`, {}],
				[`campaigns/${campaign.id}/send`, { version: campaign.updated }],
				[`campaigns/${campaign.id}/progress`, undefined],
				[`subscribers/${subscriber.id}/unsubscribe`, {}]
			] as const)
				await expect(route(client, path, body)).rejects.toMatchObject({
					status: client === anonymous ? 401 : 403
				});
		}
		const visible = await admin.collection('newsletter_subscribers').getOne(subscriber.id);
		for (const field of ['confirmationHash', 'unsubscribeToken', 'confirmationExpires'])
			expect(visible).not.toHaveProperty(field);
		await expect(
			admin.collection('newsletter_subscribers').update(subscriber.id, { status: 'subscribed' })
		).rejects.toMatchObject({ status: 403 });
		await expect(
			admin.collection('newsletter_subscribers').delete(subscriber.id)
		).rejects.toMatchObject({ status: 403 });
		await route(admin, `subscribers/${subscriber.id}/unsubscribe`, {});
		expect((await root.collection('newsletter_subscribers').getOne(subscriber.id)).status).toBe(
			'unsubscribed'
		);
	}
);

integration('draft save/reopen, stale-edit locking, test email and stale-send guard', async () => {
	const initial = await draft('Draft persistence');
	expect((await admin.collection('newsletter_campaigns').getOne(initial.id)).body).toBe(
		'News from the archive.'
	);
	await Bun.sleep(5);
	const saved = await route(admin, 'drafts', {
		id: initial.id,
		version: initial.updated,
		subject: 'Reviewed draft',
		body: 'Reviewed message'
	});
	expect((await admin.collection('newsletter_campaigns').getOne(initial.id)).subject).toBe(
		'Reviewed draft'
	);
	await expect(
		route(admin, 'drafts', {
			id: initial.id,
			version: initial.updated,
			subject: 'Stale',
			body: 'Stale'
		})
	).rejects.toMatchObject({ status: 400 });
	await expect(
		route(admin, `campaigns/${initial.id}/send`, { version: initial.updated })
	).rejects.toMatchObject({ status: 400 });
	expect((await admin.collection('newsletter_campaigns').getOne(initial.id)).status).toBe('draft');
	await route(admin, `campaigns/${saved.id}/test`, {});
	const mail = (await messages()).filter((item) => item.subject === '[Test] Reviewed draft');
	expect(mail).toHaveLength(1);
	expect(mail[0].to.map((recipient) => recipient.address)).toEqual(['admin@example.test']);
	expect(mail[0].text).toContain('Reviewed message');
});

integration(
	'confirmed-only concurrent batches claim once, unsubscribe links work, sent drafts lock',
	async () => {
		for (let i = 0; i < 8; i++) await person(`audience${i}@example.test`);
		await person('never-confirmed@example.test', 'pending');
		await person('opted-out@example.test', 'unsubscribed');
		const campaign = await draft('Concurrent newsletter');
		await expect(route(admin, `campaigns/${campaign.id}/send`, {})).rejects.toMatchObject({
			status: 400
		});
		const batches = await Promise.all([
			route(admin, `campaigns/${campaign.id}/send`, { version: campaign.updated }),
			route(admin, `campaigns/${campaign.id}/send`, { version: campaign.updated })
		]);
		expect(batches).toHaveLength(2);
		let progress = await route(admin, `campaigns/${campaign.id}/progress`);
		while (progress.pending) {
			await route(admin, `campaigns/${campaign.id}/send`, {});
			progress = await route(admin, `campaigns/${campaign.id}/progress`);
		}
		expect(progress).toMatchObject({ pending: 0, sending: 0, failed: 0, skipped: 0 });
		expect(progress.sent).toBeGreaterThanOrEqual(8);
		const mail = (await messages()).filter((item) => item.subject === campaign.subject);
		expect(mail).toHaveLength(progress.sent);
		expect(new Set(mail.map((item) => item.to[0].address)).size).toBe(mail.length);
		expect(
			mail.some((item) =>
				['never-confirmed@example.test', 'opted-out@example.test'].includes(item.to[0].address)
			)
		).toBe(false);
		await route(anonymous, 'unsubscribe', { token: token(mail[0], 'unsubscribe') });
		expect(
			(
				await root
					.collection('newsletter_subscribers')
					.getFirstListItem(`email="${mail[0].to[0].address}"`)
			).status
		).toBe('unsubscribed');
		await route(admin, `campaigns/${campaign.id}/send`, {});
		expect((await messages()).filter((item) => item.subject === campaign.subject)).toHaveLength(
			mail.length
		);
		const sent = await admin.collection('newsletter_campaigns').getOne(campaign.id);
		expect(sent.status).toBe('sent');
		await expect(
			route(admin, 'drafts', {
				id: sent.id,
				version: sent.updated,
				subject: 'Changed',
				body: 'Changed'
			})
		).rejects.toMatchObject({ status: 400 });
	},
	20000
);

integration(
	'mail configuration blocks send without freezing a draft; transport failures are not retried',
	async () => {
		const campaign = await draft('Transport failure');
		await root.settings.update({ smtp: { enabled: false } });
		try {
			await expect(
				route(admin, `campaigns/${campaign.id}/send`, { version: campaign.updated })
			).rejects.toMatchObject({ status: 503 });
			expect((await admin.collection('newsletter_campaigns').getOne(campaign.id)).status).toBe(
				'draft'
			);
		} finally {
			await root.settings.update({ smtp: { enabled: true } });
		}
		let progress = await route(admin, `campaigns/${campaign.id}/send`, {
			version: campaign.updated
		});
		while (progress.pending) progress = await route(admin, `campaigns/${campaign.id}/send`, {});
		expect(progress.failed).toBeGreaterThan(0);
		expect(progress.sent).toBe(0);
		expect(await route(admin, `campaigns/${campaign.id}/send`, {})).toEqual(progress);
		const attempts = (await messages()).filter((item) => item.subject === campaign.subject);
		expect(attempts).toHaveLength(progress.failed);
		expect(attempts.every((item) => item.rejected)).toBe(true);
	},
	20000
);

integration(
	'unsubscribing after audience freeze skips unclaimed deliveries without adding new subscribers',
	async () => {
		for (const subscriber of await admin
			.collection('newsletter_subscribers')
			.getFullList({ filter: 'status="subscribed"' }))
			await route(admin, `subscribers/${subscriber.id}/unsubscribe`, {});
		for (let i = 0; i < 7; i++) await person(`frozen${i}@example.test`);
		const campaign = await draft('Frozen audience');
		expect(
			await route(admin, `campaigns/${campaign.id}/send`, { version: campaign.updated })
		).toEqual({ pending: 2, sending: 0, sent: 5, failed: 0, skipped: 0 });
		const pending = await admin
			.collection('newsletter_deliveries')
			.getFullList({ filter: `campaign="${campaign.id}" && status="pending"` });
		for (const delivery of pending)
			await route(admin, `subscribers/${delivery.subscriber}/unsubscribe`, {});
		await person('joined-after-freeze@example.test');
		expect(await route(admin, `campaigns/${campaign.id}/send`, {})).toEqual({
			pending: 0,
			sending: 0,
			sent: 5,
			failed: 0,
			skipped: 2
		});
		const mail = (await messages()).filter((item) => item.subject === campaign.subject);
		expect(mail).toHaveLength(5);
		expect(mail.some((item) => item.to[0].address === 'joined-after-freeze@example.test')).toBe(
			false
		);
	},
	20000
);
