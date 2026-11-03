import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { generateKeyPairSync, sign } from 'node:crypto';
import PocketBase from 'pocketbase';
import schema from '../pb_schema/collections.json';
import {
	alignOrcidSchema,
	orcidAuthConfig,
	applyOrcidConfiguration,
	preflightPrivilegedAccounts,
	updateOrcidJwks
} from '../../scripts/configure-orcid';
import { ensureOpenCalls, ensureProposalOpenCall } from '../../scripts/open-calls-schema';

// Run with PB_TEST_BINARY=/absolute/path/to/pocketbase bun --no-env-file test pocketbase/tests
// Never connects to configured app services or reads application credentials.
// Repeat with PB_TEST_ORCID_ENVIRONMENT=sandbox for a separate sandbox-issuer fixture/database.
const binary = process.env.PB_TEST_BINARY;
const environment = process.env.PB_TEST_ORCID_ENVIRONMENT || 'production';
const issuer = orcidAuthConfig('test-client', 'test-secret', environment).oauth2.providers[0].extra
	.issuers[0];
const integration = binary ? test : test.skip;
let directory: string;
let processHandle: ReturnType<typeof Bun.spawn>;
let origin: string;
let admin: PocketBase;
let author: PocketBase;
let other: PocketBase;
let root: PocketBase;
const orcid = 'https://orcid.org/0000-0002-1825-0097';
const credit = {
	type: 'person',
	name: 'Author',
	orcid,
	role: 'creator',
	provenance: 'oauth',
	userId: 'author000000000'
};
const proposalPayload = () => ({
	proposalType: 'research',
	proposalPurpose: 'Purpose',
	proposalArgument: 'Argument',
	proposalThreeDRationale: 'Rationale',
	proposalAudience: ['academics'],
	proposalContextualMaterial: 'Context',
	proposalHasExistingModel: false,
	proposalDigitisationSituation: 'Digitisation is planned.'
});

const alphaAnswersPayload = () => ({
	reviewStatus: 'submitted',
	technicalComments: 'The scene loads correctly.',
	valueRating: 4,
	valueExplanation: 'Sources and methodology are clear.',
	experienceComments: 'The narrative is easy to follow.',
	generalComments: 'Review feedback.',
	decision: 'approve',
	recommendationExplanation: 'Ready to proceed.',
	collaborationInterest: 'no'
});
async function requestAlpha(editionId: string) {
	const form = new FormData();
	form.append(
		'sceneDocument',
		new File(
			[
				'{"asset":{"type":"application/si-dpo-3d.document+json","version":"1.0"},"scene":0,"scenes":[{"nodes":[]}]}'
			],
			'scene.svx.json'
		)
	);
	await author.collection('editions').update(editionId, form);
	return author.collection('editions').update(editionId, {
		status: 'alpha_review',
		alphaRequest: { ready: 'The scene.', focus: 'Research argument.', workInProgress: '' }
	});
}

beforeAll(async () => {
	if (!binary) return;
	directory = await mkdtemp(join(tmpdir(), 'pure3d-orcid-test-'));
	const hooks = join(directory, 'hooks');
	await mkdir(hooks);
	for (const file of [
		'contact.pb.js',
		'storage-dashboard.pb.js',
		'storage-dashboard-service.cjs',
		'orcid-service.cjs',
		'sandbox-service.cjs',
		'admin-workflow-service.cjs',
		'orcid-validation.cjs',
		'proposal-service.cjs',
		'proposal-review-service.cjs',
		'alpha-review-service.cjs',
		'publication-service.cjs',
		'review-service.cjs',
		'activity-service.cjs',
		'orcid-readiness.cjs'
	])
		await copyFile(resolve('pocketbase/pb_hooks', file), join(hooks, file));
	// PocketBase 0.40.3 loads hook files from a Go map; filename order is not guaranteed.
	// Register the transport fixture before the production guard in ONE file, rather than
	// intermittently running the guard before the already-verified native OAuth fixture.
	await writeFile(
		join(hooks, 'orcid.pb.js'),
		(await readFile(resolve('pocketbase/tests/fixtures/orcid.pb.js'), 'utf8')) +
			'\n' +
			(await readFile(resolve('pocketbase/pb_hooks/orcid.pb.js'), 'utf8'))
	);
	await writeFile(
		join(hooks, 'schema.json'),
		JSON.stringify(
			schema.filter((item) =>
				[
					'users',
					'collections',
					'editions',
					'collectionUsers',
					'editionUsers',
					'auditLog',
					'editionReviews',
					'reviewAssignments',
					'notifications',
					'reviewFeedback'
				].includes(item.name)
			)
		)
	);
	const server = createServer();
	await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
	const port = (server.address() as { port: number }).port;
	await new Promise<void>((done) => server.close(() => done()));
	origin = 'http://127.0.0.1:' + port;
	processHandle = Bun.spawn(
		[
			binary,
			'serve',
			'--hooksWatch=false',
			'--http=127.0.0.1:' + port,
			'--dir=' + join(directory, 'data'),
			'--hooksDir=' + hooks,
			'--migrationsDir=' + join(directory, 'migrations')
		],
		{ env: { ORCID_ISSUER: issuer, PATH: process.env.PATH || '' }, stdout: 'pipe', stderr: 'pipe' }
	);
	for (let i = 0; i < 100; i++) {
		if (processHandle.exitCode !== null)
			throw new Error(
				'Disposable PB startup failed: ' + (await new Response(processHandle.stderr).text())
			);
		try {
			if ((await fetch(origin + '/api/health')).ok) break;
		} catch {
			/* starting */
		}
		await Bun.sleep(50);
	}
	async function login(email: string, collection = 'users') {
		const pb = new PocketBase(origin);
		await pb
			.collection(collection)
			.authWithPassword(email + '@example.test', 'local-test-password-only');
		return pb;
	}
	admin = await login('admin');
	author = await login('author');
	other = await login('other');
	root = await login('root', '_superusers');
	// This synthetic fixture's identity records were seeded for exactly this issuer.
	await root.collections.update('users', {
		oauth2: { ...orcidAuthConfig('test-client', 'test-secret', environment).oauth2, enabled: false }
	});
	await alignOrcidSchema(root);
	await ensureOpenCalls(root);
	await ensureProposalOpenCall(root);
}, 20000);

afterAll(async () => {
	if (processHandle) {
		processHandle.kill();
		await processHandle.exited;
	}
	if (directory) await rm(directory, { recursive: true, force: true });
});

async function oauth(body: Record<string, unknown>, token = '') {
	const response = await fetch(origin + '/_test/oauth', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
		body: JSON.stringify(body)
	});
	return { status: response.status, body: await response.json() };
}

async function deleteEditionFixture(id: string) {
	// Remove stage-one workflow children while their parent still exists. Do not bypass
	// production relation constraints or model hooks just to tear down a test fixture.
	for (const name of ['reviewFeedback', 'editionReviews', 'reviewAssignments']) {
		const filter = root.filter('editionId = {:id}', { id });
		for (const child of await root.collection(name).getFullList({ filter }))
			await root.collection(name).delete(child.id);
		expect(await root.collection(name).getFullList({ filter })).toHaveLength(0);
	}
	await root.collection('editions').delete(id);
	await expect(root.collection('editions').getOne(id)).rejects.toMatchObject({ status: 404 });
}

integration('public searches cannot probe private parents or siblings through joins', async () => {
	const visitor = new PocketBase(origin);
	const parent = await root.collection('collections').create({
		title: 'Parent query signal',
		isVisible: true,
		credits: [credit]
	});
	const sibling = await root.collection('editions').create({
		title: 'Private sibling query signal',
		collection: parent.id,
		credits: [credit]
	});
	const title = 'A proposalPurpose about collectionUsers and alphaRequest: "3D\'s study"';
	const published = await root.collection('editions').create({
		title,
		collection: parent.id,
		status: 'published',
		isPublished: true,
		credits: [credit]
	});
	try {
		expect((await visitor.collection('collections').getOne(parent.id)).id).toBe(parent.id);
		await expect(visitor.collection('editions').getOne(sibling.id)).rejects.toMatchObject({
			status: 404
		});
		const probes = [
			{
				name: 'users',
				id: credit.userId,
				query: {
					filter: `id = '${credit.userId}' && @collection.editions.title ?= '${sibling.title}'`
				}
			},
			{
				name: 'editions',
				id: published.id,
				query: {
					filter: `id = '${published.id}' && @collection.${published.collectionId}:private.title ?= '${sibling.title}'`
				}
			},
			{
				name: 'editions',
				id: published.id,
				query: {
					filter: `id = '${published.id}' && collection.editions_via_collection.title ?= '${sibling.title}'`
				}
			},
			{
				name: 'editions',
				id: published.id,
				query: { filter: `id = '${published.id}' && collection.title = '${parent.title}'` }
			},
			{
				name: 'editions',
				id: published.id,
				query: { sort: 'collection.editions_via_collection.title' }
			}
		];
		// Controls establish that the native API accepts the paths and can see the matching data.
		for (const probe of probes)
			expect(
				(await root.collection(probe.name).getFullList(probe.query)).some(
					(record) => record.id === probe.id
				)
			).toBe(true);
		const statuses = [];
		for (const probe of probes) {
			const response = await fetch(
				origin + '/api/collections/' + probe.name + '/records?' + new URLSearchParams(probe.query)
			);
			statuses.push(response.status);
		}
		expect(statuses).toEqual(probes.map(() => 403));
		await root.collection('collections').update(parent.id, { isVisible: false });
		await expect(visitor.collection('collections').getOne(parent.id)).rejects.toMatchObject({
			status: 404
		});
		await expect(
			visitor.collection('editions').getFullList({
				filter: `id = '${published.id}' && collection.title = '${parent.title}'`
			})
		).rejects.toMatchObject({ status: 403 });
		for (const filter of [
			visitor.filter('title = {:title}', { title }),
			`title = ${JSON.stringify(title)}`,
			`isPublished = true && credits ~ '${credit.userId}'`,
			`isPublished = true && credits.0.userId = '${credit.userId}'`
		])
			expect(
				(await visitor.collection('editions').getFullList({ filter, sort: 'title' })).some(
					(record) => record.id === published.id
				)
			).toBe(true);
	} finally {
		await root.collection('editions').delete(published.id);
		await root.collection('editions').delete(sibling.id);
		await root.collection('collections').delete(parent.id);
	}
});

integration(
	'local schema commands require explicit credentials and repair private access safely',
	async () => {
		const password = 'local-test-password-only';
		const run = async (script: string, env: Record<string, string>) => {
			const command = Bun.spawn([process.execPath, '--no-env-file', script], {
				env,
				stdout: 'pipe',
				stderr: 'pipe'
			});
			const output = await new Response(command.stdout).text();
			const errors = await new Response(command.stderr).text();
			return { code: await command.exited, output, errors };
		};
		for (const script of [
			'scripts/create-pocketbase-collections.ts',
			'scripts/fix-access-rules.ts'
		]) {
			for (const localOrigin of [origin, 'http://pocketbase:8090']) {
				const missing = await run(script, {
					POCKETBASE_URL: localOrigin,
					POCKETBASE_ADMIN_EMAIL: 'root@example.test'
				});
				expect(missing.code).toBe(1);
				expect(missing.errors).toContain(
					'Set POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD explicitly.'
				);
			}
			const remote = await run(script, {
				POCKETBASE_URL: 'https://example.invalid',
				POCKETBASE_ADMIN_EMAIL: 'root@example.test',
				POCKETBASE_ADMIN_PASSWORD: password
			});
			expect(remote.code).toBe(1);
			expect(remote.errors).toContain('restricted to a local PocketBase origin');
			expect(remote.output + remote.errors).not.toContain(password);
		}
		const parent = await root
			.collection('collections')
			.create({ title: 'CLI private parent', credits: [credit] });
		const membership = await root.collection('collectionUsers').create({
			collection: parent.id,
			userId: credit.userId,
			role: 'owner'
		});
		const original = await root.collections.getOne('collectionUsers');
		const visitor = new PocketBase(origin);
		try {
			// Reproduce an accidentally public legacy read rule in this disposable database only.
			await root.collections.update(original.id, { listRule: '', viewRule: '' });
			expect((await visitor.collection('collectionUsers').getOne(membership.id)).id).toBe(
				membership.id
			);
			const repaired = await run('scripts/fix-access-rules.ts', {
				POCKETBASE_URL: origin,
				POCKETBASE_ADMIN_EMAIL: 'root@example.test',
				POCKETBASE_ADMIN_PASSWORD: password
			});
			expect(repaired.code).toBe(0);
			expect(repaired.errors).toBe('');
			expect(repaired.output).not.toContain(password);
			await expect(
				visitor.collection('collectionUsers').getOne(membership.id)
			).rejects.toMatchObject({ status: 404 });
			expect((await author.collection('collectionUsers').getOne(membership.id)).id).toBe(
				membership.id
			);
		} finally {
			await root.collections.update(original.id, {
				listRule: original.listRule,
				viewRule: original.viewRule
			});
			await root.collection('collections').delete(parent.id);
		}
	}
);

integration('reviewer status patches cannot bypass unanimous proposal approval', async () => {
	const secondUser = await root.collection('users').create({
		email: 'consensus-second@example.test',
		password: 'local-test-password-only',
		passwordConfirm: 'local-test-password-only',
		role: 'user'
	});
	const second = new PocketBase(origin);
	await second.collection('users').authWithPassword(secondUser.email, 'local-test-password-only');
	const edition = await author.collection('editions').create({
		title: 'Consensus security regression',
		credits: [credit]
	});
	try {
		await author.collection('editions').update(edition.id, {
			...proposalPayload(),
			status: 'concept_submitted'
		});
		await admin.collection('editions').update(edition.id, { status: 'editorial_review' });
		for (const reviewer of [other, second]) {
			await admin.collection('reviewAssignments').create({
				editionId: edition.id,
				reviewerId: reviewer.authStore.record!.id,
				reviewStage: 1,
				status: 'pending'
			});
			for (const status of ['concept_accepted', 'concept_rejected'])
				await expect(
					reviewer.collection('editions').update(edition.id, { status })
				).rejects.toMatchObject({ status: 403 });
		}
		for (const reviewer of [other, second]) {
			await reviewer.collection('editionReviews').create({
				editionId: edition.id,
				reviewerId: reviewer.authStore.record!.id,
				reviewStage: 1,
				decision: 'approve',
				comment: 'Ready for development.'
			});
			expect((await author.collection('editions').getOne(edition.id)).status).toBe(
				reviewer === other ? 'editorial_review' : 'concept_accepted'
			);
		}
	} finally {
		for (const name of ['reviewAssignments', 'editionReviews'])
			for (const record of await root
				.collection(name)
				.getFullList({ filter: `editionId = '${edition.id}'` }))
				await root.collection(name).delete(record.id);
		await root.collection('editions').delete(edition.id);
		await root.collection('users').delete(secondUser.id);
	}
});

integration(
	'private memberships, proposal predicates and collection covers stay private',
	async () => {
		const visitor = new PocketBase(origin);
		const collection = await root.collection('collections').create({
			title: 'Private membership parent',
			isVisible: false,
			credits: [credit],
			coverImage: new File(
				[
					Uint8Array.from(
						atob(
							'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9X8AAAAASUVORK5CYII='
						),
						(c) => c.charCodeAt(0)
					)
				],
				'cover.png',
				{ type: 'image/png' }
			)
		});
		await root
			.collection('collectionUsers')
			.create({ collection: collection.id, userId: author.authStore.record!.id, role: 'owner' });
		const edition = await author.collection('editions').create({
			title: 'Private membership edition',
			collection: collection.id,
			credits: [credit]
		});
		const published = await root.collection('editions').create({
			title: 'Public credit query',
			status: 'published',
			isPublished: true,
			proposalPurpose: 'Confidential proposal argument',
			credits: [credit]
		});
		await root.collection('editionUsers').create({
			editionId: published.id,
			userId: author.authStore.record!.id,
			role: 'author'
		});
		const sandbox = await author.send('/api/pure3d/sandboxes', { method: 'POST', body: {} });
		try {
			const collectionMember = (
				await author.collection('collectionUsers').getFullList({
					filter: `collection = '${collection.id}'`
				})
			)[0];
			const editionMember = (
				await author.collection('editionUsers').getFullList({
					filter: `editionId = '${edition.id}'`
				})
			)[0];
			for (const client of [visitor, other]) {
				for (const [name, member] of [
					['collectionUsers', collectionMember],
					['editionUsers', editionMember]
				] as const) {
					await expect(client.collection(name).getOne(member.id)).rejects.toMatchObject({
						status: 404
					});
					expect(
						await client.collection(name).getFullList({ filter: `id = '${member.id}'` })
					).toHaveLength(0);
				}
			}
			for (const client of [visitor, other, admin])
				expect(
					await client.collection('editionUsers').getFullList({
						filter: `editionId = '${sandbox.id}'`
					})
				).toHaveLength(0);
			expect(
				await author.collection('editionUsers').getFullList({
					filter: `editionId = '${sandbox.id}'`
				})
			).toHaveLength(1);
			const url = author.files.getURL(collection, collection.coverImage);
			expect((await fetch(url)).status).toBe(403);
			const outsiderToken = await other.files.getToken();
			expect((await fetch(url + '?token=' + outsiderToken)).status).toBe(403);
			const ownerToken = await author.files.getToken();
			expect((await fetch(url + '?token=' + ownerToken)).status).toBe(200);
			await author.collection('collections').update(collection.id, { isVisible: true });
			expect((await fetch(url)).status).toBe(200);
			expect((await visitor.collection('collectionUsers').getOne(collectionMember.id)).id).toBe(
				collectionMember.id
			);
			expect(
				await visitor.collection('editionUsers').getFullList({
					filter: `editionId = '${published.id}'`
				})
			).toHaveLength(1);
			const publicData = await visitor.collection('editions').getOne(published.id);
			expect(publicData.proposalPurpose).toBeUndefined();
			for (const options of [
				{ filter: "proposalPurpose ~ 'Confidential'" },
				{ sort: 'proposalPurpose' },
				{ filter: "editionId.proposalPurpose ~ 'Confidential'" },
				{ filter: "@collection.editions.proposalPurpose ~ 'Confidential'" },
				{ sort: 'editionId.proposalSnapshot.title' },
				{ filter: `editionUsers_via_editionId.userId = '${author.authStore.record!.id}'` }
			]) {
				const name =
					options.filter?.startsWith('editionId.') || options.sort?.startsWith('editionId.')
						? 'editionUsers'
						: 'editions';
				for (const client of [visitor, admin])
					await expect(client.collection(name).getFullList(options)).rejects.toMatchObject({
						status: 403
					});
			}
			await expect(
				admin.collection('users').getFullList({
					filter: 'editionUsers_via_userId.editionId.isSandbox = true'
				})
			).rejects.toMatchObject({ status: 403 });
			expect(
				(
					await visitor.collection('editions').getFullList({
						filter: `isPublished = true && credits ~ '${credit.orcid}'`,
						sort: 'title'
					})
				).some((record) => record.id === published.id)
			).toBe(true);
			expect((await author.collection('editions').getOne(published.id)).proposalPurpose).toBe(
				'Confidential proposal argument'
			);
		} finally {
			await author.collection('editions').delete(sandbox.id);
			await root.collection('editions').delete(published.id);
			await root.collection('editions').delete(edition.id);
			await root.collection('collections').delete(collection.id);
		}
	}
);

integration(
	'contact throttles concurrent clients atomically without starving other clients',
	async () => {
		const settings = await root.settings.getAll();
		await root.settings.update({
			smtp: { enabled: true, host: 'smtp.invalid', port: 25 },
			trustedProxy: { headers: ['X-Test-Client-IP'], useLeftmostIP: true }
		});
		const send = (ip: string) =>
			fetch(origin + '/api/pure3d/contact', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-Test-Client-IP': ip },
				body: JSON.stringify({
					name: 'Visitor',
					email: 'visitor@example.test',
					subject: 'Throttle test',
					message: 'Hello.'
				})
			});
		try {
			const burst = await Promise.all(Array.from({ length: 12 }, () => send('192.0.2.1')));
			expect(burst.filter((response) => response.status === 200)).toHaveLength(1);
			expect(burst.filter((response) => response.status === 429)).toHaveLength(11);
			// The first client cannot starve another client by repeatedly consuming global tokens.
			expect((await send('192.0.2.2')).status).toBe(200);
			const globalBurst = await Promise.all(
				Array.from({ length: 12 }, (_, i) => send(`192.0.2.${i + 3}`))
			);
			expect(globalBurst.filter((response) => response.status === 200)).toHaveLength(8);
			expect(globalBurst.filter((response) => response.status === 429)).toHaveLength(4);
		} finally {
			await root.settings.update({ smtp: settings.smtp, trustedProxy: settings.trustedProxy });
		}
	}
);

integration('storage deletion fails closed even with matching inventory attributes', async () => {
	const published = await root.collection('editions').create({
		title: 'Storage deletion guard',
		status: 'published',
		isPublished: true,
		credits: [credit],
		sceneDocument: new File(['keep this object'], 'scene.json')
	});
	try {
		const key = `${published.collectionId}/${published.id}/${published.sceneDocument}`;
		const inventory = await admin.send('/api/pure3d/storage', {
			query: { prefix: `${published.collectionId}/${published.id}/` }
		});
		const object = inventory.objects.find((object: { key: string }) => object.key === key);
		expect(object).toBeDefined();
		await expect(
			admin.send('/api/pure3d/storage', {
				method: 'DELETE',
				query: { key, size: object.size, modified: object.modified }
			})
		).rejects.toMatchObject({ status: 501 });
		expect(await (await fetch(root.files.getURL(published, published.sceneDocument))).text()).toBe(
			'keep this object'
		);
	} finally {
		await root.collection('editions').delete(published.id);
	}
});

integration(
	'edition access reflects membership changes and rejects forged role-cache fields',
	async () => {
		const edition = await root.collection('editions').create({
			title: 'Membership access',
			status: 'draft',
			credits: [credit]
		});
		try {
			await root.collection('editionUsers').create({
				editionId: edition.id,
				userId: author.authStore.record!.id,
				role: 'author'
			});
			await author
				.collection('editions')
				.update(edition.id, {
					'@pbInternalPure3dRoles': JSON.stringify({
						userId: other.authStore.record!.id,
						access: { admin: true }
					})
				})
				.catch(() => undefined);
			await expect(other.collection('editions').getOne(edition.id)).rejects.toBeDefined();
			const membership = await root.collection('editionUsers').create({
				editionId: edition.id,
				userId: other.authStore.record!.id,
				role: 'collaborator'
			});
			expect((await other.collection('editions').getOne(edition.id)).id).toBe(edition.id);
			await root.collection('editionUsers').delete(membership.id);
			await expect(other.collection('editions').getOne(edition.id)).rejects.toBeDefined();
		} finally {
			await root.collection('editions').delete(edition.id);
		}
	}
);

integration(
	'bootstrap and synthetic superuser imports work with the enforcing hooks mounted',
	async () => {
		const socket = createServer();
		await new Promise<void>((done) => socket.listen(0, '127.0.0.1', done));
		const port = (socket.address() as { port: number }).port;
		await new Promise<void>((done) => socket.close(() => done()));
		const freshOrigin = 'http://127.0.0.1:' + port;
		const fresh = Bun.spawn(
			[
				binary!,
				'serve',
				'--http=127.0.0.1:' + port,
				'--dir=' + join(directory, 'bootstrap-data'),
				'--hooksDir=' + join(directory, 'hooks'),
				'--migrationsDir=' + join(directory, 'bootstrap-migrations')
			],
			{ env: { ORCID_ISSUER: issuer, PB_TEST_BOOTSTRAP_ONLY: '1' }, stdout: 'pipe', stderr: 'pipe' }
		);
		try {
			for (let i = 0; i < 100; i++) {
				try {
					if ((await fetch(freshOrigin + '/api/health')).ok) break;
				} catch {
					/* starting */
				}
				await Bun.sleep(50);
			}
			const root = new PocketBase(freshOrigin);
			await root
				.collection('_superusers')
				.authWithPassword('root@example.test', 'local-test-password-only');
			const bootstrap = Bun.spawn(
				[process.execPath, '--no-env-file', 'scripts/create-pocketbase-collections.ts'],
				{
					env: {
						POCKETBASE_URL: freshOrigin,
						POCKETBASE_ADMIN_EMAIL: 'root@example.test',
						POCKETBASE_ADMIN_PASSWORD: 'local-test-password-only'
					},
					stdout: 'pipe',
					stderr: 'pipe'
				}
			);
			const output = await new Response(bootstrap.stdout).text();
			const errors = await new Response(bootstrap.stderr).text();
			expect(errors).toBe('');
			expect(await bootstrap.exited).toBe(0);
			expect(output).toContain('Schema is ready');
			const existing = await root.collections.getOne('users');
			await root.collections.update('users', {
				fields: existing.fields.filter(
					(field) => !['pendingOrcid', 'orcidVerifiedAt'].includes(field.name)
				),
				indexes: existing.indexes.filter((index: string) => !index.includes('pendingOrcid')),
				otp: { enabled: true }
			});
			const legacyAdmin = await root.collection('users').create({
				email: 'legacy-admin@example.test',
				password: 'local-test-password-only',
				passwordConfirm: 'local-test-password-only',
				role: 'admin',
				nickname: 'Legacy admin'
			});
			const legacy = new PocketBase(freshOrigin);
			await legacy
				.collection('users')
				.authWithPassword('legacy-admin@example.test', 'local-test-password-only');
			const originalToken = legacy.authStore.token;
			const unpreparedReady = await fetch(freshOrigin + '/api/pure3d/orcid/ready');
			expect(unpreparedReady.status).toBe(503);
			expect((await unpreparedReady.json()).checks.schema).toBe(false);
			await expect(
				legacy.send('/api/pure3d/orcid/pending/' + legacyAdmin.id, {
					method: 'POST',
					body: { orcid }
				})
			).rejects.toMatchObject({ status: 400 });
			await expect(
				applyOrcidConfiguration(root, 'test-client', 'test-secret', environment)
			).rejects.toThrow('--prepare');
			const beforePrepare = await root.collections.getOne('users');
			const backupsBefore = await root.backups.getFullList();
			const preparation = Bun.spawn(
				[process.execPath, '--no-env-file', 'scripts/configure-orcid.ts', '--prepare'],
				{
					env: {
						POCKETBASE_URL: freshOrigin,
						POCKETBASE_ADMIN_EMAIL: 'root@example.test',
						POCKETBASE_ADMIN_PASSWORD: 'local-test-password-only'
					},
					stdout: 'pipe',
					stderr: 'pipe'
				}
			);
			const preparationOutput = await new Response(preparation.stdout).text();
			expect(await new Response(preparation.stderr).text()).toBe('');
			expect(await preparation.exited).toBe(0);
			expect(preparationOutput).toContain('Legacy login, tokens and API rules are unchanged');
			const afterPrepare = await root.collections.getOne('users');
			for (const key of [
				'passwordAuth',
				'otp',
				'mfa',
				'oauth2',
				'authRule',
				'manageRule',
				'listRule',
				'viewRule',
				'createRule',
				'updateRule',
				'deleteRule'
			])
				expect(afterPrepare[key]).toEqual(beforePrepare[key]);
			expect((await root.backups.getFullList()).filter((backup) => backup.size > 0)).toHaveLength(
				backupsBefore.length + 1
			);
			expect(
				(
					await fetch(freshOrigin + '/api/pure3d/orcid/config', {
						headers: { Authorization: originalToken }
					})
				).status
			).toBe(200);
			await expect(legacy.collection('users').authRefresh()).resolves.toBeDefined();
			await expect(
				applyOrcidConfiguration(root, 'test-client', 'test-secret', environment, {
					deferUnmapped: true
				})
			).rejects.toThrow('--onboarding-report');
			await expect(
				applyOrcidConfiguration(root, 'test-client', 'test-secret', environment, {
					deferUnmapped: true,
					onboardingReport: join(directory, 'no-admin.json')
				})
			).rejects.toThrow('global admin');
			await expect(stat(join(directory, 'no-admin.json'))).rejects.toBeDefined();
			const approved = await legacy.send('/api/pure3d/orcid/pending/' + legacyAdmin.id, {
				method: 'POST',
				body: { orcid }
			});
			expect(approved).toMatchObject({ pendingOrcid: orcid, orcidVerifiedAt: null });
			expect((await legacy.send('/api/pure3d/orcid/pending/' + legacyAdmin.id)).pendingOrcid).toBe(
				orcid
			);
			expect((await root.collection('users').getOne(legacyAdmin.id)).pendingOrcid).toBe(orcid);
			await expect(preflightPrivilegedAccounts(root, issuer)).resolves.toEqual([]);
			const user = await root.collection('users').create({
				email: 'synthetic-import@example.test',
				password: 'local-test-password-only',
				passwordConfirm: 'local-test-password-only',
				nickname: '  Imported name  ',
				role: 'user'
			});
			expect(user.nickname).toBe('  Imported name  ');
			expect(user.orcidVerifiedAt).toBe('');
			await expect(
				root.collection('users').create({
					email: 'forged@example.test',
					password: 'local-test-password-only',
					passwordConfirm: 'local-test-password-only',
					orcid,
					orcidVerifiedAt: new Date().toISOString()
				})
			).rejects.toBeDefined();
			const unresolved = {
				type: 'person',
				name: '  Preserved  credit\n',
				orcid: null,
				role: 'creator',
				provenance: 'manual',
				contributionRole: '  Research  '
			};
			const credits = [unresolved, { ...unresolved, name: 'Middle' }, unresolved];
			const collection = await root.collection('collections').create({
				title: 'Imported draft collection',
				credits,
				__pure3dCreator: author.authStore.record!.id
			});
			const edition = await root.collection('editions').create({
				title: 'Imported draft edition',
				collection: collection.id,
				status: 'draft',
				credits,
				__pure3dCreator: author.authStore.record!.id
			});
			expect(edition.credits).toEqual(credits);
			expect((await root.collection('editions').getOne(edition.id)).credits).toEqual(credits);
			expect(
				await root.collection('editionUsers').getFullList({ filter: `editionId = '${edition.id}'` })
			).toHaveLength(0);
			expect(
				await root
					.collection('collectionUsers')
					.getFullList({ filter: `collection = '${collection.id}'` })
			).toHaveLength(0);
			await expect(
				root.collection('editions').update(edition.id, { status: 'concept_submitted' })
			).rejects.toBeDefined();
			const publishedCredits = credits.map((value) => ({ ...value, orcid }));
			const published = await root.collection('editions').create({
				title: 'Imported known public attribution',
				isPublished: true,
				status: 'published',
				credits: publishedCredits,
				dcCreator: credits.map((value) => value.name)
			});
			expect((await root.collection('editions').getOne(published.id)).credits).toEqual(
				publishedCredits
			);
			await expect(
				root.collection('editions').update(published.id, { dcInstitution: ['Updated institution'] })
			).rejects.toBeDefined(); // Published editions are immutable, including metadata.
			expect(
				await root
					.collection('editionUsers')
					.getFullList({ filter: `editionId = '${published.id}'` })
			).toHaveLength(0);
			// Synthetic equivalents only: preserve 66 unmapped accounts and their exact access intent.
			const deferredIds = [];
			for (let i = 0; i < 66; i++) {
				const account = await root.collection('users').create({
					email: `deferred-${i}@example.test`,
					password: 'local-test-password-only',
					passwordConfirm: 'local-test-password-only',
					role: ['admin', 'editorial_board', 'user'][i % 3]
				});
				deferredIds.push(account.id);
				await root.collection('editionUsers').create({
					editionId: edition.id,
					userId: account.id,
					role: 'collaborator'
				});
			}
			const deferredLogin = new PocketBase(freshOrigin);
			await deferredLogin
				.collection('users')
				.authWithPassword('deferred-0@example.test', 'local-test-password-only');
			const beforeUsers = await root.collection('users').getFullList({ sort: 'id' });
			const beforeMembers = await root.collection('editionUsers').getFullList({ sort: 'id' });
			await expect(
				applyOrcidConfiguration(root, 'test-client', 'test-secret', environment)
			).rejects.toThrow('privileged account');
			const reportPath = join(directory, 'cutover-onboarding.json');
			await writeFile(reportPath, 'do not overwrite', { mode: 0o600 });
			await expect(
				applyOrcidConfiguration(root, 'test-client', 'test-secret', environment, {
					deferUnmapped: true,
					onboardingReport: reportPath
				})
			).rejects.toThrow();
			expect(await readFile(reportPath, 'utf8')).toBe('do not overwrite');
			await rm(reportPath);
			const definitionBeforeFailure = await root.collections.getOne('users');
			const createBackup = root.backups.create.bind(root.backups);
			root.backups.create = async (backupId) => {
				const report = JSON.parse(await readFile(reportPath, 'utf8'));
				expect(report.backupId).toBe(backupId);
				expect(report.accounts).toHaveLength(66);
				expect((await stat(reportPath)).mode & 0o777).toBe(0o600);
				throw new Error('Synthetic backup failure after durable report');
			};
			try {
				await expect(
					applyOrcidConfiguration(root, 'test-client', 'test-secret', environment, {
						deferUnmapped: true,
						onboardingReport: reportPath
					})
				).rejects.toThrow('Synthetic backup failure');
				expect(await root.collections.getOne('users')).toEqual(definitionBeforeFailure);
			} finally {
				root.backups.create = createBackup;
			}
			// Each attempt keeps its own immutable private report, including failed attempts.
			const failedReport = reportPath;
			const successReport = reportPath + '.success';
			const cutover = Bun.spawn(
				[
					process.execPath,
					'--no-env-file',
					'scripts/configure-orcid.ts',
					'--apply',
					'--defer-unmapped',
					'--onboarding-report',
					successReport
				],
				{
					env: {
						POCKETBASE_URL: freshOrigin,
						POCKETBASE_ADMIN_EMAIL: 'root@example.test',
						POCKETBASE_ADMIN_PASSWORD: 'local-test-password-only',
						ORCID_CLIENT_ID: 'test-client',
						ORCID_CLIENT_SECRET: 'test-secret',
						ORCID_ENVIRONMENT: environment
					},
					stdout: 'pipe',
					stderr: 'pipe'
				}
			);
			const cutoverErrors = await new Response(cutover.stderr).text();
			expect(cutoverErrors).toBe('');
			expect(await cutover.exited).toBe(0);
			const report = JSON.parse(await readFile(successReport, 'utf8'));
			expect((await stat(successReport)).mode & 0o777).toBe(0o600);
			expect(JSON.parse(await readFile(failedReport, 'utf8')).backupId).not.toBe(report.backupId);
			expect(report).toMatchObject({
				target: freshOrigin,
				backupStatus: 'confirmation_required',
				operatorId: root.authStore.record!.id,
				operatorChoice: 'defer-unmapped-preserve-roles-disable-login',
				status: 'preflight_confirmed'
			});
			expect(report.accounts.map((account: { id: string }) => account.id).sort()).toEqual(
				deferredIds.sort()
			);
			for (const account of report.accounts) {
				expect(account.status).toBe('require_identity_linking');
				expect(account.orcidCandidates).toEqual([]);
				expect(account.requestedRole).toBe(
					beforeUsers.find((user) => user.id === account.id)!.role
				);
				expect(account.memberships).toMatchObject([
					{ source: 'editionUsers', role: 'collaborator', editionId: edition.id }
				]);
			}
			expect(
				(await root.backups.getFullList()).some(
					(backup) => backup.key === report.backupId && backup.size > 0
				)
			).toBe(true);
			expect(await root.collection('users').getFullList({ sort: 'id' })).toEqual(beforeUsers);
			expect(await root.collection('editionUsers').getFullList({ sort: 'id' })).toEqual(
				beforeMembers
			);
			for (const token of [originalToken, deferredLogin.authStore.token]) {
				expect(
					(
						await fetch(freshOrigin + '/api/collections/users/auth-refresh', {
							method: 'POST',
							headers: { Authorization: token }
						})
					).status
				).toBe(401);
			}
			await expect(
				deferredLogin
					.collection('users')
					.authWithPassword('deferred-0@example.test', 'local-test-password-only')
			).rejects.toBeDefined();
		} finally {
			fresh.kill();
			await fresh.exited;
		}
	},
	30000
);

integration('protected user fields and role cannot be assigned via CRUD', async () => {
	for (const patch of [
		{ role: 'admin' },
		{ orcid },
		{ orcidVerifiedAt: new Date().toISOString() },
		{ nickname: 'Spoof' },
		{ affiliation: 'Spoof' },
		{ socials: 'https://spoof.test' }
	])
		await expect(
			other.collection('users').update(other.authStore.record!.id, patch)
		).rejects.toBeDefined();
	await expect(
		other.collection('users').create({
			email: 'spoof@example.test',
			password: 'test-password-only',
			passwordConfirm: 'test-password-only',
			role: 'admin'
		})
	).rejects.toBeDefined();
	await expect(
		admin.collection('users').update(other.authStore.record!.id, { role: 'editorial_board' })
	).resolves.toBeDefined();
	await admin.collection('users').update(other.authStore.record!.id, { role: 'user' });
});

integration('initial edition author is atomic, verified and not caller-supplied', async () => {
	await expect(other.collection('editions').create({ title: 'Unverified' })).rejects.toBeDefined();
	const edition = await author
		.collection('editions')
		.create({ title: 'Atomic draft', __pure3dCreator: other.authStore.record!.id });
	const memberships = await author
		.collection('editionUsers')
		.getFullList({ filter: `editionId = '${edition.id}'` });
	expect(memberships).toHaveLength(1);
	expect(memberships[0]).toMatchObject({
		role: 'author',
		userId: author.authStore.record!.id,
		user: author.authStore.record!.id,
		edition: edition.id
	});
	await expect(
		author.collection('editions').create({ title: 'force-membership-failure' })
	).rejects.toBeDefined();
	expect(
		await root.collection('editions').getFullList({ filter: "title = 'force-membership-failure'" })
	).toHaveLength(0);
	const collection = await admin.collection('collections').create({ title: 'Owned collection' });
	expect(
		await admin
			.collection('collectionUsers')
			.getFullList({ filter: `collection = '${collection.id}'` })
	).toMatchObject([{ role: 'owner', userId: admin.authStore.record!.id }]);
});

integration(
	'draft visibility, credits, membership authorization and workflow enforced',
	async () => {
		const edition = await author.collection('editions').create({
			title: 'Attribution',
			credits: [{ ...credit, provenance: 'manual', userId: undefined, orcid: null }]
		});
		await expect(other.collection('editions').getOne(edition.id)).rejects.toBeDefined();
		await expect(
			other.collection('editions').update(edition.id, { title: 'Hijacked' })
		).rejects.toBeDefined();
		await expect(
			other
				.collection('editionUsers')
				.create({ editionId: edition.id, userId: other.authStore.record!.id, role: 'author' })
		).rejects.toBeDefined();
		await expect(
			author.collection('editions').update(edition.id, { status: 'concept_submitted' })
		).rejects.toBeDefined();
		await expect(
			author.collection('editions').update(edition.id, { isPublished: true })
		).rejects.toBeDefined();
		await expect(
			author
				.collection('editions')
				.update(edition.id, { credits: [{ ...credit, userId: other.authStore.record!.id }] })
		).rejects.toBeDefined();
		await author.collection('editions').update(edition.id, { credits: [credit] });
		await expect(
			author.collection('editions').update(edition.id, {
				status: 'concept_submitted',
				...proposalPayload()
			})
		).resolves.toMatchObject({ status: 'concept_submitted', isPublished: false });
		await expect(
			author.collection('editions').update(edition.id, { proposalPurpose: 'Changed after submit.' })
		).rejects.toBeDefined();
		await expect(
			author.collection('editions').update(edition.id, { status: 'published' })
		).rejects.toBeDefined();
		await expect(
			admin
				.collection('editionUsers')
				.create({ editionId: edition.id, userId: other.authStore.record!.id, role: 'author' })
		).rejects.toBeDefined();
		await expect(
			admin
				.collection('editionUsers')
				.create({ editionId: edition.id, userId: author.authStore.record!.id, role: 'author' })
		).rejects.toBeDefined();
	}
);

integration('proposal round-trip, model groups, private files and submission locks', async () => {
	const selectedCall = await root.collection('open_calls').create({
		title: 'Material histories',
		deadline: '2099-11-13 00:00:00.000Z',
		isPublished: true
	});
	expect((await root.collection('open_calls').getOne(selectedCall.id)).isPublished).toBe(true);
	expect((await author.collection('open_calls').getOne(selectedCall.id)).id).toBe(selectedCall.id);
	const unpublishedCall = await root.collection('open_calls').create({
		title: 'Unpublished call',
		isPublished: false
	});
	const expiredCall = await root.collection('open_calls').create({
		title: 'Expired call',
		deadline: '2000-01-01 00:00:00.000Z',
		isPublished: true
	});
	let edition = await author
		.collection('editions')
		.create({ title: 'Proposal round-trip', credits: [credit] });
	await author
		.collection('editionUsers')
		.create({ editionId: edition.id, userId: other.authStore.record!.id, role: 'collaborator' });
	await expect(
		author
			.collection('editions')
			.update(edition.id, { proposalSubmittedAt: new Date().toISOString() })
	).rejects.toBeDefined();
	await expect(
		author.collection('editions').update(edition.id, { proposalSnapshot: { title: 'Spoof' } })
	).rejects.toBeDefined();
	await expect(
		author.collection('editions').update(edition.id, {
			...proposalPayload(),
			proposalPurpose: '',
			status: 'concept_submitted'
		})
	).rejects.toBeDefined();
	expect((await author.collection('editions').getOne(edition.id)).status).toBe('draft');
	await author.collection('editions').update(edition.id, {
		...proposalPayload(),
		proposalPurpose: 'Saved draft',
		proposalOpenCall: selectedCall.id
	});
	expect((await author.collection('editions').getOne(edition.id)).proposalPurpose).toBe(
		'Saved draft'
	);
	expect((await author.collection('editions').getOne(edition.id)).proposalOpenCall).toBe(
		selectedCall.id
	);
	for (const proposalOpenCall of [unpublishedCall.id, expiredCall.id])
		await expect(
			author.collection('editions').update(edition.id, { proposalOpenCall })
		).rejects.toBeDefined();
	const form = new FormData();
	form.append('proposalModelFiles+', new File(['{"asset":{"version":"2.0"}}'], 'first.gltf'));
	form.append('proposalModelAssets+', new File(['companion'], 'first.bin'));
	form.append('proposalSupportingFiles+', new File(['Research evidence'], 'evidence.txt'));
	edition = await author.collection('editions').update(edition.id, form);
	expect(edition.proposalModels).toHaveLength(1);
	expect(edition.proposalModels[0]).toMatchObject({
		file: edition.proposalModelFiles[0],
		assets: edition.proposalModelAssets
	});
	const second = new FormData();
	second.append('proposalModelFiles+', new File(['{"asset":{"version":"2.0"}}'], 'second.gltf'));
	edition = await author.collection('editions').update(edition.id, second);
	expect(edition.proposalModels).toHaveLength(2);
	const model = edition.proposalModels[1];
	edition = await author
		.collection('editions')
		.update(edition.id, { 'proposalModelFiles-': [model.file] });
	expect(edition.proposalModels).toHaveLength(1);
	const file = edition.proposalSupportingFiles[0];
	expect((await fetch(author.files.getURL(edition, file))).ok).toBe(false);
	const token = await author.files.getToken();
	const download = await fetch(author.files.getURL(edition, file, { token }));
	expect({ status: download.status, body: await download.text() }).toEqual({
		status: 200,
		body: 'Research evidence'
	});
	await expect(
		author.collection('editions').update(edition.id, {
			status: 'concept_submitted',
			proposalSupportingLinks: ['javascript:alert(1)']
		})
	).rejects.toBeDefined();
	edition = await author.collection('editions').update(edition.id, {
		...proposalPayload(),
		status: 'concept_submitted',
		proposalHasExistingModel: true,
		proposalModelSources: ['photogrammetry'],
		proposalCopyrightOwnership: 'We own the models.'
	});
	expect(edition.isPublished).toBe(false);
	expect(edition.proposalSubmittedAt).toBeTruthy();
	expect(edition.proposalSnapshot).toMatchObject({
		title: 'Proposal round-trip',
		credits: [credit],
		openCall: {
			id: selectedCall.id,
			title: 'Material histories',
			deadline: selectedCall.deadline
		}
	});
	await root.collection('open_calls').update(selectedCall.id, {
		isPublished: false,
		title: 'Renamed closed call',
		deadline: '2000-01-01 00:00:00.000Z'
	});
	expect((await author.collection('editions').getOne(edition.id)).proposalOpenCall).toBe(
		selectedCall.id
	);
	for (const client of [author, other]) {
		for (const body of [
			{ title: 'Locked' },
			{ credits: [] },
			{ proposalPurpose: 'Locked' },
			{ proposalOpenCall: '' },
			{ 'proposalModelFiles-': edition.proposalModelFiles },
			{ 'proposalSupportingFiles-': [file] },
			{ status: 'draft' }
		])
			await expect(client.collection('editions').update(edition.id, body)).rejects.toBeDefined();
	}
	await admin.collection('editions').update(edition.id, { status: 'editorial_review' });
	await admin.collection('editions').update(edition.id, { status: 'concept_rejected' });
	await author.collection('editions').update(edition.id, { status: 'draft' });
	edition = await author
		.collection('editions')
		.update(edition.id, { proposalPurpose: 'Revised after the call closed.' });
	edition = await author.collection('editions').update(edition.id, {
		...proposalPayload(),
		proposalPurpose: 'Revised after the call closed.',
		status: 'concept_submitted'
	});
	expect(edition.proposalSnapshot.openCall).toMatchObject({
		id: selectedCall.id,
		title: 'Material histories',
		deadline: selectedCall.deadline
	});
	expect(
		(await other.collection('editions').getOne(edition.id)).proposalSnapshot.openCall.title
	).toBe('Material histories');
	await admin.collection('editions').update(edition.id, { status: 'editorial_review' });
	await admin.collection('editions').update(edition.id, { status: 'concept_accepted' });
	await author.collection('editions').update(edition.id, { title: 'Edition development' });
	expect((await author.collection('editions').getOne(edition.id)).proposalSnapshot.title).toBe(
		'Proposal round-trip'
	);
	const general = await author
		.collection('editions')
		.create({ title: 'General proposal', credits: [credit] });
	const generalSubmitted = await author.collection('editions').update(general.id, {
		...proposalPayload(),
		status: 'concept_submitted'
	});
	expect(generalSubmitted.proposalOpenCall).toBe('');
	expect(generalSubmitted.proposalSnapshot.openCall).toBeNull();
	const closingCall = await root
		.collection('open_calls')
		.create({ title: 'Closing call', isPublished: true });
	const lateDraft = await author.collection('editions').create({
		title: 'Saved before deadline',
		credits: [credit],
		proposalOpenCall: closingCall.id
	});
	await root
		.collection('open_calls')
		.update(closingCall.id, { deadline: '2000-01-01 00:00:00.000Z' });
	await expect(
		author
			.collection('editions')
			.update(lateDraft.id, { ...proposalPayload(), status: 'concept_submitted' })
	).rejects.toBeDefined();
	expect((await author.collection('editions').getOne(lateDraft.id)).status).toBe('draft');
	const recovered = await author.collection('editions').update(lateDraft.id, {
		...proposalPayload(),
		proposalOpenCall: '',
		status: 'concept_submitted'
	});
	expect(recovered.proposalSnapshot.openCall).toBeNull();
	await root.collection('editions').delete(lateDraft.id);
	await root.collection('editions').delete(general.id);
	await root.collection('editions').delete(edition.id);
});

integration(
	'administrative workflow overrides waive only legacy creator ORCID readiness and isolate review rounds',
	async () => {
		const credits = [
			{
				type: 'person',
				name: 'Legacy creator',
				orcid: null,
				role: 'creator',
				provenance: 'manual'
			}
		];
		const collection = await root.collection('collections').create({
			title: 'Legacy parent collection',
			credits
		});
		const edition = await root.collection('editions').create({
			title: 'Legacy administrative intervention',
			status: 'draft',
			collection: collection.id,
			credits
		});
		const endpoint = `/api/pure3d/editions/${edition.id}/admin-workflow-override`;
		const override = (status: string, expectedStatus: string, reason: string, extra = {}) =>
			admin.send(endpoint, { method: 'POST', body: { status, expectedStatus, reason, ...extra } });
		try {
			await expect(
				other.send(endpoint, {
					method: 'POST',
					body: {
						status: 'concept_submitted',
						expectedStatus: 'draft',
						reason: 'Unauthorized test.'
					}
				})
			).rejects.toBeDefined();
			await expect(override('concept_submitted', 'draft', '')).rejects.toBeDefined();
			expect((await root.collection('editions').getOne(edition.id)).status).toBe('draft');
			expect(
				await root
					.collection('auditLog')
					.getFullList({ filter: `targetId = "${edition.id}" && action = "workflow_override"` })
			).toHaveLength(0);
			await expect(
				admin.collection('editions').update(edition.id, { status: 'concept_submitted' })
			).rejects.toBeDefined();
			expect((await root.collection('editions').getOne(edition.id)).status).toBe('draft');

			await override(
				'concept_submitted',
				'draft',
				'Legacy attribution predates ORCID onboarding.',
				{
					credits: []
				}
			);
			expect((await root.collection('editions').getOne(edition.id)).credits).toEqual(credits);
			expect((await root.collection('collections').getOne(collection.id)).credits).toEqual(credits);
			await override(
				'editorial_review',
				'concept_submitted',
				'Editor is taking over the legacy proposal.'
			);
			await override('concept_accepted', 'editorial_review', 'Editorial exception is documented.');
			let started = await override(
				'alpha_review',
				'concept_accepted',
				'Start an audited Alpha round for the legacy record.'
			);
			expect(started).toMatchObject({ status: 'alpha_review', alphaReviewRound: 1 });
			await expect(
				override('alpha_accepted', 'concept_accepted', 'The modal state is deliberately stale.')
			).rejects.toBeDefined();
			expect((await root.collection('editions').getOne(edition.id)).status).toBe('alpha_review');
			const firstInvitation = await admin.collection('reviewAssignments').create({
				editionId: edition.id,
				reviewerId: other.authStore.record!.id,
				reviewStage: 2,
				status: 'pending'
			});
			expect(firstInvitation.reviewRound).toBe(1);
			await override(
				'alpha_accepted',
				'alpha_review',
				'Close this exceptional round without a decision.'
			);
			started = await override(
				'alpha_review',
				'alpha_accepted',
				'Reopen as a distinct, audited Alpha round.'
			);
			expect(started).toMatchObject({ status: 'alpha_review', alphaReviewRound: 2 });
			expect(await admin.send(`/api/pure3d/editions/${edition.id}/alpha-progress`)).toMatchObject({
				round: 2,
				total: 0,
				submitted: 0
			});
			await override(
				'alpha_accepted',
				'alpha_review',
				'Complete the second exceptional Alpha round.'
			);
			started = await override(
				'final_review',
				'alpha_accepted',
				'Start an audited Final Review round.'
			);
			expect(started).toMatchObject({ status: 'final_review', finalReviewRound: 1 });
			const firstFinalInvitation = await admin.collection('reviewAssignments').create({
				editionId: edition.id,
				reviewerId: other.authStore.record!.id,
				reviewStage: 3,
				status: 'pending'
			});
			expect(firstFinalInvitation.reviewRound).toBe(1);
			await override(
				'final_accepted',
				'final_review',
				'Close this exceptional Final Review round.'
			);
			started = await override(
				'final_review',
				'final_accepted',
				'Reopen as a distinct, audited Final Review round.'
			);
			expect(started).toMatchObject({ status: 'final_review', finalReviewRound: 2 });
			expect(await admin.send(`/api/pure3d/editions/${edition.id}/final-progress`)).toMatchObject({
				round: 2,
				total: 0,
				submitted: 0
			});
			await override(
				'final_accepted',
				'final_review',
				'Complete the second exceptional Final Review.'
			);
			await override(
				'publication_requested',
				'final_accepted',
				'Escalate for normal publication confirmation.'
			);
			const audit = await root
				.collection('auditLog')
				.getFullList({ filter: `targetId = "${edition.id}" && action = "workflow_override"` });
			expect(audit).toHaveLength(12);
			expect(audit.find((entry) => entry.details?.to === 'alpha_review')).toMatchObject({
				performedBy: 'users/' + admin.authStore.record!.id,
				details: {
					from: 'concept_accepted',
					to: 'alpha_review',
					reason: 'Start an audited Alpha round for the legacy record.'
				}
			});
			await expect(
				override(
					'published',
					'publication_requested',
					'Publishing must use publication confirmation.'
				)
			).rejects.toBeDefined();
			const afterFailure = await root.collection('editions').getOne(edition.id);
			expect(afterFailure).toMatchObject({
				status: 'publication_requested',
				alphaReviewRound: 2,
				finalReviewRound: 2,
				isPublished: false,
				peerReviewStamp: false
			});
			expect(
				await root
					.collection('auditLog')
					.getFullList({ filter: `targetId = "${edition.id}" && action = "workflow_override"` })
			).toHaveLength(12);
		} finally {
			await root.collection('editions').delete(edition.id);
			await root.collection('collections').delete(collection.id);
		}
	}
);

integration(
	'Alpha draft, confidential submission, editorial release and a second round',
	async () => {
		let edition = await author
			.collection('editions')
			.create({ title: 'Alpha edition', credits: [credit] });
		const secondUser = await root.collection('users').create({
			email: 'alpha-second@example.test',
			password: 'local-test-password-only',
			passwordConfirm: 'local-test-password-only',
			role: 'user'
		});
		const second = new PocketBase(origin);
		await second
			.collection('users')
			.authWithPassword('alpha-second@example.test', 'local-test-password-only');
		try {
			await author
				.collection('editions')
				.update(edition.id, { ...proposalPayload(), status: 'concept_submitted' });
			await admin.collection('editions').update(edition.id, { status: 'editorial_review' });
			await admin.collection('editions').update(edition.id, { status: 'concept_accepted' });
			const context = {
				ready: 'The scene and interpretation.',
				focus: 'The research argument.',
				workInProgress: 'Audio commentary.'
			};
			await expect(
				author
					.collection('editions')
					.update(edition.id, { status: 'alpha_review', alphaRequest: context })
			).rejects.toBeDefined();
			const files = new FormData();
			files.append(
				'sceneDocument',
				new File(
					[
						'{"asset":{"type":"application/si-dpo-3d.document+json","version":"1.0"},"scene":0,"scenes":[{"nodes":[]}]}'
					],
					'scene.svx.json'
				)
			);
			await author.collection('editions').update(edition.id, files);
			edition = await author
				.collection('editions')
				.update(edition.id, { status: 'alpha_review', alphaRequest: context });
			expect(edition).toMatchObject({
				status: 'alpha_review',
				alphaReviewRound: 1,
				isPublished: false
			});
			for (const client of [author, admin])
				await expect(
					client.collection('editions').update(edition.id, { dcAbstract: 'Changed while reviewed' })
				).rejects.toBeDefined();
			await expect(
				admin.collection('reviewAssignments').create({
					editionId: edition.id,
					reviewerId: author.authStore.record!.id,
					assignedBy: admin.authStore.record!.id,
					reviewStage: 2,
					status: 'pending'
				})
			).rejects.toBeDefined();
			const assignment = await admin.collection('reviewAssignments').create({
				editionId: edition.id,
				reviewerId: other.authStore.record!.id,
				assignedBy: admin.authStore.record!.id,
				reviewStage: 2,
				status: 'pending'
			});
			expect(assignment.reviewRound).toBe(1);
			const secondAssignment = await admin.collection('reviewAssignments').create({
				editionId: edition.id,
				reviewerId: secondUser.id,
				reviewStage: 2,
				status: 'pending'
			});
			expect((await other.collection('editions').getOne(edition.id)).id).toBe(edition.id);
			const token = await other.files.getToken();
			expect(
				(await fetch(other.files.getURL(edition, edition.sceneDocument, { token }))).status
			).toBe(200);
			const draft = await other.collection('editionReviews').create({
				editionId: edition.id,
				reviewerId: other.authStore.record!.id,
				reviewStage: 2,
				reviewStatus: 'draft',
				technicalComments: 'Saved partial draft'
			});
			expect((await other.collection('editionReviews').getOne(draft.id)).technicalComments).toBe(
				'Saved partial draft'
			);
			expect(
				await author
					.collection('editionReviews')
					.getFullList({ filter: `editionId = "${edition.id}"` })
			).toHaveLength(0);
			expect(
				await author
					.collection('reviewAssignments')
					.getFullList({ filter: `editionId = "${edition.id}"` })
			).toHaveLength(0);
			await expect(
				other.collection('editionReviews').update(draft.id, { reviewStatus: 'submitted' })
			).rejects.toBeDefined();
			const endpoint = `/api/pure3d/editions/${edition.id}`;
			await expect(
				admin.send(endpoint + '/alpha-decision', { method: 'POST', body: { decision: 'accept' } })
			).rejects.toBeDefined();
			const submitted = await other.collection('editionReviews').update(draft.id, {
				reviewStatus: 'submitted',
				technicalComments: 'The scene loads.',
				valueRating: 4,
				valueExplanation: 'The methods and sources are clear.',
				experienceComments: 'The interface is usable.',
				generalComments: 'Please refine the introduction.',
				decision: 'request_revisions',
				recommendationExplanation: 'PRIVATE editor explanation',
				collaborationInterest: 'yes'
			});
			expect(submitted.submittedAt).toBeTruthy();
			expect((await other.collection('reviewAssignments').getOne(assignment.id)).status).toBe(
				'completed'
			);
			await expect(
				other.collection('editionReviews').update(draft.id, { generalComments: 'Changed' })
			).rejects.toBeDefined();
			await expect(other.collection('editions').getOne(edition.id)).rejects.toBeDefined();
			expect(
				(await fetch(other.files.getURL(edition, edition.sceneDocument, { token }))).status
			).toBe(403);
			await expect(
				other.collection('editions').update(edition.id, { status: 'alpha_accepted' })
			).rejects.toBeDefined();
			await expect(
				admin.collection('editions').update(edition.id, { status: 'alpha_accepted' })
			).rejects.toBeDefined();
			expect(await author.send(endpoint + '/alpha-progress')).toMatchObject({
				submitted: 1,
				total: 2,
				released: false,
				feedback: []
			});
			await expect(
				admin.send(endpoint + '/alpha-decision', { method: 'POST', body: { decision: 'accept' } })
			).rejects.toBeDefined();
			await second
				.collection('reviewAssignments')
				.update(secondAssignment.id, { status: 'declined' });
			await expect(second.collection('editions').getOne(edition.id)).rejects.toBeDefined();
			expect(await author.send(endpoint + '/alpha-progress')).toMatchObject({
				submitted: 1,
				total: 1
			});
			await expect(
				author.send(endpoint + '/alpha-decision', { method: 'POST', body: { decision: 'accept' } })
			).rejects.toBeDefined();
			await expect(
				admin.send(endpoint + '/alpha-decision', {
					method: 'POST',
					body: { decision: 'revisions' }
				})
			).rejects.toBeDefined();
			await admin
				.collection('reviewAssignments')
				.update(secondAssignment.id, { status: 'pending' });
			await second.collection('editionReviews').create({
				editionId: edition.id,
				reviewerId: secondUser.id,
				reviewStage: 2,
				...alphaAnswersPayload()
			});
			await admin.send(endpoint + '/alpha-decision', {
				method: 'POST',
				body: { decision: 'revisions' }
			});
			const progress = await author.send(endpoint + '/alpha-progress');
			expect(progress).toMatchObject({
				released: true,
				feedback: [
					{
						reviewer: 'Reviewer A',
						valueRating: 4,
						generalComments: 'Please refine the introduction.'
					},
					{ reviewer: 'Reviewer B' }
				]
			});
			expect(JSON.stringify(progress)).not.toContain('PRIVATE');
			expect(JSON.stringify(progress)).not.toContain(other.authStore.record!.id);
			expect(JSON.stringify(progress)).not.toContain('collaborationInterest');
			await expect(
				author.collection('editions').getList(1, 10, {
					filter: 'editionReviews_via_editionId.recommendationExplanation ~ "PRIVATE"'
				})
			).rejects.toBeDefined();
			await expect(
				author.collection('users').getList(1, 10, {
					filter: `reviewAssignments_via_reviewerId.editionId = "${edition.id}"`
				})
			).rejects.toBeDefined();
			await author
				.collection('editions')
				.update(edition.id, { dcAbstract: 'Revised introduction' });
			edition = await author
				.collection('editions')
				.update(edition.id, { status: 'alpha_review', alphaRequest: context });
			expect(edition.alphaReviewRound).toBe(2);
			expect(await author.send(endpoint + '/alpha-progress')).toMatchObject({
				submitted: 0,
				total: 0,
				released: false
			});
			await expect(other.collection('editions').getOne(edition.id)).rejects.toBeDefined();
			const invitedAgain = await admin.collection('reviewAssignments').create({
				editionId: edition.id,
				reviewerId: other.authStore.record!.id,
				assignedBy: admin.authStore.record!.id,
				reviewStage: 2,
				status: 'pending'
			});
			expect(invitedAgain.reviewRound).toBe(2);
			expect((await other.collection('editions').getOne(edition.id)).id).toBe(edition.id);
			await other.collection('editionReviews').create({
				editionId: edition.id,
				reviewerId: other.authStore.record!.id,
				reviewStage: 2,
				...alphaAnswersPayload()
			});
			await admin.collection('reviewAssignments').create({
				editionId: edition.id,
				reviewerId: secondUser.id,
				reviewStage: 2,
				status: 'pending'
			});
			await second.collection('editionReviews').create({
				editionId: edition.id,
				reviewerId: secondUser.id,
				reviewStage: 2,
				...alphaAnswersPayload()
			});
			await admin.send(endpoint + '/alpha-decision', {
				method: 'POST',
				body: { decision: 'accept' }
			});
			expect((await author.collection('editions').getOne(edition.id)).status).toBe(
				'alpha_accepted'
			);
		} finally {
			await root.collection('editions').delete(edition.id);
			await root.collection('users').delete(secondUser.id);
		}
	}
);

integration(
	'complete publication workflow enforces two reviews, consent, locks and anonymous public feedback',
	async () => {
		const edition = await author
			.collection('editions')
			.create({ title: 'Complete workflow', credits: [credit] });
		const user = await root.collection('users').create({
			email: 'publication-second@example.test',
			password: 'local-test-password-only',
			passwordConfirm: 'local-test-password-only',
			role: 'user',
			nickname: 'Named reviewer'
		});
		const second = new PocketBase(origin);
		await second
			.collection('users')
			.authWithPassword('publication-second@example.test', 'local-test-password-only');
		const endpoint = `/api/pure3d/editions/${edition.id}`;
		try {
			await author
				.collection('editions')
				.update(edition.id, { ...proposalPayload(), status: 'concept_submitted' });
			await admin.collection('editions').update(edition.id, { status: 'editorial_review' });
			await admin.collection('editions').update(edition.id, { status: 'concept_accepted' });
			await requestAlpha(edition.id);
			for (const reviewer of [other, second]) {
				await admin.collection('reviewAssignments').create({
					editionId: edition.id,
					reviewerId: reviewer.authStore.record!.id,
					reviewStage: 2,
					status: 'pending'
				});
				await reviewer.collection('editionReviews').create({
					editionId: edition.id,
					reviewerId: reviewer.authStore.record!.id,
					reviewStage: 2,
					...alphaAnswersPayload()
				});
				if (reviewer === other)
					await expect(
						admin.send(endpoint + '/alpha-decision', {
							method: 'POST',
							body: { decision: 'accept' }
						})
					).rejects.toBeDefined();
			}
			await admin.send(endpoint + '/alpha-decision', {
				method: 'POST',
				body: { decision: 'accept' }
			});
			const finalRequest = {
				changes: 'Implemented the Alpha suggestions.',
				notImplemented: 'Retained original scale for accuracy.',
				comment: 'Ready.'
			};
			await expect(
				author.collection('editions').update(edition.id, { status: 'final_review', finalRequest })
			).rejects.toBeDefined();
			await author.collection('editions').update(edition.id, {
				dcAbstract: '<p>Research description</p>',
				dcLanguage: 'English',
				dcRightsLicense: 'CC BY 4.0',
				peerReviewRequested: true,
				finalRequest
			});
			const submittedEdition = await author
				.collection('editions')
				.update(edition.id, { status: 'final_review' });
			expect(submittedEdition.finalReviewRound).toBe(1);
			await expect(
				author.collection('editions').update(edition.id, { title: 'Locked' })
			).rejects.toBeDefined();
			await expect(
				admin.collection('editions').update(edition.id, { status: 'published' })
			).rejects.toBeDefined();
			await admin.send(endpoint + '/final-invitations', {
				method: 'POST',
				body: { dueAt: '2099-01-01T00:00:00Z' }
			});
			const invitations = await admin
				.collection('reviewAssignments')
				.getFullList({ filter: `editionId = "${edition.id}" && reviewStage = 3` });
			expect(invitations).toHaveLength(2);
			for (const reviewer of [other, second]) {
				const draft = await reviewer.collection('editionReviews').create({
					editionId: edition.id,
					reviewerId: reviewer.authStore.record!.id,
					reviewStage: 3,
					reviewStatus: 'draft',
					finalAnswers: {}
				});
				expect(
					await author.collection('editionReviews').getFullList({ filter: `id = "${draft.id}"` })
				).toHaveLength(0);
				await expect(
					reviewer.collection('editionReviews').update(draft.id, { reviewStatus: 'submitted' })
				).rejects.toBeDefined();
				await reviewer.collection('editionReviews').update(draft.id, {
					reviewStatus: 'submitted',
					finalAnswers: {
						valueRating: 4,
						valueExplanation: 'Solid evidence.',
						experienceComments: 'Clear navigation.',
						changesRating: 5,
						changesExplanation: 'Feedback addressed.',
						recommendation: reviewer === other ? 'minor_changes' : 'without_changes',
						comments: 'Public review text.',
						attribution: reviewer === other ? 'anonymous' : 'named'
					}
				});
				await expect(
					reviewer.collection('editionReviews').update(draft.id, { finalAnswers: {} })
				).rejects.toBeDefined();
				await expect(reviewer.collection('editions').getOne(edition.id)).rejects.toBeDefined();
				if (reviewer === other)
					await expect(
						admin.send(endpoint + '/final-decision', {
							method: 'POST',
							body: { decision: 'accept', comment: 'Ready.' }
						})
					).rejects.toBeDefined();
			}
			expect(await author.send(endpoint + '/final-progress')).toMatchObject({
				submitted: 2,
				feedback: []
			});
			await expect(
				author.send(endpoint + '/final-decision', {
					method: 'POST',
					body: { decision: 'accept', comment: 'Bypass.' }
				})
			).rejects.toBeDefined();
			await admin.send(endpoint + '/final-decision', {
				method: 'POST',
				body: { decision: 'revisions', comment: 'Another review round is required.' }
			});
			await author.collection('editions').update(edition.id, {
				status: 'final_review',
				finalRequest: { ...finalRequest, comment: 'Final Review revisions completed.' }
			});
			await expect(other.collection('editions').getOne(edition.id)).rejects.toBeDefined();
			await admin.send(endpoint + '/final-invitations', {
				method: 'POST',
				body: { dueAt: '2099-01-01T00:00:00Z' }
			});
			for (const reviewer of [other, second]) {
				const review = await reviewer.collection('editionReviews').create({
					editionId: edition.id,
					reviewerId: reviewer.authStore.record!.id,
					reviewStage: 3,
					reviewStatus: 'submitted',
					finalAnswers: {
						valueRating: 5,
						valueExplanation: 'Revisions checked.',
						experienceComments: 'Clear navigation.',
						changesRating: 5,
						changesExplanation: 'All addressed.',
						recommendation: 'without_changes',
						comments: '',
						attribution: reviewer === other ? 'anonymous' : 'named'
					}
				});
				expect(review.reviewRound).toBe(2);
			}
			await admin.send(endpoint + '/final-decision', {
				method: 'POST',
				body: { decision: 'accept', comment: 'Minor corrections may be made before publication.' }
			});
			expect((await author.send(endpoint + '/final-progress')).feedback).toHaveLength(4);
			const visitor = new PocketBase(origin);
			await expect(visitor.send(endpoint + '/public-reviews')).rejects.toBeDefined();
			await author
				.collection('editions')
				.update(edition.id, { dcAbstract: '<p>Final corrected description</p>' });
			await expect(
				author.collection('editions').update(edition.id, {
					status: 'publication_requested',
					publicationRequest: { comment: '', rightsConfirmed: false }
				})
			).rejects.toBeDefined();
			await author.collection('editions').update(edition.id, {
				status: 'publication_requested',
				publicationRequest: { comment: 'Corrections completed.', rightsConfirmed: true }
			});
			await expect(
				author.collection('editions').update(edition.id, { title: 'Cannot change submission' })
			).rejects.toBeDefined();
			await admin.send(endpoint + '/final-decision', {
				method: 'POST',
				body: { decision: 'return', comment: 'Please double-check captions.' }
			});
			await author
				.collection('editions')
				.update(edition.id, { dcAbstract: '<p>Captions checked.</p>' });
			await author.collection('editions').update(edition.id, { status: 'publication_requested' });
			await admin.send(endpoint + '/final-decision', {
				method: 'POST',
				body: { decision: 'publish', comment: 'Approved for publication.' }
			});
			const publicEdition = await visitor.collection('editions').getOne(edition.id);
			expect(publicEdition.proposalPurpose).toBeUndefined();
			expect(publicEdition.proposalSnapshot).toBeUndefined();
			expect(publicEdition.alphaRequest).toBeUndefined();
			expect(publicEdition.isPublished).toBe(true);
			expect(publicEdition.peerReviewStamp).toBe(true);
			expect(publicEdition.finalRequest).toBeUndefined();
			expect(publicEdition.publicationRequest).toBeUndefined();
			const published = await visitor.send(endpoint + '/public-reviews');
			expect(published.feedback).toHaveLength(4);
			expect(JSON.stringify(published)).not.toContain(other.authStore.record!.id);
			expect(
				published.feedback.some((r: { reviewer: string }) => r.reviewer === 'Named reviewer')
			).toBe(true);
			await expect(
				author.collection('editions').update(edition.id, { dcAbstract: 'Published edit' })
			).rejects.toBeDefined();
			await expect(
				admin.collection('editions').update(edition.id, { status: 'draft' })
			).rejects.toBeDefined();
		} finally {
			await root.collection('editions').delete(edition.id);
			await root.collection('users').delete(user.id);
		}
	}
);

integration(
	'OAuth rejects provider, missing verification config, claims, subject and PB fallback selection',
	async () => {
		for (const body of [
			{ provider: 'github' },
			{ subject: 'not-an-orcid' },
			{ subject: '0000-0002-1825-0098' },
			{ userInfoURL: 'https://orcid.org/oauth/userinfo' },
			{ jwksURL: 'https://evil.test/keys' },
			{ claims: { iss: 'https://evil.test' } },
			{
				claims: {
					iss: issuer === 'https://orcid.org' ? 'https://sandbox.orcid.org' : 'https://orcid.org'
				}
			},
			{ claims: { exp: 1 } },
			{ claims: { aud: 'other-client' } },
			{ preselected: other.authStore.record!.id, email: 'other@example.test' }
		])
			expect((await oauth(body)).status).toBeGreaterThanOrEqual(400);
		expect((await oauth({}, other.authStore.token)).status).toBeGreaterThanOrEqual(400);
	}
);

integration(
	'publication state cannot be forged or reached through the old direct-publish shortcut',
	async () => {
		for (const requested of [false, true]) {
			const edition = await root.collection('editions').create({
				title: 'Publication guard',
				status: 'alpha_accepted',
				peerReviewRequested: requested,
				credits: [credit]
			});
			try {
				for (const patch of [
					{ status: 'published', peerReviewStamp: true },
					{ isPublished: true },
					{ peerReviewStamp: true },
					{ finalFeedbackReleasedAt: new Date().toISOString() }
				])
					await expect(
						admin.collection('editions').update(edition.id, patch)
					).rejects.toBeDefined();
				await expect(
					admin.send(`/api/pure3d/editions/${edition.id}/final-decision`, {
						method: 'POST',
						body: { decision: 'publish', comment: 'Bypass' }
					})
				).rejects.toBeDefined();
			} finally {
				await root.collection('editions').delete(edition.id);
			}
		}
	}
);

integration(
	'review access is scoped to the exact assignment, stage and immutable owner',
	async () => {
		const secondUser = await root.collection('users').create({
			email: 'second-reviewer@example.test',
			password: 'local-test-password-only',
			passwordConfirm: 'local-test-password-only',
			role: 'user'
		});
		const second = new PocketBase(origin);
		await second
			.collection('users')
			.authWithPassword('second-reviewer@example.test', 'local-test-password-only');
		const outsider = new PocketBase(origin);
		await outsider
			.collection('users')
			.authWithPassword('pending@example.test', 'local-test-password-only');
		const edition = await author
			.collection('editions')
			.create({ title: 'Scoped reviews', credits: [credit] });
		const differentEdition = await author
			.collection('editions')
			.create({ title: 'Different review scope', credits: [credit] });
		try {
			await author
				.collection('editions')
				.update(edition.id, { status: 'concept_submitted', ...proposalPayload() });
			await root.collection('editionUsers').create({
				editionId: edition.id,
				userId: outsider.authStore.record!.id,
				role: 'collaborator'
			});
			const verdict = {
				editionId: edition.id,
				reviewerId: other.authStore.record!.id,
				reviewStage: 1,
				decision: 'approve',
				comment: 'Review'
			};
			await expect(other.collection('editionReviews').create(verdict)).rejects.toBeDefined();
			await expect(
				other.collection('reviewAssignments').create({ ...verdict, status: 'pending' })
			).rejects.toBeDefined();
			const assignment = await admin.collection('reviewAssignments').create({
				editionId: edition.id,
				reviewerId: other.authStore.record!.id,
				reviewStage: 1,
				assignedBy: author.authStore.record!.id,
				status: 'pending'
			});
			expect(assignment.assignedBy).toBe(admin.authStore.record!.id);
			await root
				.collection('editionUsers')
				.create({ editionId: edition.id, userId: other.authStore.record!.id, role: 'reviewer' });
			const secondAssignment = await admin.collection('reviewAssignments').create({
				editionId: edition.id,
				reviewerId: secondUser.id,
				reviewStage: 1,
				status: 'pending'
			});
			await admin.collection('reviewAssignments').create({
				editionId: differentEdition.id,
				reviewerId: other.authStore.record!.id,
				reviewStage: 1,
				status: 'pending'
			});
			expect(
				await other.collection('reviewAssignments').getFullList({ sort: '-created' })
			).toHaveLength(2);
			await expect(other.collection('editions').getOne(edition.id)).resolves.toBeDefined();
			await expect(
				outsider.collection('reviewAssignments').getOne(assignment.id)
			).rejects.toBeDefined();
			expect(
				await outsider
					.collection('reviewAssignments')
					.getFullList({ filter: `editionId = '${edition.id}'` })
			).toHaveLength(0);
			expect(
				await author
					.collection('reviewAssignments')
					.getFullList({ filter: `editionId = '${edition.id}'`, sort: 'created' })
			).toHaveLength(0);
			await expect(
				other.collection('reviewAssignments').update(assignment.id, { status: 'completed' })
			).rejects.toBeDefined();
			// Accept before submission: the trusted submission hook completes the assignment.
			// Direct submission from pending is exercised by the unanimous-approval journey.
			await expect(
				other.collection('reviewAssignments').update(assignment.id, { status: 'accepted' })
			).resolves.toBeDefined();
			const review = await other.collection('editionReviews').create(verdict);
			await expect(other.collection('editionReviews').create(verdict)).rejects.toBeDefined();
			await expect(
				other
					.collection('reviewAssignments')
					.update(assignment.id, { assignedBy: other.authStore.record!.id })
			).rejects.toBeDefined();
			await expect(
				other.collection('editionReviews').update(review.id, { comment: 'Own edit' })
			).resolves.toMatchObject({ comment: 'Own edit' });
			for (const client of [other, admin])
				for (const patch of [
					{ reviewerId: secondUser.id },
					{ editionId: differentEdition.id },
					{ reviewStage: 2 }
				])
					await expect(
						client.collection('editionReviews').update(review.id, patch)
					).rejects.toBeDefined();
			const falseScope = await admin
				.collection('editionReviews')
				.create({ ...verdict, reviewerId: secondUser.id });
			await expect(other.collection('editionReviews').getOne(falseScope.id)).rejects.toBeDefined();
			expect(
				(await other.collection('editionReviews').getFullList({ sort: '-created' })).map(
					(item) => item.id
				)
			).toEqual([review.id]);
			await expect(second.collection('editionReviews').getOne(review.id)).rejects.toBeDefined();
			await expect(outsider.collection('editionReviews').getOne(review.id)).rejects.toBeDefined();
			await admin.collection('editionReviews').delete(falseScope.id);
			const feedbackData = {
				editionId: edition.id,
				reviewerId: other.authStore.record!.id,
				reviewStage: 1,
				category: 'general',
				comment: 'Please revise this detail'
			};
			await expect(
				other.collection('reviewFeedback').create({ ...feedbackData, resolved: true })
			).rejects.toBeDefined();
			await expect(
				other.collection('reviewFeedback').create({ ...feedbackData, reviewerId: secondUser.id })
			).rejects.toBeDefined();
			const feedback = await other.collection('reviewFeedback').create(feedbackData);
			await expect(author.collection('reviewFeedback').getOne(feedback.id)).resolves.toBeDefined();
			expect(
				await author
					.collection('reviewFeedback')
					.getFullList({ filter: `editionId = '${edition.id}'`, sort: '-created' })
			).toHaveLength(1);
			for (const client of [outsider, second, new PocketBase(origin)]) {
				await expect(client.collection('reviewFeedback').getOne(feedback.id)).rejects.toBeDefined();
				expect(
					await client
						.collection('reviewFeedback')
						.getFullList({ filter: `editionId = '${edition.id}'` })
				).toHaveLength(0);
				await expect(
					client.collection('reviewFeedback').update(feedback.id, { resolved: true })
				).rejects.toBeDefined();
			}
			await expect(
				author.collection('reviewFeedback').update(feedback.id, { comment: 'Rewritten by author' })
			).rejects.toBeDefined();
			await expect(
				author.collection('reviewFeedback').update(feedback.id, { resolved: true })
			).rejects.toBeDefined();
			await expect(
				other.collection('reviewFeedback').update(feedback.id, { comment: 'Reviewer edit' })
			).resolves.toBeDefined();
			await expect(
				other.collection('reviewFeedback').update(feedback.id, { resolved: true })
			).rejects.toBeDefined();
			for (const patch of [
				{ reviewerId: secondUser.id },
				{ editionId: differentEdition.id },
				{ reviewStage: 2 }
			])
				await expect(
					other.collection('reviewFeedback').update(feedback.id, patch)
				).rejects.toBeDefined();
			for (const status of ['editorial_review', 'concept_accepted'])
				await admin.collection('editions').update(edition.id, { status });
			await requestAlpha(edition.id);
			const alphaAssignment = await admin.collection('reviewAssignments').create({
				editionId: edition.id,
				reviewerId: secondUser.id,
				reviewStage: 2,
				status: 'pending'
			});
			await expect(
				other.collection('editionReviews').update(review.id, { comment: 'Past stage edit' })
			).rejects.toBeDefined();
			await expect(
				other.collection('reviewFeedback').create({ ...feedbackData, reviewStage: 2 })
			).rejects.toBeDefined();
			await expect(
				other.collection('editions').update(edition.id, { status: 'alpha_accepted' })
			).rejects.toBeDefined();
			await expect(
				second
					.collection('reviewFeedback')
					.create({ ...feedbackData, reviewerId: secondUser.id, reviewStage: 2 })
			).rejects.toBeDefined();
			const alphaReview = await second.collection('editionReviews').create({
				editionId: edition.id,
				reviewerId: secondUser.id,
				reviewStage: 2,
				...alphaAnswersPayload()
			});
			await admin.collection('reviewAssignments').create({
				editionId: edition.id,
				reviewerId: other.authStore.record!.id,
				reviewStage: 2,
				status: 'pending'
			});
			await other.collection('editionReviews').create({
				editionId: edition.id,
				reviewerId: other.authStore.record!.id,
				reviewStage: 2,
				...alphaAnswersPayload()
			});
			await admin.send(`/api/pure3d/editions/${edition.id}/alpha-decision`, {
				method: 'POST',
				body: { decision: 'revisions' }
			});
			for (const item of [feedback])
				await expect(
					author.collection('reviewFeedback').update(item.id, { resolved: true })
				).resolves.toMatchObject({ resolved: true });
			await expect(
				author
					.collection('reviewFeedback')
					.update(feedback.id, { resolved: false, comment: 'Smuggled edit' })
			).rejects.toBeDefined();
			await expect(
				author.collection('editions').update(edition.id, { dcInstitution: ['Updated institution'] })
			).resolves.toMatchObject({ dcInstitution: ['Updated institution'] });
			await expect(
				second
					.collection('editions')
					.update(edition.id, { dcInstitution: ['Unauthorized institution'] })
			).rejects.toBeDefined();
			await admin
				.collection('reviewAssignments')
				.update(alphaAssignment.id, { status: 'declined' });
			await expect(
				second.collection('editionReviews').getOne(alphaReview.id)
			).rejects.toBeDefined();
			await expect(
				second
					.collection('editionReviews')
					.update(alphaReview.id, { generalComments: 'Declined edit' })
			).rejects.toBeDefined();
			await admin.collection('reviewAssignments').delete(assignment.id);
			await expect(other.collection('editionReviews').getOne(review.id)).rejects.toBeDefined();
			await expect(other.collection('editions').getOne(edition.id)).rejects.toBeDefined();
			await admin
				.collection('reviewAssignments')
				.update(secondAssignment.id, { status: 'declined' });
			await expect(
				admin.collection('editions').update(edition.id, { status: 'published' })
			).rejects.toBeDefined();
			await expect(
				other.collection('editionReviews').create({ ...verdict, reviewStage: 3.5 })
			).rejects.toBeDefined();
			// Final drafts, round scoping, release and published locks are exercised in the full workflow test.
		} finally {
			await deleteEditionFixture(edition.id);
			await deleteEditionFixture(differentEdition.id);
			await root.collection('users').delete(secondUser.id);
		}
	}
);

integration('admin unpublishing restores private editing with an audit trail', async () => {
	const visitor = new PocketBase(origin);
	const scene = JSON.stringify({
		asset: { type: 'application/si-dpo-3d.document+json', version: '1.0' },
		scene: 0,
		scenes: [{ nodes: [] }]
	});
	const edition = await root.collection('editions').create({
		title: 'Published edition for revisions',
		status: 'published',
		isPublished: true,
		credits: [credit],
		sceneDocument: new File([scene], 'scene.svx.json')
	});
	await root.collection('editionUsers').create({
		editionId: edition.id,
		userId: author.authStore.record!.id,
		role: 'author'
	});
	const endpoint = `/api/pure3d/editions/${edition.id}/unpublish`;
	const reason = 'Correct the metadata and Voyager narrative.';
	const body = { expectedStatus: 'published', reason };
	expect((await visitor.collection('editions').getOne(edition.id)).isPublished).toBe(true);
	for (const client of [visitor, author, other]) {
		await expect(client.send(endpoint, { method: 'POST', body })).rejects.toMatchObject({
			status: client === visitor ? 401 : 403
		});
	}
	for (const invalid of [
		{ ...body, reason: '' },
		{ ...body, expectedStatus: 'final_revisions' }
	]) {
		await expect(admin.send(endpoint, { method: 'POST', body: invalid })).rejects.toMatchObject({
			status: 400
		});
	}
	await expect(
		admin.collection('editions').update(edition.id, { title: 'Still locked' })
	).rejects.toBeDefined();
	expect((await visitor.collection('editions').getOne(edition.id)).title).toBe(edition.title);
	expect(
		await root.collection('auditLog').getFullList({
			filter: `targetId = '${edition.id}' && action = 'edition_unpublished'`
		})
	).toHaveLength(0);
	await expect(admin.send(endpoint, { method: 'POST', body })).resolves.toMatchObject({
		status: 'final_revisions'
	});
	const revisions = await admin.collection('editions').getOne(edition.id);
	expect(revisions).toMatchObject({
		status: 'final_revisions',
		isPublished: false,
		reviewStage: 3,
		publishedAt: '',
		publishedBy: '',
		peerReviewStamp: false,
		credits: edition.credits,
		sceneDocument: edition.sceneDocument
	});
	expect(revisions.dcDateUnPublished).toBeTruthy();
	await expect(visitor.collection('editions').getOne(edition.id)).rejects.toMatchObject({
		status: 404
	});
	expect(
		await visitor.collection('editions').getFullList({ filter: `id = '${edition.id}'` })
	).toHaveLength(0);
	await expect(
		other.collection('editions').update(edition.id, { title: 'Unauthorised edit' })
	).rejects.toBeDefined();
	await expect(admin.send(endpoint, { method: 'POST', body })).rejects.toMatchObject({
		status: 400
	});
	const revisedScene = scene.replace('"nodes":[]', '"nodes":[],"name":"Revised narrative"');
	await admin.collection('editions').update(edition.id, {
		title: 'Corrected edition title',
		dcDescription: '<p>Corrected edition description.</p>',
		sceneDocument: new File([revisedScene], 'revised.svx.json')
	});
	const reopened = await author.collection('editions').getOne(edition.id);
	expect(reopened).toMatchObject({
		title: 'Corrected edition title',
		dcDescription: '<p>Corrected edition description.</p>',
		status: 'final_revisions',
		isPublished: false,
		credits: edition.credits
	});
	const token = await author.files.getToken();
	const savedScene = await fetch(author.files.getURL(reopened, reopened.sceneDocument, { token }));
	expect(savedScene.status).toBe(200);
	expect(await savedScene.text()).toBe(revisedScene);
	await expect(
		admin.collection('editions').update(edition.id, { status: 'published', isPublished: true })
	).rejects.toBeDefined();
	const audit = await root.collection('auditLog').getFullList({
		filter: `targetId = '${edition.id}' && action = 'edition_unpublished'`
	});
	expect(audit).toHaveLength(1);
	expect(audit[0]).toMatchObject({
		performedBy: 'users/' + admin.authStore.record!.id,
		details: { from: 'published', to: 'final_revisions', reason }
	});
});

integration(
	'legacy publication can be preserved but missing creator IDs block new submission/publication',
	async () => {
		await expect(
			admin.collection('editions').update('legacy000000000', { title: 'Preserved attribution' })
		).rejects.toBeDefined();
		await expect(
			admin.collection('editions').update('legacy000000000', { dcCreator: ['Changed creator'] })
		).rejects.toBeDefined();
		await expect(
			admin.collection('editions').update('legacy000000000', { status: 'draft' })
		).rejects.toBeDefined();
		await expect(
			admin.collection('editions').update('legacy000000000', { status: 'concept_submitted' })
		).rejects.toBeDefined();
		await expect(
			admin.collection('collections').create({
				title: 'Missing IDs',
				isVisible: true,
				credits: [
					{ type: 'person', name: 'Creator', orcid: null, role: 'creator', provenance: 'manual' }
				]
			})
		).rejects.toBeDefined();
	}
);

integration(
	'admin approval is private, not verification; exact OAuth promotes only that account',
	async () => {
		const pendingId = 'pending00000000';
		const candidate = 'https://orcid.org/0000-0002-1694-233X';
		await expect(
			other.send('/api/pure3d/orcid/pending/' + pendingId, {
				method: 'POST',
				body: { orcid: candidate }
			})
		).rejects.toBeDefined();
		const approval = await admin.send('/api/pure3d/orcid/pending/' + pendingId, {
			method: 'POST',
			body: { orcid: candidate }
		});
		expect(approval).toMatchObject({ pendingOrcid: candidate, orcidVerifiedAt: null });
		const approvalAudit = await root
			.collection('auditLog')
			.getFullList({ filter: `targetId = '${pendingId}' && action = 'orcid_mapping_approved'` });
		expect(approvalAudit).toHaveLength(1);
		expect(approvalAudit[0]).toMatchObject({
			performedBy: 'users/' + admin.authStore.record!.id,
			details: { before: { pendingOrcid: null }, after: { pendingOrcid: candidate } }
		});
		await admin.send('/api/pure3d/orcid/pending/' + pendingId, {
			method: 'POST',
			body: { orcid: null }
		});
		const clearAudit = await root
			.collection('auditLog')
			.getFullList({ filter: `targetId = '${pendingId}' && action = 'orcid_mapping_cleared'` });
		expect(clearAudit).toHaveLength(1);
		expect(clearAudit[0]).toMatchObject({
			performedBy: 'users/' + admin.authStore.record!.id,
			details: { before: { pendingOrcid: candidate }, after: { pendingOrcid: null } }
		});
		for (let i = 0; i < 2; i++)
			await admin.send('/api/pure3d/orcid/pending/' + pendingId, {
				method: 'POST',
				body: { orcid: candidate }
			});
		expect(
			await root
				.collection('auditLog')
				.getFullList({ filter: `targetId = '${pendingId}' && action = 'orcid_mapping_approved'` })
		).toHaveLength(2);
		const publicRecord = await new PocketBase(origin).collection('users').getOne(pendingId);
		expect(publicRecord).not.toHaveProperty('pendingOrcid');
		expect(publicRecord.orcidVerifiedAt).toBe('');
		await expect(
			other.collection('users').getFullList({ filter: `pendingOrcid = '${candidate}'` })
		).rejects.toBeDefined();
		await expect(
			admin.send('/api/pure3d/orcid/pending/' + other.authStore.record!.id, {
				method: 'POST',
				body: { orcid: candidate }
			})
		).rejects.toBeDefined();
		const result = await oauth({
			subject: '0000-0002-1694-233X',
			createData: { role: 'admin', nickname: 'Spoof', email: 'spoof@example.test' }
		});
		expect(result.status).toBe(200);
		expect(result.body.record).toMatchObject({
			id: pendingId,
			role: 'user',
			orcid: candidate,
			nickname: ''
		});
		expect(result.body.record.orcidVerifiedAt).not.toBe('');
		expect(result.body.meta).toEqual({ isNew: false });
		expect(result.body.record).not.toHaveProperty('pendingOrcid');
		expect((await admin.send('/api/pure3d/orcid/pending/' + pendingId)).pendingOrcid).toBeNull();
	}
);

integration('a unique stored ORCID links its existing account only after valid OAuth', async () => {
	const candidate = 'https://orcid.org/0000-0001-6350-2380';
	const first = await root.collection('users').create({
		email: 'curated-admin@example.test',
		role: 'admin',
		password: 'local-test-password-only',
		passwordConfirm: 'local-test-password-only'
	});
	const duplicate = await root.collection('users').create({
		email: 'curated-duplicate@example.test',
		role: 'user',
		password: 'local-test-password-only',
		passwordConfirm: 'local-test-password-only'
	});
	try {
		await expect(
			other.send('/api/pure3d/orcid/curated/' + first.id, {
				method: 'POST',
				body: { orcid: candidate }
			})
		).rejects.toBeDefined();
		await expect(
			root.send('/api/pure3d/orcid/curated/' + first.id, {
				method: 'POST',
				body: { orcid: '0000-0003-1072-5199' }
			})
		).rejects.toBeDefined();
		await root.send('/api/pure3d/orcid/curated/' + first.id, {
			method: 'POST',
			body: { orcid: candidate }
		});
		expect((await root.collection('users').getOne(first.id)).orcidVerifiedAt).toBe('');
		await expect(
			root.send('/api/pure3d/orcid/curated/' + duplicate.id, {
				method: 'POST',
				body: { orcid: candidate }
			})
		).rejects.toBeDefined();
		expect((await root.collection('users').getOne(first.id)).orcidVerifiedAt).toBe('');
		const signedIn = await oauth({ subject: candidate.slice(18) });
		expect(signedIn.status).toBe(200);
		expect(signedIn.body.record).toMatchObject({ id: first.id, role: 'admin', orcid: candidate });
		expect(signedIn.body.record.orcidVerifiedAt).toBeTruthy();
		expect(signedIn.body.meta).toEqual({ isNew: false });
		await expect(
			author
				.collection('users')
				.update(first.id, { orcid: 'https://orcid.org/0000-0002-1825-0097' })
		).rejects.toBeDefined();
	} finally {
		await root.collection('users').delete(first.id);
		await root
			.collection('users')
			.delete(duplicate.id)
			.catch((error) => {
				if (error.status !== 404) throw error;
			});
	}
});

integration(
	'new OAuth ignores createData privileges and repeated exact login keeps identity',
	async () => {
		const failed = await oauth({ subject: '0000-0001-5109-3700', failAfterProof: true });
		expect(failed.status).toBe(400);
		expect(
			await root
				.collection('users')
				.getFullList({ filter: "orcid = 'https://orcid.org/0000-0001-5109-3700'" })
		).toHaveLength(0);
		const first = await oauth({
			subject: '0000-0001-5109-3700',
			createData: { role: 'admin', orcidVerifiedAt: '2000-01-01', nickname: 'Forged' }
		});
		if (first.status !== 200) throw new Error(JSON.stringify(first.body));
		expect(first.status).toBe(200);
		expect(first.body.record).toMatchObject({
			role: 'user',
			nickname: '',
			orcid: 'https://orcid.org/0000-0001-5109-3700'
		});
		expect(first.body.meta).toEqual({ isNew: true });
		const second = await oauth({
			subject: '0000-0001-5109-3700',
			preselected: first.body.record.id
		});
		expect(second.status).toBe(200);
		expect(second.body.record.id).toBe(first.body.record.id);
		expect(second.body.record.orcidVerifiedAt).toBe(first.body.record.orcidVerifiedAt);
		const loggedIn = new PocketBase(origin);
		loggedIn.authStore.save(second.body.token, second.body.record);
		const links = await loggedIn.collection('_externalAuths').getFullList();
		await expect(loggedIn.collection('_externalAuths').delete(links[0].id)).rejects.toBeDefined();
	}
);

integration(
	'profile endpoint rejects unauthenticated and unverified users without remote requests',
	async () => {
		expect(
			(await fetch(origin + '/api/pure3d/orcid/profile-refresh', { method: 'POST' })).status
		).toBe(401);
		await expect(
			other.send('/api/pure3d/orcid/profile-refresh', { method: 'POST' })
		).rejects.toBeDefined();
	}
);

integration(
	'profile refresh writes only its allowlist and preserves state on upstream failure',
	async () => {
		const profile = await author.send('/_test/profile', {
			method: 'POST',
			body: { url: 'https://evil.test', userId: other.authStore.record!.id }
		});
		expect(profile).toMatchObject({ nickname: 'ORCID Name', orcid, bio: 'Public biography' });
		expect(Object.keys(profile).sort()).toEqual([
			'affiliation',
			'bio',
			'nickname',
			'orcid',
			'orcidVerifiedAt',
			'socials',
			'titleRole'
		]);
		const saved = await author.collection('users').getOne(author.authStore.record!.id);
		expect(saved).toMatchObject({ role: 'user', nickname: 'ORCID Name', profilePicture: '' });
		await expect(
			author.send('/_test/profile', { method: 'POST', body: { fail: true } })
		).rejects.toMatchObject({ status: 502 });
		expect((await author.collection('users').getOne(saved.id)).nickname).toBe('ORCID Name');
		const definition = await root.collections.getOne('users');
		await root.collections.update(definition.id, {
			fields: definition.fields.map((field) =>
				field.name === 'nickname' ? { ...field, required: true } : field
			)
		});
		try {
			for (const client of [author, admin, root]) {
				for (const field of ['nickname', 'affiliation', 'bio', 'titleRole', 'socials'])
					await expect(
						client.collection('users').update(saved.id, { [field]: 'Forged profile' })
					).rejects.toBeDefined();
				await expect(
					client.collection('users').update(saved.id, { 'nickname+': ' appended' })
				).resolves.toMatchObject({ nickname: 'ORCID Name' });
			}
			await expect(
				root.collection('users').update(saved.id, { userHash: 'synthetic-non-profile-update' })
			).resolves.toMatchObject({ nickname: 'ORCID Name' });
		} finally {
			await root.collections.update(definition.id, { fields: definition.fields });
		}
		await root.collections.update(definition.id, {
			oauth2: {
				...definition.oauth2,
				providers: orcidAuthConfig(
					'test-client',
					'test-secret',
					environment === 'production' ? 'sandbox' : 'production'
				).oauth2.providers
			}
		});
		try {
			await expect(
				author.send('/api/pure3d/orcid/profile-refresh', { method: 'POST' })
			).rejects.toBeDefined();
		} finally {
			await root.collections.update(definition.id, { oauth2: definition.oauth2 });
		}
	}
);

integration(
	'trusted activity is atomic, actor-derived and readable only by its recipient',
	async () => {
		const edition = await author
			.collection('editions')
			.create({ title: 'Trusted activity', credits: [credit] });
		try {
			await author.collection('editions').update(edition.id, {
				status: 'concept_submitted',
				...proposalPayload(),
				__pure3dActor: '_superusers/' + root.authStore.record!.id,
				performedBy: 'forged actor',
				recipientId: other.authStore.record!.id
			});
			const audit = await root.collection('auditLog').getFullList({
				filter: `targetId = '${edition.id}' && action = 'status_transition'`,
				sort: '-created'
			});
			expect(audit).toHaveLength(1);
			expect(audit[0]).toMatchObject({
				performedBy: 'users/' + author.authStore.record!.id,
				details: { before: { status: 'draft' }, after: { status: 'concept_submitted' } }
			});
			const notifications = await admin.collection('notifications').getFullList({
				filter: `editionId = '${edition.id}' && type = 'concept_submitted'`,
				sort: '-created'
			});
			expect(notifications).toHaveLength(1);
			const notification = notifications[0];
			expect(notification).toMatchObject({
				recipientId: admin.authStore.record!.id,
				title: 'An edition is ready for review',
				read: false
			});
			expect(notification.actionUrl).toContain('/editions/' + edition.id + '/workflow');
			await expect(
				admin.collection('notifications').update(notification.id, { read: true })
			).resolves.toMatchObject({ read: true });
			for (const client of [author, other, new PocketBase(origin)]) {
				expect(
					await client
						.collection('notifications')
						.getFullList({ filter: `id = '${notification.id}'` })
				).toHaveLength(0);
				await expect(
					client.collection('notifications').getOne(notification.id)
				).rejects.toBeDefined();
				await expect(
					client.collection('notifications').update(notification.id, { read: false })
				).rejects.toBeDefined();
			}
			for (const patch of [
				{ title: 'Forged title' },
				{ recipientId: other.authStore.record!.id },
				{ message: 'Forged message' },
				{ actionUrl: 'https://evil.example/' },
				{ editionId: '' },
				{ type: 'published' }
			])
				await expect(
					admin.collection('notifications').update(notification.id, patch)
				).rejects.toBeDefined();
			for (const client of [author, admin, root]) {
				await expect(
					client.collection('notifications').create({
						recipientId: other.authStore.record!.id,
						title: 'Forged notification',
						type: 'published',
						__pure3dActor: 'system',
						'pure3d.event': true
					})
				).rejects.toBeDefined();
				await expect(
					client.collection('auditLog').create({
						action: 'status_transition',
						targetType: 'edition',
						targetId: edition.id,
						performedBy: 'forged actor',
						details: {},
						'pure3d.event': true
					})
				).rejects.toBeDefined();
				await expect(
					client.collection('auditLog').update(audit[0].id, { performedBy: 'forged actor' })
				).rejects.toBeDefined();
			}
			expect(
				await root
					.collection('auditLog')
					.getFullList({ filter: `targetId = '${edition.id}' && action = 'status_transition'` })
			).toHaveLength(1);
			const membership = await author.collection('editionUsers').create({
				editionId: edition.id,
				userId: other.authStore.record!.id,
				role: 'collaborator'
			});
			expect(
				await other
					.collection('notifications')
					.getFullList({ filter: `editionId = '${edition.id}' && type = 'collaborator_added'` })
			).toHaveLength(1);
			await author.collection('editionUsers').delete(membership.id);
			expect(
				await other
					.collection('notifications')
					.getFullList({ filter: `editionId = '${edition.id}' && type = 'collaborator_removed'` })
			).toHaveLength(1);
			const removals = await root
				.collection('auditLog')
				.getFullList({ filter: `targetId = '${edition.id}' && action = 'user_removed'` });
			expect(removals).toHaveLength(1);
			expect(removals[0]).toMatchObject({
				performedBy: 'users/' + author.authStore.record!.id,
				details: {
					recordId: membership.id,
					before: { userId: other.authStore.record!.id },
					after: null
				}
			});
			await admin.collection('reviewAssignments').create({
				editionId: edition.id,
				reviewerId: other.authStore.record!.id,
				reviewStage: 1,
				status: 'pending'
			});
			const feedback = await other.collection('reviewFeedback').create({
				editionId: edition.id,
				reviewerId: other.authStore.record!.id,
				reviewStage: 1,
				category: 'general',
				comment: 'Trusted reviewer feedback',
				recipientId: admin.authStore.record!.id,
				__pure3dActor: 'users/' + admin.authStore.record!.id
			});
			const received = await author
				.collection('notifications')
				.getFullList({ filter: `editionId = '${edition.id}' && type = 'feedback_received'` });
			expect(received).toHaveLength(1);
			expect(received[0].recipientId).toBe(author.authStore.record!.id);
			await expect(
				author.collection('notifications').update(received[0].id, { read: true })
			).resolves.toMatchObject({ read: true });
			const feedbackAudit = await root
				.collection('auditLog')
				.getFullList({ filter: `targetId = '${edition.id}' && action = 'feedback_created'` });
			expect(feedbackAudit).toHaveLength(1);
			expect(feedbackAudit[0]).toMatchObject({
				performedBy: 'users/' + other.authStore.record!.id,
				details: { recordId: feedback.id }
			});
			await other.collection('editionReviews').create({
				editionId: edition.id,
				reviewerId: other.authStore.record!.id,
				reviewStage: 1,
				decision: 'approve',
				comment: 'Verdict'
			});
			expect(
				await admin
					.collection('notifications')
					.getFullList({ filter: `editionId = '${edition.id}' && type = 'review_submitted'` })
			).toHaveLength(1);
		} finally {
			await deleteEditionFixture(edition.id);
		}
	}
);

integration(
	'audit and notification failure roll back the authorized mutation and all side effects',
	async () => {
		for (const title of ['force-audit-failure', 'force-notification-failure']) {
			const edition = await author.collection('editions').create({ title, credits: [credit] });
			try {
				await expect(
					author.collection('editions').update(edition.id, { status: 'concept_submitted' })
				).rejects.toBeDefined();
				expect((await root.collection('editions').getOne(edition.id)).status).toBe('draft');
				expect(
					await root
						.collection('auditLog')
						.getFullList({ filter: `targetId = '${edition.id}' && action = 'status_transition'` })
				).toHaveLength(0);
				expect(
					await root
						.collection('notifications')
						.getFullList({ filter: `editionId = '${edition.id}' && type = 'concept_submitted'` })
				).toHaveLength(0);
			} finally {
				await root.collection('editions').delete(edition.id);
			}
		}
		const target = await root.collection('users').create({
			nickname: 'force-orcid-audit-failure',
			password: 'local-test-password-only',
			passwordConfirm: 'local-test-password-only',
			role: 'user'
		});
		try {
			await expect(
				admin.send('/api/pure3d/orcid/pending/' + target.id, {
					method: 'POST',
					body: { orcid: 'https://orcid.org/0000-0000-0000-0001' }
				})
			).rejects.toBeDefined();
			expect((await admin.send('/api/pure3d/orcid/pending/' + target.id)).pendingOrcid).toBeNull();
			expect(
				await root
					.collection('auditLog')
					.getFullList({ filter: `targetId = '${target.id}' && action = 'orcid_mapping_approved'` })
			).toHaveLength(0);
		} finally {
			await root.collection('users').delete(target.id);
		}
	}
);

integration(
	'content mutations keep their audit trail after browser audit writers are removed',
	async () => {
		const documents = await root.collections.create({
			name: 'content',
			type: 'base',
			fields: [
				{ name: 'title', type: 'text' },
				{ name: 'slug', type: 'text' },
				{ name: 'isPublished', type: 'bool' },
				{ name: 'order', type: 'number' }
			],
			createRule: "@request.auth.role = 'admin'",
			updateRule: "@request.auth.role = 'admin'",
			deleteRule: "@request.auth.role = 'admin'",
			listRule: '',
			viewRule: ''
		});
		try {
			const doc = await admin
				.collection('content')
				.create({ title: 'Audited document', slug: 'audited', order: 0 });
			await admin.collection('content').update(doc.id, { order: 1 });
			await admin.collection('content').delete(doc.id);
			const entries = await admin
				.collection('auditLog')
				.getFullList({ filter: `targetId = '${doc.id}'` });
			expect(entries.map((entry) => entry.action).sort()).toEqual([
				'doc_created',
				'doc_deleted',
				'doc_updated'
			]);
			expect(
				entries.every(
					(entry) =>
						entry.targetType === 'content' &&
						entry.performedBy === 'users/' + admin.authStore.record!.id
				)
			).toBe(true);
		} finally {
			await root.collections.delete(documents.id);
		}
	}
);

integration(
	'account deletion preserves credit identity and provenance, clears userId',
	async () => {
		const edition = await author
			.collection('editions')
			.create({ title: 'Durable credit', credits: [credit] });
		await admin.collection('users').delete(author.authStore.record!.id);
		const saved = await admin.collection('editions').getOne(edition.id);
		const historical = Object.fromEntries(
			Object.entries(credit).filter(([key]) => key !== 'userId')
		);
		expect(saved.credits).toEqual([historical]);
		await expect(
			admin
				.collection('editions')
				.update(edition.id, { credits: saved.credits, title: 'Still attributed' })
		).resolves.toBeDefined();
	}
);

integration(
	'configuration requires approved privileged identities and a confirmed real backup before mutations',
	async () => {
		const beforeRejectedPreflight = await root.collections.getOne('users');
		await expect(
			applyOrcidConfiguration(root, 'test-client', 'test-secret', environment)
		).rejects.toThrow('privileged account');
		expect(await root.collections.getOne('users')).toMatchObject({
			passwordAuth: beforeRejectedPreflight.passwordAuth,
			otp: beforeRejectedPreflight.otp,
			oauth2: beforeRejectedPreflight.oauth2
		});
		await admin.send('/api/pure3d/orcid/pending/' + admin.authStore.record!.id, {
			method: 'POST',
			body: { orcid }
		});
		await admin.collection('users').update(other.authStore.record!.id, { role: 'editorial_board' });
		await expect(preflightPrivilegedAccounts(root, issuer)).rejects.toThrow('privileged account');
		await admin.collection('users').update(other.authStore.record!.id, { role: 'user' });
		await admin.collection('users').update('pending00000000', { role: 'editorial_board' });
		await expect(preflightPrivilegedAccounts(root, issuer)).resolves.toEqual([]);
		await expect(
			preflightPrivilegedAccounts(
				root,
				issuer === 'https://orcid.org' ? 'https://sandbox.orcid.org' : 'https://orcid.org'
			)
		).rejects.toThrow('ORCID_ISSUER');
		const createBackup = root.backups.create.bind(root.backups);
		const beforeBackupFailure = await root.collections.getOne('users');
		root.backups.create = async () => {
			throw new Error('Test backup failure');
		};
		try {
			await expect(
				applyOrcidConfiguration(root, 'test-client', 'test-secret', environment)
			).rejects.toThrow('backup failure');
		} finally {
			root.backups.create = createBackup;
		}
		expect(await root.collections.getOne('users')).toMatchObject({
			passwordAuth: beforeBackupFailure.passwordAuth,
			otp: beforeBackupFailure.otp,
			oauth2: beforeBackupFailure.oauth2
		});
		const readBackups = root.backups.getFullList.bind(root.backups);
		const beforeReadbackFailure = await root.collections.getOne('users');
		root.backups.getFullList = async () => [];
		try {
			await expect(
				applyOrcidConfiguration(root, 'test-client', 'test-secret', environment)
			).rejects.toThrow('readback');
		} finally {
			root.backups.getFullList = readBackups;
		}
		expect(await root.collections.getOne('users')).toMatchObject({
			passwordAuth: beforeReadbackFailure.passwordAuth,
			otp: beforeReadbackFailure.otp,
			oauth2: beforeReadbackFailure.oauth2
		});
		const oldAdminToken = admin.authStore.token;
		const oldUserToken = other.authStore.token;
		const superuserToken = root.authStore.token;
		expect(
			(
				await fetch(origin + '/api/pure3d/orcid/config', {
					headers: { Authorization: oldAdminToken }
				})
			).status
		).toBe(200);
		const applied = await applyOrcidConfiguration(root, 'test-client', 'test-secret', environment);
		expect(
			(await root.backups.getFullList()).some(
				(backup) => backup.key === applied.backup && backup.size > 0
			)
		).toBe(true);
		for (const token of [oldAdminToken, oldUserToken]) {
			expect(
				(
					await fetch(origin + '/api/collections/users/auth-refresh', {
						method: 'POST',
						headers: { Authorization: token }
					})
				).status
			).toBe(401);
			expect(
				(await fetch(origin + '/api/pure3d/orcid/config', { headers: { Authorization: token } }))
					.status
			).toBe(401);
		}
		expect(
			(
				await fetch(origin + '/api/pure3d/orcid/config', {
					headers: { Authorization: superuserToken }
				})
			).status
		).toBe(200);
		await expect(root.collection('_superusers').authRefresh()).resolves.toBeDefined();
		const relogin = await oauth({ subject: orcid.slice(18) });
		expect(relogin.status).toBe(200);
		expect(relogin.body.record).toMatchObject({ id: admin.authStore.record!.id, role: 'admin' });
		expect(
			(
				await fetch(origin + '/api/pure3d/orcid/config', {
					headers: { Authorization: relogin.body.token }
				})
			).status
		).toBe(200);
	},
	30000
);

integration('explicit auth configuration disables password/OTP and exposes only OIDC', async () => {
	await root.collections.update(
		'users',
		orcidAuthConfig('test-client', 'test-secret', environment)
	);
	const methods = await new PocketBase(origin).collection('users').listAuthMethods();
	expect(methods.password.enabled).toBe(false);
	expect(methods.otp.enabled).toBe(false);
	expect(methods.oauth2.providers.map((provider) => provider.name)).toEqual(['oidc']);
	await expect(
		new PocketBase(origin)
			.collection('users')
			.authWithPassword('admin@example.test', 'local-test-password-only')
	).rejects.toBeDefined();
});

integration(
	'native PB OIDC parser verifies missing-alg ORCID keys through the bridge without weakening proof',
	async () => {
		const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
		const jwk = {
			...publicKey.export({ format: 'jwk' }),
			kid: 'local-test-key',
			use: 'sig'
		};
		let mode = 'valid';
		const provider = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			fetch(request) {
				if (new URL(request.url).pathname === '/jwks') return Response.json({ keys: [jwk] });
				const claims = {
					sub: '0000-0002-1694-233X',
					iss: mode === 'issuer' ? 'https://evil.test' : issuer,
					aud: mode === 'audience' ? 'other-client' : 'test-client',
					iat: Math.floor(Date.now() / 1000),
					exp: Math.floor(Date.now() / 1000) + (mode === 'expired' ? -3600 : 3600)
				};
				const input =
					Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url') +
					'.' +
					Buffer.from(JSON.stringify(claims)).toString('base64url');
				const signature = sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url');
				return Response.json({
					access_token: 'test-access-token',
					token_type: 'Bearer',
					id_token:
						input +
						'.' +
						(mode === 'signature' ? Buffer.alloc(256).toString('base64url') : signature)
				});
			}
		});
		try {
			const config = orcidAuthConfig('test-client', 'test-secret', environment);
			config.oauth2.providers[0].tokenURL = provider.url.origin + '/token';
			config.oauth2.providers[0].extra.jwksURL = provider.url.origin + '/jwks';
			await root.collections.update('users', config);
			for (const scenario of [
				'missing-alg',
				'valid',
				'signature',
				'issuer',
				'audience',
				'expired',
				'wrong-alg'
			]) {
				mode = scenario;
				if (scenario !== 'missing-alg') {
					await root.send('/_test/jwks', {
						method: 'POST',
						body: { keys: [scenario === 'wrong-alg' ? { ...jwk, alg: 'RS512' } : jwk] }
					});
					config.oauth2.providers[0].extra.jwksURL = origin + '/_test/jwks';
					await root.collections.update('users', config);
					const bridge = await fetch(origin + '/_test/jwks');
					expect(bridge.status).toBe(scenario === 'wrong-alg' ? 502 : 200);
					if (bridge.ok) expect(await bridge.json()).toEqual({ keys: [{ ...jwk, alg: 'RS256' }] });
				}
				const response = await fetch(origin + '/api/collections/users/auth-with-oauth2', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						provider: 'oidc',
						code: 'test-code',
						codeVerifier: 'a'.repeat(43),
						redirectURL: 'http://127.0.0.1/callback'
					})
				});
				const body = await response.json();
				// A valid token reaches our fixed-origin config guard; invalid tokens never reach the hook.
				expect(body.message).toBe(
					scenario === 'valid'
						? 'Not authorised for this operation.'
						: 'Failed to fetch OAuth2 user.'
				);
				expect(response.status).toBe(scenario === 'valid' ? 403 : 400);
			}
		} finally {
			provider.stop(true);
		}
	}
);

integration(
	'native OAuth endpoint preserves proof across downstream saves and rolls back failures',
	async () => {
		const definition = await root.collections.getOne('users');
		const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
		const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'native-save-test', use: 'sig' };
		const subject = '0000-0000-0000-0001';
		let invalidSignature = false;
		let tokenRequests = 0;
		const provider = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			async fetch(request) {
				expect(new URL(request.url).pathname).toBe('/token');
				expect((await request.formData()).get('code')).toBe('native-test-code');
				tokenRequests++;
				const input = [
					{ alg: 'RS256', kid: jwk.kid },
					{
						sub: subject,
						iss: issuer,
						aud: 'test-client',
						iat: Math.floor(Date.now() / 1000),
						exp: Math.floor(Date.now() / 1000) + 3600
					}
				]
					.map((value) => Buffer.from(JSON.stringify(value)).toString('base64url'))
					.join('.');
				return Response.json({
					access_token: 'fixture-secret',
					token_type: 'Bearer',
					id_token:
						input +
						'.' +
						(invalidSignature
							? Buffer.alloc(256)
							: sign('RSA-SHA256', Buffer.from(input), privateKey)
						).toString('base64url')
				});
			}
		});
		const pending = await root.collection('users').create({
			email: 'native-pending-admin@example.test',
			role: 'admin',
			nickname: 'Existing admin',
			password: 'local-test-password-only',
			passwordConfirm: 'local-test-password-only'
		});
		const candidate = 'https://orcid.org/' + subject;
		const login = async () => {
			const response = await fetch(origin + '/api/collections/users/auth-with-oauth2', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					provider: 'oidc',
					code: 'native-test-code',
					codeVerifier: 'a'.repeat(43),
					redirectURL: 'http://127.0.0.1/callback',
					createData: { role: 'admin', nickname: 'Forged', orcidVerifiedAt: '2000-01-01' }
				})
			});
			return { status: response.status, body: await response.json() };
		};
		const fixture = (fail: boolean) =>
			root.send('/_test/native-oauth', {
				method: 'POST',
				body: { tokenURL: provider.url.origin + '/token', fail }
			});
		const links = (id: string) =>
			root.collection('_externalAuths').getFullList({ filter: `recordRef = '${id}'` });
		const createdIds: string[] = [];
		try {
			await root.send('/api/pure3d/orcid/pending/' + pending.id, {
				method: 'POST',
				body: { orcid: candidate }
			});
			const before = await root.collection('users').getOne(pending.id);
			const config = orcidAuthConfig('test-client', 'test-secret', environment);
			config.oauth2.providers[0].tokenURL = provider.url.origin + '/token';
			config.oauth2.providers[0].extra.jwksURL = origin + '/_test/jwks';
			await root.send('/_test/jwks', { method: 'POST', body: { keys: [jwk] } });
			await root.collections.update('users', config);
			await fixture(false);
			const first = await login();
			expect(first).toMatchObject({
				status: 200,
				body: {
					record: { id: pending.id, role: 'admin', nickname: 'Existing admin', orcid: candidate },
					meta: { isNew: false }
				}
			});
			expect(first.body.token).toBeTruthy();
			const saved = await root.collection('users').getOne(pending.id);
			expect(saved.pendingOrcid).toBe('');
			expect(saved.orcidVerifiedAt).toBeTruthy();
			expect(await links(pending.id)).toMatchObject([{ provider: 'oidc', providerId: subject }]);
			expect(await root.send('/_test/native-oauth')).toMatchObject({ saves: 1, responses: 1 });
			const returning = await login();
			expect(returning).toMatchObject({
				status: 200,
				body: {
					record: { id: pending.id, role: 'admin', orcidVerifiedAt: saved.orcidVerifiedAt },
					meta: { isNew: false }
				}
			});
			expect(await links(pending.id)).toHaveLength(1);
			const client = new PocketBase(origin);
			client.authStore.save(returning.body.token, returning.body.record);
			await expect(client.collection('users').authRefresh()).resolves.toBeDefined();
			for (const patch of [
				{ orcid: 'https://orcid.org/0000-0002-1825-0097' },
				{ orcidVerifiedAt: '2000-01-01', 'pure3d.orcid.proof': true }
			])
				await expect(client.collection('users').update(pending.id, patch)).rejects.toMatchObject({
					status: 400
				});
			// PocketBase ignores non-superuser writes to the hidden pending field.
			await client.collection('users').update(pending.id, { pendingOrcid: candidate });
			expect((await root.collection('users').getOne(pending.id)).pendingOrcid).toBe('');
			invalidSignature = true;
			expect(await login()).toMatchObject({
				status: 400,
				body: { message: 'Failed to fetch OAuth2 user.' }
			});
			invalidSignature = false;

			// Recreate the pre-proof pending state through a fresh account, not a privileged identity patch.
			await root.collection('users').delete(pending.id);
			await root.collection('users').create({
				id: pending.id,
				email: before.email,
				role: before.role,
				nickname: before.nickname,
				password: 'local-test-password-only',
				passwordConfirm: 'local-test-password-only'
			});
			await root.send('/api/pure3d/orcid/pending/' + pending.id, {
				method: 'POST',
				body: { orcid: candidate }
			});
			const rollbackBefore = await root.collection('users').getOne(pending.id);
			await fixture(true);
			expect(await login()).toMatchObject({
				status: 400,
				body: { message: 'Test native OAuth downstream rollback.' }
			});
			expect(await root.collection('users').getOne(pending.id)).toEqual(rollbackBefore);
			expect(await links(pending.id)).toHaveLength(0);
			expect(await root.send('/_test/native-oauth')).toMatchObject({ saves: 1, responses: 1 });
			await root.collection('users').delete(pending.id);
			// Same signed subject now has no candidate: new user must also roll back, then get least role.
			expect(await login()).toMatchObject({
				status: 400,
				body: { message: 'Test native OAuth downstream rollback.' }
			});
			expect(
				await root.collection('users').getFullList({ filter: `orcid = '${candidate}'` })
			).toHaveLength(0);
			expect(
				await root.collection('_externalAuths').getFullList({ filter: `providerId = '${subject}'` })
			).toHaveLength(0);
			await fixture(false);
			const fresh = await login();
			if (fresh.body.record) createdIds.push(fresh.body.record.id);
			expect(fresh).toMatchObject({
				status: 200,
				body: {
					record: { role: 'user', nickname: '', orcid: candidate, verified: true },
					meta: { isNew: true }
				}
			});
			expect(await root.collection('users').getOne(fresh.body.record.id)).toMatchObject({
				orcid: candidate,
				orcidVerifiedAt: fresh.body.record.orcidVerifiedAt,
				pendingOrcid: '',
				role: 'user'
			});
			expect(fresh.body.record.orcidVerifiedAt).toBeTruthy();
			expect(await links(fresh.body.record.id)).toMatchObject([
				{ provider: 'oidc', providerId: subject }
			]);
			expect(await root.send('/_test/native-oauth')).toMatchObject({ saves: 1, responses: 1 });
			expect(tokenRequests).toBe(6);
		} finally {
			await root.send('/_test/native-oauth', { method: 'POST', body: {} });
			await root.collections.update('users', {
				oauth2: definition.oauth2,
				passwordAuth: definition.passwordAuth,
				otp: definition.otp,
				authRule: definition.authRule
			});
			for (const id of [pending.id, ...createdIds])
				await root
					.collection('users')
					.delete(id)
					.catch((error) => {
						if (error.status !== 404) throw error;
					});
			provider.stop(true);
		}
	}
);

integration('JWKS-only update backs up and preserves sessions and identity records', async () => {
	await root.collections.update(
		'users',
		orcidAuthConfig('test-client', 'test-secret', environment)
	);
	const before = await root.collections.getOne('users');
	before.oauth2.providers[0].extra.jwksURL = issuer + '/oauth/jwks';
	await root.collections.update('users', { oauth2: before.oauth2 });
	const authenticated = await oauth({ subject: orcid.slice(18) });
	expect(authenticated.status).toBe(200);
	const records = await root.collection('users').getFullList();
	const result = await updateOrcidJwks(root);
	expect(
		(await root.backups.getFullList()).some(
			(backup) => backup.key === result.backup && backup.size > 0
		)
	).toBe(true);
	const after = await root.collections.getOne('users');
	expect(after.oauth2.providers[0].extra.jwksURL).toBe(result.jwksURL);
	expect(await root.collection('users').getFullList()).toEqual(records);
	expect(
		(
			await fetch(origin + '/api/collections/users/auth-refresh', {
				method: 'POST',
				headers: { Authorization: authenticated.body.token }
			})
		).status
	).toBe(200);
});

integration(
	'public readiness stays cheap while superuser credit audit validates canonical attribution',
	async () => {
		const endpoint = origin + '/api/pure3d/orcid/ready';
		const invalid = orcidAuthConfig('test-client', 'test-secret', environment);
		invalid.oauth2.providers[0].extra.jwksURL = issuer + '/oauth/jwks';
		await root.collections.update('users', invalid);
		const wrongIssuer = await fetch(endpoint);
		expect(wrongIssuer.status).toBe(503);
		expect((await wrongIssuer.json()).checks.auth).toBe(false);
		await root.collections.update(
			'users',
			orcidAuthConfig('test-client', 'test-secret', environment)
		);
		const ready = await fetch(endpoint);
		expect(ready.headers.get('cache-control')).toBe('no-store');
		const body = await ready.json();
		expect(body).toEqual({
			ready: true,
			checks: { hooks: true, auth: true, schema: true }
		});
		expect(ready.status).toBe(200);
		const missing = await root.collection('editions').create({
			title: 'Readiness inventory',
			status: 'draft',
			credits: [],
			dcCreator: ['  Repeated creator  ', '  Repeated creator  '],
			dcContributor: ['Contributor']
		});
		const credits = [
			{
				type: 'person',
				name: '  Repeated creator  ',
				orcid: null,
				role: 'creator',
				provenance: 'manual'
			},
			{
				type: 'person',
				name: '  Repeated creator  ',
				orcid: null,
				role: 'creator',
				provenance: 'manual'
			},
			{
				type: 'person',
				name: 'Contributor',
				orcid: null,
				role: 'contributor',
				provenance: 'manual'
			}
		];
		try {
			expect((await fetch(endpoint)).status).toBe(200);
			await root.send('/_test/null-credits/' + missing.id, { method: 'POST' });
			expect((await root.collection('editions').getOne(missing.id)).credits).toBeNull();
			// Release readiness checks deployable hooks/auth/schema; exhaustive data audit is operator-only.
			expect((await fetch(endpoint)).status).toBe(200);
			expect((await fetch(endpoint + '/credits-audit')).status).toBe(404);
			await expect(root.send('/api/pure3d/orcid/credits-audit')).rejects.toMatchObject({
				status: 503,
				response: {
					ready: false,
					checks: { hooks: true, auth: true, schema: true, credits: false }
				}
			});
			await root.collection('editions').update(missing.id, { credits });
			expect(await root.send('/api/pure3d/orcid/credits-audit')).toMatchObject({ ready: true }); // Missing ORCIDs remain allowed in preserved/draft attribution.
			await root.collection('editions').update(missing.id, { credits: [...credits].reverse() });
			expect((await fetch(endpoint)).status).toBe(200);
			const edited = [...credits]
				.reverse()
				.concat({ ...credits[2], name: 'Contributor added after migration' });
			await root.collection('editions').update(missing.id, { credits: edited });
			expect((await fetch(endpoint)).status).toBe(200);
			expect(await root.collection('editions').getOne(missing.id)).toMatchObject({
				credits: edited,
				dcCreator: ['  Repeated creator  ', '  Repeated creator  '],
				dcContributor: ['Contributor']
			});
			const config = await root.collections.getOne('notifications');
			await root.collections.update(config.id, { listRule: '' });
			try {
				const insecure = await fetch(endpoint);
				expect(insecure.status).toBe(503);
				expect((await insecure.json()).checks.schema).toBe(false);
			} finally {
				await root.collections.update(config.id, { listRule: config.listRule });
			}
			await root.collections.update('users', { passwordAuth: { enabled: true } });
			try {
				const legacyLogin = await fetch(endpoint);
				expect(legacyLogin.status).toBe(503);
				expect((await legacyLogin.json()).checks.auth).toBe(false);
			} finally {
				await root.collections.update('users', { passwordAuth: { enabled: false } });
			}
			expect((await fetch(endpoint)).status).toBe(200);
		} finally {
			await root.collection('editions').delete(missing.id);
		}
	}
);
