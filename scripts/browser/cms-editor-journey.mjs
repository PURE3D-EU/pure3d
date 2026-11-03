/** Run with a Playwright Page against an existing local Vite server.
 * All backend calls are intercepted: no application credentials or remote writes.
 * Execute this file with Playwright MCP browser_run_code_unsafe filename.
 * The function accepts an optional local baseURL as its second argument.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- MCP invokes this function with its managed page.
async function runCmsEditorJourney(page, baseURL = 'http://127.0.0.1:60120') {
	if (!['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname))
		throw new Error('This journey must use a local development server.');
	const assert = (condition, message) => {
		if (!condition) throw new Error(message);
	};
	const profile = (name) =>
		`<article data-cms-profile="true" data-name="${name}" data-role="Researcher" data-bio="Biography of ${name}" data-image="/test-photo.png" data-alt="Portrait of ${name}"><img src="/test-photo.png" alt="Portrait of ${name}"><div><h3>${name}</h3><p>Researcher</p><p>Biography of ${name}</p></div><div data-cms-profile-links="true"><a data-cms-profile-link="true" href="https://example.org/${name}">Website</a><a data-cms-profile-link="true" href="mailto:${name}@example.org">Email</a></div></article>`;
	const initial = `<h2>Current members</h2><section data-cms-profiles="true">${profile('Alice')}${profile('Bea')}</section><h2>Past members</h2><section data-cms-profiles="true">${profile('Chris')}</section><aside data-cms-callout="info"><p>Existing callout</p></aside><div data-cms-logo-grid="true"><figure data-cms-logo="true" data-name="Institute" data-image="/test-photo.png" data-alt="Institute logo" data-href="https://example.org/institute"><a href="https://example.org/institute"><img src="/test-photo.png" alt="Institute logo"></a><figcaption>Institute</figcaption></figure></div><dl data-cms-project-facts="true"><div data-cms-project-fact="true" data-label="Funder" data-value="Research council"><dt>Funder</dt><dd>Research council</dd></div></dl><div data-cms-actions="true"><a data-cms-action="primary" href="https://example.org/start">Start</a><a data-cms-action="secondary" href="/team">Team</a></div><div data-cms-editions="editionone,editiontwo"></div><div data-cms-open-calls="true" data-open-call-ids="call00000000001,call00000000002"></div><details data-cms-expandable="true"><summary>Existing title</summary><p>Existing section body</p></details><figure data-content-image="true"><img src="/test-photo.png" alt="Existing image"><figcaption>Existing caption</figcaption></figure>${[2, 3, 4].map((count) => `<section data-cms-columns="${count}">${Array.from({ length: count }, (_, i) => `<div data-cms-column="true"><p>Column ${count}.${i + 1}</p>${i === 0 ? '<aside data-cms-callout="info"><p>Nested callout</p></aside>' : ''}</div>`).join('')}</section>`).join('')}<p>End of imported content</p>`;
	let record = {
		id: 'page00000000001',
		collectionName: 'content',
		title: 'Editor regression',
		slug: 'editor-regression',
		kind: 'page',
		section: 'about',
		layout: 'standard',
		body: initial.replace(
			'<p>Existing callout</p></aside>',
			'<p>Existing callout</p><aside data-cms-callout="warning"><p>Nested warning</p></aside></aside>'
		),
		isPublished: true,
		updated: '2026-11-03 10:00:00.000Z',
		created: '2026-11-01 10:00:00.000Z',
		parent: '',
		order: 0
	};
	let saves = 0;
	const user = {
		id: 'admin0000000001',
		collectionName: 'users',
		email: 'cms-test@example.org',
		role: 'admin',
		verified: true
	};
	const token = `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test`;
	await page.unroute('**/api/**');
	await page.route('**/api/**', async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		if (url.pathname.startsWith('/api/files/'))
			return route.fulfill({
				contentType: 'image/svg+xml',
				body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#25634b"/></svg>'
			});
		const json = (value) =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
		if (url.pathname.includes('auth-refresh')) return json({ token, record: user });
		if (url.pathname.includes('/realtime')) return route.abort();
		const collection = url.pathname.match(/\/collections\/([^/]+)\/records(?:\/([^/]+))?/);
		if (collection) {
			const [, name, id] = collection;
			if (name === 'content' && request.method() === 'PATCH') {
				record = {
					...record,
					...request.postDataJSON(),
					updated: `2026-11-03 10:01:${String(++saves).padStart(2, '0')}.000Z`
				};
				return json(record);
			}
			if (name === 'content_assets' && request.method() === 'POST')
				return json({
					id: 'asset0000000001',
					collectionName: 'content_assets',
					file: 'uploaded.png',
					alt: 'Uploaded photo'
				});
			let items = [];
			if (name === 'content') items = [record];
			if (name === 'users') items = [user];
			if (name === 'editions')
				items = ['editionone', 'editiontwo'].map((id, i) => ({
					id,
					title: `Edition ${i + 1}`,
					dcTitle: `Edition ${i + 1}`,
					isPublished: true
				}));
			if (name === 'open_calls')
				items = ['call00000000001', 'call00000000002'].map((id, i) => ({
					id,
					title: `Call ${i + 1}`,
					isPublished: true,
					body: '<p>Call details</p>'
				}));
			if (name === 'content_assets')
				items = [
					{
						id: 'asset0000000001',
						collectionName: 'content_assets',
						file: 'library.png',
						alt: 'Library description',
						caption: 'Library photo'
					}
				];
			return json(
				id
					? items.find((item) => item.id === id) || {}
					: { page: 1, perPage: 200, totalItems: items.length, totalPages: 1, items }
			);
		}
		return json({ items: [], primary: [], footer: [] });
	});
	await page.route('**/test-photo.png', (route) =>
		route.fulfill({
			contentType: 'image/svg+xml',
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#25634b"/></svg>'
		})
	);
	const publicEnv = await (
		await page.request.get(`${baseURL}/@id/__x00__virtual:env/static/public`)
	).text();
	const backendURL = JSON.parse(
		publicEnv.match(/export const PUBLIC_POCKETBASE_URL = ("[^"]*")/)?.[1] ||
			'"https://api.pure3d.eu"'
	).replace(/\/+$/, '');
	await page.addInitScript(
		({ token, user, backendURL }) => {
			localStorage.setItem(
				`pure3d:dev:${backendURL}:auth`,
				JSON.stringify({ token, record: user })
			);
		},
		{ token, user, backendURL }
	);
	await page.goto(`${baseURL}/admin/pages?edit=${record.id}`);
	const editor = page.locator('#rich-text-editor');
	await editor.getByRole('button', { name: 'Edit profile cards', exact: true }).first().waitFor();
	const dialog = page.locator('dialog[open]');
	const save = () => dialog.getByRole('button', { name: 'Save', exact: true }).click();
	const open = (name, index = 0) =>
		editor
			.getByRole('button', { name: `Edit ${name}`, exact: true })
			.nth(index)
			.click();
	await open('profile cards');
	await dialog.getByLabel('Name', { exact: true }).first().fill('Cancelled name');
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await open('profile cards');
	assert(
		(await dialog.getByLabel('Name', { exact: true }).first().inputValue()) === 'Alice',
		'Cancel mutated an imported profile'
	);
	await dialog.getByLabel('Name', { exact: true }).first().fill('Alice edited');
	await dialog.getByLabel('Biography', { exact: true }).first().fill('Edited biography');
	await dialog.getByRole('button', { name: 'Add profile', exact: true }).click();
	await dialog
		.locator('fieldset.component-form-card')
		.last()
		.getByRole('button', { name: 'Remove', exact: true })
		.first()
		.click();
	const profileLinks = dialog
		.locator('fieldset.component-form-card')
		.first()
		.locator('.component-link-list');
	await profileLinks.getByRole('button', { name: 'Add link', exact: true }).click();
	await profileLinks.getByLabel('Label', { exact: true }).last().fill('Additional link');
	await profileLinks
		.getByLabel('Destination', { exact: true })
		.last()
		.fill('https://example.org/additional');
	await profileLinks.getByRole('button', { name: 'Move up', exact: true }).last().click();
	await profileLinks.getByRole('button', { name: 'Remove', exact: true }).nth(1).click();
	await dialog.getByRole('button', { name: 'Move down', exact: true }).first().click();
	await save();
	assert(saves === 0, 'Component edit saved the page automatically');
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	assert(
		!(await editor
			.locator('.tiptap')
			.innerText()
			.then((text) => text.includes('Alice edited'))),
		'Undo did not restore profile'
	);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await open('profile cards');
	await dialog.getByLabel('Move to profile block').nth(1).selectOption({ index: 1 });
	await save();
	for (const [name, field, value] of [
		['logo grid', 'Name', 'Institute edited'],
		['project facts', 'Value', 'Council edited'],
		['action links', 'Primary action label', 'Start edited'],
		['expandable section', 'Section title', 'Title edited']
	]) {
		await open(name);
		await dialog.getByLabel(field, { exact: true }).first().fill(value);
		if (name === 'action links') {
			await dialog
				.getByLabel('Primary action destination', { exact: true })
				.fill('javascript:alert(1)');
			await save();
			await dialog.getByRole('alert').waitFor();
			await dialog
				.getByLabel('Primary action destination', { exact: true })
				.fill('https://example.org/start');
		}
		if (name === 'logo grid' || name === 'project facts') {
			const label = name === 'logo grid' ? 'logo' : 'fact';
			await dialog.getByRole('button', { name: `Add ${label}`, exact: true }).click();
			const item = dialog.locator('fieldset.component-form-card').last();
			await item
				.getByLabel(name === 'logo grid' ? 'Name' : 'Label', { exact: true })
				.fill('Temporary item');
			if (name === 'logo grid')
				await item.getByLabel('Image URL', { exact: true }).fill('/test-photo.png');
			else await item.getByLabel('Value', { exact: true }).fill('Temporary value');
			await item.getByRole('button', { name: 'Move up', exact: true }).click();
			await dialog
				.locator('fieldset.component-form-card')
				.first()
				.getByRole('button', { name: 'Remove', exact: true })
				.click();
		}
		await save();
	}
	await open('callout');
	await dialog.getByLabel('Callout style').selectOption('success');
	await save();
	await open('columns');
	await dialog.getByLabel('Column count').selectOption('3');
	await save();
	await editor.locator('[data-cms-column] > p').first().fill('Edited nested column text');
	const profileBlock = editor
		.locator('.cms-component-node')
		.filter({ has: page.locator(':scope > section[data-cms-profiles]') })
		.first();
	const blockCount = await editor.locator('section[data-cms-profiles]').count();
	await profileBlock.getByRole('button', { name: 'Duplicate profile cards', exact: true }).click();
	assert(
		(await editor.locator('section[data-cms-profiles]').count()) === blockCount + 1,
		'Duplicate failed'
	);
	await editor
		.locator('section[data-cms-profiles]')
		.nth(1)
		.locator('..')
		.getByRole('button', { name: 'Move down profile cards', exact: true })
		.click();
	await editor
		.locator('section[data-cms-profiles]')
		.nth(1)
		.locator('..')
		.getByRole('button', { name: 'Delete profile cards', exact: true })
		.click();
	assert(
		(await editor.locator('section[data-cms-profiles]').count()) === blockCount,
		'Delete failed'
	);
	const urlBeforeLink = page.url();
	await editor.locator('a[data-cms-profile-link]').first().click();
	assert(page.url() === urlBeforeLink, 'Preview link navigated away');
	await open('image');
	await dialog.getByRole('button', { name: 'Choose from media library', exact: true }).click();
	await dialog.getByRole('button', { name: 'Library photo', exact: true }).click();
	await dialog.getByRole('button', { name: 'Remove image', exact: true }).click();
	await dialog.locator('input[type=file]').setInputFiles({
		name: 'portrait.png',
		mimeType: 'image/png',
		buffer: Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN4cAAAAASUVORK5CYII=',
			'base64'
		)
	});
	await dialog.getByRole('button', { name: 'Remove image', exact: true }).waitFor();
	await dialog.getByLabel('Image description', { exact: true }).fill('Image edited');
	await save();
	for (const name of ['edition grid', 'open calls']) {
		await open(name);
		await editor
			.getByRole('list', { name: /^Selected/ })
			.getByRole('button', { name: /^Move .* down$/ })
			.first()
			.click();
		await editor.getByRole('button', { name: `Save ${name}`, exact: true }).click();
	}
	// New blocks use exactly the same editing interface as imported ones.
	for (const label of [
		'Two columns',
		'Three columns',
		'Four columns',
		'Callout',
		'Profile cards',
		'Logo grid',
		'Project facts',
		'Action links',
		'Edition grid',
		'Open calls',
		'Expandable section'
	]) {
		await editor.locator('.tiptap > p').last().click();
		await editor.locator('summary[aria-label="Insert component"]').click();
		const count = await editor.locator('.cms-component-node').count();
		await editor
			.locator('.component-menu')
			.getByRole('button', { name: label, exact: true })
			.click();
		if (label === 'Profile cards') {
			await dialog.getByLabel('Name', { exact: true }).fill('New member');
			await save();
		} else if (label === 'Logo grid') {
			await dialog.getByLabel('Name', { exact: true }).fill('New institute');
			await dialog.getByLabel('Image URL', { exact: true }).fill('/test-photo.png');
			await save();
		} else if (label === 'Project facts') {
			await dialog.getByLabel('Label', { exact: true }).fill('New fact');
			await dialog.getByLabel('Value', { exact: true }).fill('New value');
			await save();
		} else if (label === 'Action links') {
			await dialog.getByLabel('Primary action label', { exact: true }).fill('New action');
			await dialog.getByLabel('Primary action destination', { exact: true }).fill('/resources');
			await save();
		} else if (label === 'Edition grid' || label === 'Open calls') {
			await editor
				.getByRole('button', {
					name: label === 'Edition grid' ? 'Edition 1 · editionone' : 'Call 1 · call00000000001',
					exact: true
				})
				.click();
			await editor
				.getByRole('button', { name: `Save ${label.toLowerCase()}`, exact: true })
				.click();
		}
		assert(
			(await editor.locator('.cms-component-node').count()) === count + 1,
			`Insertion failed: ${label}`
		);
		const added = editor.locator('.cms-component-node').last();
		assert(
			(await added
				.locator(':scope > .cms-component-controls')
				.getByRole('button', { name: /^Edit / })
				.count()) === 1,
			`Inserted ${label} has no Edit control`
		);
		await added
			.locator(':scope > .cms-component-controls')
			.getByRole('button', { name: /^Delete / })
			.click();
		assert(
			(await editor.locator('.cms-component-node').count()) === count,
			`Removing inserted ${label} failed`
		);
	}
	await page.getByRole('button', { name: 'Save changes', exact: true }).click();
	await page.waitForFunction(() =>
		[...document.querySelectorAll('button')].some(
			(button) => button.textContent.trim() === 'Save changes' && button.disabled
		)
	);
	assert(saves === 1, 'Save changes did not persist exactly once');
	for (const value of [
		'Alice edited',
		'Edited biography',
		'mailto:Alice@example.org',
		'Institute edited',
		'Council edited',
		'Start edited',
		'Title edited',
		'Image edited',
		'Column 4.4',
		'Nested callout',
		'Edited nested column text',
		'uploaded.png'
	])
		assert(record.body.includes(value), `Save lost ${value}`);
	assert(!record.body.includes('cms-component-controls'), 'Editor controls leaked into saved HTML');
	assert(
		record.body.includes('data-cms-editions="editiontwo,editionone"'),
		'Edition ordering was lost'
	);
	assert(
		record.body.includes('data-open-call-ids="call00000000002,call00000000001"'),
		'Open call ordering was lost'
	);
	const profileSections = [
		...record.body.matchAll(/<section data-cms-profiles="true">([\s\S]*?)<\/section>/g)
	];
	assert(
		!profileSections[0][1].includes('Alice edited') &&
			profileSections[1][1].includes('Alice edited'),
		'Profile transfer did not persist'
	);
	assert(
		record.body.includes(
			'data-cms-callout="success"><p>Existing callout</p><aside data-cms-callout="warning"'
		),
		'Editing the outer callout changed its nested callout'
	);
	await page.reload();
	await editor.getByRole('button', { name: 'Edit profile cards', exact: true }).first().waitFor();
	assert((await editor.innerText()).includes('Alice edited'), 'Reload lost saved profile');
	await page.goto(`${baseURL}/resources/editor-regression`);
	await page.getByText('Alice edited', { exact: true }).waitFor();
	assert(
		(await page.locator('[data-cms-profiles] img').count()) === 3,
		'Public rendering lost profile photos'
	);
	assert(
		(await page.locator('.cms-component-controls').count()) === 0,
		'Public page exposed editor controls'
	);
	return {
		saves,
		preserved: true,
		publicRendering: true,
		backend: 'Playwright HTTP boundary double'
	};
}
