import PocketBase, { ClientResponseError } from 'pocketbase';
import { emptyMenu } from '../src/lib/cms';
import { ensureOpenCalls, ensureProposalOpenCall } from './open-calls-schema';
import { ensureNewsletter } from './newsletter-schema';

const admin = '@request.auth.id != "" && @request.auth.role = "admin"';
export const learningMaterialFields = [
	{ name: 'learningMaterial', type: 'bool' },
	{ name: 'learningMaterialOrder', type: 'number' }
];
export const guideIntroduction =
	'<h2>Turn your 3D research into a scholarly edition.</h2><p>Bring your model, interpretation and supporting material together in a citable, interactive publication. Pure3D guides your edition from proposal through review to publication.</p><h2>Before you begin</h2><ul><li>Every individual author needs an ORCID iD before submission or publication, including co-authors. Contributor ORCIDs are optional. Organisations do not receive ORCID iDs. Preserve the credited name and author order; an account or a matching name is not identity proof.</li><li>A 3D object or dataset that is central to your scholarly argument.</li><li>Context, metadata and interpretive material for the edition.</li><li>Rights or permission to publish the assets you submit.</li></ul><h2>Resolve author identities before review</h2><p>Use a canonical ORCID link such as https://orcid.org/0000-0002-1825-0097 for each individual author. Ask co-authors to confirm their own identifier; do not infer it from a name search. Add organisations as organisation credits and distinguish creators from contributors.</p><p>If a legacy author cannot yet be identified, keep their original credit and contact the Pure3D team for review. An unresolved individual author’s ORCID is a submission and publication blocker, not a permanent exemption. ORCID sign-in proves account ownership; a manually confirmed credit does not create a verified account or grant editing access.</p><p><a href="/documentation/submission">Read submission guidelines</a> or <a href="/reviews">go to my work</a>.</p>';
export async function setupCms(pb: PocketBase) {
	await ensureNewsletter(pb);
	await ensureOpenCalls(pb);
	await ensureProposalOpenCall(pb);
	const audit = await pb.collections.getOne('auditLog');
	const target = audit.fields.find((field: { name: string }) => field.name === 'targetType');
	if (target && !target.values.includes('content')) {
		target.values = [...target.values, 'content'];
		await pb.collections.update(audit.id, { fields: audit.fields });
	}
	async function ensure(
		name: string,
		fields: Record<string, unknown>[],
		read: string,
		indexes: string[] = []
	) {
		let old;
		try {
			old = await pb.collections.getOne(name);
		} catch (e) {
			if (!(e instanceof ClientResponseError) || e.status !== 404) throw e;
		}
		const data = {
			name,
			type: 'base',
			fields: old
				? [
						...old.fields.filter((f: { name: string }) => !fields.some((n) => n.name === f.name)),
						...fields.map((f) => ({
							...old.fields.find((current: { name: string }) => current.name === f.name),
							...f
						}))
					]
				: fields,
			indexes,
			listRule: read,
			viewRule: read,
			createRule: admin,
			updateRule: admin,
			deleteRule: admin
		};
		return old ? pb.collections.update(old.id, data) : pb.collections.create(data);
	}
	const categories = await ensure(
		'cms_categories',
		[
			{ name: 'name', type: 'text', required: true, max: 100 },
			{ name: 'slug', type: 'text', required: true, pattern: '^[a-z0-9][a-z0-9-]*$' },
			{ name: 'description', type: 'text' }
		],
		'',
		['CREATE UNIQUE INDEX idx_cms_category_slug ON cms_categories (slug)']
	);
	const content = await ensure(
		'content',
		[
			{ name: 'title', type: 'text', required: true, max: 500 },
			{ name: 'slug', type: 'text', required: true, pattern: '^[a-z0-9][a-z0-9-]*$' },
			{ name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['page', 'post'] },
			{ name: 'layout', type: 'select', maxSelect: 1, values: ['standard', 'article', 'guide'] },
			{ name: 'body', type: 'editor', maxSize: 2000000 },
			{ name: 'summary', type: 'text', max: 3000 },
			{ name: 'coverUrl', type: 'url' },
			{ name: 'author', type: 'text' },
			{ name: 'publishedAt', type: 'date' },
			{ name: 'isPublished', type: 'bool' },
			...learningMaterialFields,
			{ name: 'documentationSeeded', type: 'bool' },
			{ name: 'categoryIds', type: 'relation', collectionId: categories.id, maxSelect: 100 },
			{ name: 'order', type: 'number' },
			{ name: 'section', type: 'text' },
			{ name: 'sourceId', type: 'number' },
			{ name: 'sourceUrl', type: 'url' },
			{ name: 'sourceModified', type: 'text' },
			{ name: 'categories', type: 'json' },
			{ name: 'importNotes', type: 'text' },
			{ name: 'created', type: 'autodate', onCreate: true },
			{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
		],
		`isPublished = true || (${admin})`,
		[
			"CREATE UNIQUE INDEX idx_content_resource_slug ON content (slug) WHERE layout != 'guide'",
			"CREATE UNIQUE INDEX idx_content_guide_slug ON content (slug) WHERE layout = 'guide'",
			'CREATE UNIQUE INDEX idx_content_source ON content (sourceId) WHERE sourceId > 0'
		]
	);
	if (!content.fields.some((f: { name: string }) => f.name === 'parent'))
		await pb.collections.update(content.id, {
			fields: [
				...content.fields,
				{
					name: 'parent',
					type: 'relation',
					collectionId: content.id,
					maxSelect: 1,
					cascadeDelete: false
				}
			]
		});
	await ensure(
		'content_assets',
		[
			{
				name: 'content',
				type: 'relation',
				collectionId: content.id,
				maxSelect: 1,
				cascadeDelete: false
			},
			{ name: 'sourceUrl', type: 'url' },
			{ name: 'caption', type: 'text' },
			{ name: 'alt', type: 'text' },
			{
				name: 'file',
				type: 'file',
				required: true,
				maxSelect: 1,
				maxSize: 30000000,
				mimeTypes: [
					'image/jpeg',
					'image/png',
					'image/webp',
					'image/avif',
					'image/gif',
					'application/pdf',
					'audio/mpeg',
					'video/mp4'
				]
			}
		],
		admin
	);
	for (const name of ['cms_menus', 'cms_menu_drafts'])
		await ensure(
			name,
			[
				{ name: 'slot', type: 'select', required: true, maxSelect: 1, values: ['main', 'footer'] },
				{ name: 'config', type: 'json', required: true, maxSize: 200000 },
				{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
			],
			name === 'cms_menus' ? '' : admin,
			[`CREATE UNIQUE INDEX idx_${name}_slot ON ${name} (slot)`]
		);
	for (const name of ['cms_menus', 'cms_menu_drafts'])
		for (const slot of ['main', 'footer'])
			if (
				!(await pb.collection(name).getFullList({ filter: pb.filter('slot = {:slot}', { slot }) }))
					.length
			)
				await pb.collection(name).create({ slot, config: emptyMenu() });
	if (
		!(
			await pb
				.collection('content')
				.getFullList({ filter: 'layout = "guide" && slug = "documentation"' })
		).length
	)
		await pb.collection('content').create({
			title: 'Publish with us',
			slug: 'documentation',
			kind: 'page',
			layout: 'guide',
			section: 'publish',
			isPublished: true,
			order: -1,
			summary: 'Create and publish a peer-reviewed 3D scholarly edition with Pure3D.',
			body: guideIntroduction
		});
	return content;
}
