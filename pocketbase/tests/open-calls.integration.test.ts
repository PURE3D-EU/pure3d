import { afterAll, beforeAll, expect, test } from 'bun:test';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import PocketBase from 'pocketbase';
import {
	ensureOpenCalls,
	openCallsAdminRule,
	openCallsReadRule
} from '../../scripts/open-calls-schema';

const binary = process.env.PB_TEST_BINARY;
const integration = binary ? test : test.skip;
let directory: string;
let server: ReturnType<typeof Bun.spawn>;
let root: PocketBase;
let admin: PocketBase;
let reader: PocketBase;
let anonymous: PocketBase;

beforeAll(async () => {
	if (!binary) return;
	directory = await mkdtemp(join(tmpdir(), 'pure3d-open-calls-integration-'));
	const hooks = join(directory, 'hooks');
	await mkdir(hooks);
	for (const file of ['cms.pb.js', 'cms-service.cjs'])
		await copyFile(resolve('pocketbase/pb_hooks', file), join(hooks, file));
	await writeFile(
		join(hooks, '00-bootstrap.pb.js'),
		`onBootstrap((e) => {
		e.next();
		try { e.app.findFirstRecordByFilter('_superusers', 'email = "root@example.test"'); return; } catch {}
		const root = new Record(e.app.findCollectionByNameOrId('_superusers'), { email: 'root@example.test' });
		root.setPassword('local-test-password-only');
		e.app.save(root);
	});`
	);
	const listener = createServer();
	await new Promise<void>((done) => listener.listen(0, '127.0.0.1', done));
	const port = (listener.address() as { port: number }).port;
	await new Promise<void>((done) => listener.close(() => done()));
	const origin = `http://127.0.0.1:${port}`;
	server = Bun.spawn(
		[
			binary,
			'serve',
			'--hooksWatch=false',
			`--http=127.0.0.1:${port}`,
			`--dir=${join(directory, 'data')}`,
			`--hooksDir=${hooks}`,
			`--migrationsDir=${join(directory, 'migrations')}`
		],
		{
			stdout: 'pipe',
			stderr: 'pipe',
			env: { ...process.env }
		}
	);
	let healthy = false;
	for (let attempt = 0; attempt < 200; attempt++) {
		if (server.exitCode !== null)
			throw new Error(`Disposable backend exited: ${await new Response(server.stderr).text()}`);
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
	await root
		.collection('_superusers')
		.authWithPassword('root@example.test', 'local-test-password-only');
	const users = await root.collections.getOne('users');
	await root.collections.update(users.id, {
		name: 'users',
		type: 'auth',
		passwordAuth: { enabled: true, identityFields: ['email'] },
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
	await admin
		.collection('users')
		.authWithPassword('admin@example.test', 'local-test-password-only');
	reader = new PocketBase(origin);
	await reader
		.collection('users')
		.authWithPassword('user@example.test', 'local-test-password-only');
	anonymous = new PocketBase(origin);
	await ensureOpenCalls(root);
	const calls = await root.collections.getOne('open_calls');
	await root.collections.create({
		name: 'editions',
		type: 'base',
		fields: [{ name: 'proposalOpenCall', type: 'relation', collectionId: calls.id, maxSelect: 1 }]
	});
	const content = await root.collections.create({
		name: 'content',
		type: 'base',
		fields: [
			{ name: 'title', type: 'text' },
			{ name: 'slug', type: 'text' },
			{ name: 'kind', type: 'text' },
			{ name: 'layout', type: 'text' },
			{ name: 'order', type: 'number' },
			{ name: 'body', type: 'editor' },
			{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
			{ name: 'isPublished', type: 'bool' }
		],
		listRule: openCallsReadRule,
		viewRule: openCallsReadRule,
		createRule: openCallsAdminRule,
		updateRule: openCallsAdminRule,
		deleteRule: openCallsAdminRule
	});
	await root.collections.update(content.id, {
		fields: [
			...content.fields,
			{ name: 'parent', type: 'relation', collectionId: content.id, maxSelect: 1 }
		]
	});
}, 30000);

afterAll(async () => {
	if (server) {
		server.kill();
		await server.exited;
	}
	if (directory) await rm(directory, { recursive: true, force: true });
});

integration(
	'CMS components survive administrator save/reopen and the anonymous public page loader',
	async () => {
		const call = await admin.collection('open_calls').create({
			title: 'Component persistence call',
			body: '<p>Published call description.</p>',
			isPublished: true
		});
		const edition = await root.collection('editions').create({});
		// Existing stored HTML, including legacy single-link metadata as well as multiple links.
		const profiles =
			'<section data-cms-profiles="true">' +
			'<article data-cms-profile="true" data-name="Ada Researcher" data-role="Editor" data-bio="Researching 3D heritage." data-image="/media/ada.jpg" data-alt="Ada in the archive">' +
			'<img src="/media/ada.jpg" alt="Ada in the archive"><div><h3>Ada Researcher</h3><p>Editor</p><p>Researching 3D heritage.</p></div>' +
			'<div data-cms-profile-links="true"><a href="https://example.test/ada" data-cms-profile-link="true">Research profile</a><a href="mailto:ada@example.test" data-cms-profile-link="true">Contact Ada</a></div></article>' +
			'<article data-cms-profile="true" data-name="Legacy Researcher" data-href="/about/team" data-link-label="Meet the team"><div><h3>Legacy Researcher</h3></div><a href="/about/team">Meet the team</a></article></section>';
		const logos =
			'<div data-cms-logo-grid="true"><figure data-cms-logo="true" data-name="Heritage partner" data-image="https://example.test/partner.svg" data-alt="Heritage partner logo" data-href="https://example.test/partner"><a href="https://example.test/partner"><img src="https://example.test/partner.svg" alt="Heritage partner logo"></a><figcaption>Heritage partner</figcaption></figure></div>';
		const facts =
			'<dl data-cms-project-facts="true"><div data-cms-project-fact="true" data-label="Collection" data-value="Historical objects"><dt>Collection</dt><dd>Historical objects</dd></div><div data-cms-project-fact="true" data-label="Licence" data-value="CC BY 4.0"><dt>Licence</dt><dd>CC BY 4.0</dd></div></dl>';
		const actions =
			'<div data-cms-actions="true"><a href="/editions?view=all&amp;sort=title#results" data-cms-action="primary">Explore editions</a><a href="https://example.test/guide" data-cms-action="secondary">Read the guide</a></div>';
		const image =
			'<figure data-content-image="true"><img src="/media/object.jpg" alt="Digitised heritage object"><figcaption>Object from the collection.</figcaption></figure>';
		const references = `<div data-cms-editions="${edition.id}"></div><div data-cms-open-calls="true" data-open-call-ids="${call.id}"></div>`;
		const expandable = `<details data-cms-expandable="true"><summary>Research details</summary><aside data-cms-callout="info"><p>Nested research information.</p>${facts}${actions}</aside>${references}${image}</details>`;
		let saved = await admin.collection('content').create({
			title: 'Component persistence',
			slug: 'component-persistence',
			kind: 'page',
			layout: 'standard',
			body: profiles + logos + expandable,
			isPublished: true
		});
		const assertReopened = async (body: string) => {
			// A fresh authenticated client reads the persisted record, not the update response.
			const reopened = new PocketBase(admin.baseURL);
			reopened.authStore.save(admin.authStore.token, admin.authStore.record);
			expect((await reopened.collection('content').getOne(saved.id)).body).toBe(body);
			expect((await anonymous.collection('content').getOne(saved.id)).body).toBe(body);
			// Isolate SvelteKit platform shims from other suites; the actual loader and SDK run
			// against the disposable native backend with no mocked CMS/application modules.
			const publicPage = Bun.spawn(
				[
					process.execPath,
					'--no-env-file',
					'-e',
					`import { mock } from 'bun:test';
					mock.module('$env/static/public', () => ({ PUBLIC_POCKETBASE_URL: ${JSON.stringify(admin.baseURL)} }));
					mock.module('$app/environment', () => ({ dev: false }));
					mock.module('$app/paths', () => ({ resolve: (path) => path }));
					const { load } = await import('./src/routes/resources/[slug]/+page.ts');
					const result = await load({ params: { slug: 'component-persistence' }, fetch });
					console.log(JSON.stringify(result));`
				],
				{ stdout: 'pipe', stderr: 'pipe' }
			);
			const [output, errors, status] = await Promise.all([
				new Response(publicPage.stdout).text(),
				new Response(publicPage.stderr).text(),
				publicPage.exited
			]);
			expect(errors).toBe('');
			expect(status).toBe(0);
			const page = JSON.parse(output);
			expect(page.item.id).toBe(saved.id);
			expect(page.item.body).toBe(body);
			expect(page.children).toEqual([]);
		};
		await assertReopened(profiles + logos + expandable);
		for (const count of [2, 3, 4]) {
			// Profiles introduce a nested <section> before the remaining column siblings.
			const contents = [profiles, expandable + logos, '<p>Third column</p>', '<p></p>'];
			const body = `<section data-cms-columns="${count}">${contents
				.slice(0, count)
				.map((content) => `<div data-cms-column="true">${content}</div>`)
				.join('')}</section>`;
			await Bun.sleep(3);
			saved = await admin
				.collection('content')
				.update(saved.id, { body }, { headers: { 'X-Pure3D-Content-Version': saved.updated } });
			await assertReopened(body);
		}
		const persisted = saved.body;
		for (const hostile of [
			profiles.replace('href="https://example.test/ada"', 'href="javascript:alert(1)"'),
			profiles.replace('data-image="/media/ada.jpg"', 'data-image="data:text/html,unsafe"'),
			image.replace('src="/media/object.jpg"', 'src="javascript:alert(1)"'),
			actions.replace('href="https://example.test/guide"', 'href="javascript:alert(1)"'),
			'<section data-cms-columns="2"><div data-cms-column="true"><p>Missing sibling</p></div></section>',
			`<section data-cms-columns="2"><div data-cms-column="true"><section data-cms-columns="2"><div data-cms-column="true"><p>Nested</p></div><div data-cms-column="true"><p>Nested</p></div></section></div><div data-cms-column="true"><p>Sibling</p></div></section>`,
			'<div data-cms-open-calls="true" data-open-call-ids="invalid"></div>'
		]) {
			await expect(
				admin
					.collection('content')
					.update(
						saved.id,
						{ body: hostile },
						{ headers: { 'X-Pure3D-Content-Version': saved.updated } }
					)
			).rejects.toMatchObject({ status: 400 });
			await assertReopened(persisted);
		}
	},
	30000
);

integration(
	'administrators publish and reuse live calls while draft and write permissions remain protected',
	async () => {
		const call = await admin.collection('open_calls').create({
			title: 'Thematic research call',
			body: '<p>Original research description.</p>',
			deadline: '2099-11-13 00:00:00.000Z',
			order: 0
		});
		expect((await admin.collection('open_calls').getOne(call.id)).body).toBe(
			'<p>Original research description.</p>'
		);
		await expect(anonymous.collection('open_calls').getOne(call.id)).rejects.toMatchObject({
			status: 404
		});
		await expect(
			reader.collection('open_calls').update(
				call.id,
				{ title: 'Unauthorised edit' },
				{
					headers: { 'X-Pure3D-Open-Call-Version': call.updated }
				}
			)
		).rejects.toThrow();
		await expect(
			reader.collection('open_calls').create({ title: 'Unauthorised call' })
		).rejects.toThrow();
		await expect(
			admin.collection('open_calls').update(call.id, { isPublished: true })
		).rejects.toThrow();
		let saved = await admin.collection('open_calls').update(
			call.id,
			{ isPublished: true },
			{
				headers: { 'X-Pure3D-Open-Call-Version': call.updated }
			}
		);
		expect((await anonymous.collection('open_calls').getOne(call.id)).title).toBe(
			'Thematic research call'
		);
		const body = `<h2>Current calls</h2><div data-cms-open-calls="true" data-open-call-ids="${call.id}"></div>`;
		const page = await admin.collection('content').create({
			title: 'Calls',
			slug: 'calls',
			kind: 'page',
			layout: 'standard',
			body,
			isPublished: true
		});
		expect((await anonymous.collection('content').getOne(page.id)).body).toBe(body);
		await Bun.sleep(3);
		saved = await admin.collection('open_calls').update(
			call.id,
			{ body: '<p>Updated research description.</p>' },
			{
				headers: { 'X-Pure3D-Open-Call-Version': saved.updated }
			}
		);
		await expect(
			admin.collection('open_calls').update(
				call.id,
				{ body: '<p>Stale overwrite</p>' },
				{
					headers: { 'X-Pure3D-Open-Call-Version': call.updated }
				}
			)
		).rejects.toThrow();
		expect((await anonymous.collection('open_calls').getOne(call.id)).body).toBe(
			'<p>Updated research description.</p>'
		);
		expect((await anonymous.collection('content').getOne(page.id)).body).toBe(body);
		await expect(
			admin.collection('content').update(page.id, {
				body: '<div data-cms-open-calls="true" data-open-call-ids="invalid"></div>'
			})
		).rejects.toThrow();
		await expect(
			admin.collection('open_calls').update(
				call.id,
				{ body },
				{
					headers: { 'X-Pure3D-Open-Call-Version': saved.updated }
				}
			)
		).rejects.toThrow();
		expect((await admin.collection('open_calls').getOne(call.id)).body).toBe(
			'<p>Updated research description.</p>'
		);
		await admin.collection('open_calls').update(
			call.id,
			{ isPublished: false },
			{
				headers: { 'X-Pure3D-Open-Call-Version': saved.updated }
			}
		);
		expect(
			(await anonymous.collection('open_calls').getFullList()).some(
				(record) => record.id === call.id
			)
		).toBe(false);
		await expect(admin.collection('open_calls').delete(call.id)).rejects.toThrow();
		await admin.collection('content').update(
			page.id,
			{ body: '<p>No call references.</p>' },
			{
				headers: { 'X-Pure3D-Content-Version': page.updated }
			}
		);
		await expect(
			admin.collection('content').update(
				page.id,
				{ body },
				{
					headers: { 'X-Pure3D-Content-Version': page.updated }
				}
			)
		).rejects.toThrow();
		expect((await anonymous.collection('content').getOne(page.id)).body).toBe(
			'<p>No call references.</p>'
		);
		const proposal = await root.collection('editions').create({ proposalOpenCall: call.id });
		await expect(admin.collection('open_calls').delete(call.id)).rejects.toThrow();
		await root.collection('editions').update(proposal.id, { proposalOpenCall: '' });
		await admin.collection('open_calls').delete(call.id);
		await expect(admin.collection('open_calls').getOne(call.id)).rejects.toMatchObject({
			status: 404
		});
	}
);
