import PocketBase, { ClientResponseError } from 'pocketbase';

const admin = '@request.auth.id != "" && @request.auth.role = "admin"';
const dates = [
	{ name: 'created', type: 'autodate', onCreate: true },
	{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
];
const consentFields = [
	{
		name: 'consentSource',
		type: 'select',
		maxSelect: 1,
		values: ['email_confirmation', 'admin_recorded']
	},
	{ name: 'consentNote', type: 'text', max: 1000 },
	{ name: 'consentRecordedBy', type: 'text' },
	{ name: 'consentRecordedAt', type: 'date' }
];
export const newsletterCollections = [
	{
		name: 'newsletter_subscribers',
		fields: [
			{ name: 'email', type: 'email', required: true },
			{
				name: 'status',
				type: 'select',
				required: true,
				maxSelect: 1,
				values: ['pending', 'subscribed', 'unsubscribed']
			},
			{ name: 'confirmationHash', type: 'text', hidden: true },
			{ name: 'unsubscribeToken', type: 'text', hidden: true },
			{ name: 'confirmationExpires', type: 'date', hidden: true },
			{ name: 'requestedAt', type: 'date' },
			{ name: 'confirmedAt', type: 'date' },
			{ name: 'unsubscribedAt', type: 'date' },
			...consentFields,
			...dates
		],
		indexes: ['CREATE UNIQUE INDEX idx_newsletter_email ON newsletter_subscribers (email)']
	},
	{
		name: 'newsletter_campaigns',
		fields: [
			{ name: 'subject', type: 'text', required: true, max: 200 },
			{ name: 'body', type: 'text', required: true, max: 20000 },
			{
				name: 'status',
				type: 'select',
				required: true,
				maxSelect: 1,
				values: ['draft', 'sending', 'sent']
			},
			...dates
		],
		indexes: []
	},
	{
		name: 'newsletter_deliveries',
		fields: [
			{ name: 'campaign', type: 'text', required: true },
			{ name: 'subscriber', type: 'text', required: true },
			{
				name: 'status',
				type: 'select',
				required: true,
				maxSelect: 1,
				values: ['pending', 'sending', 'sent', 'failed', 'skipped']
			},
			...dates
		],
		indexes: [
			'CREATE UNIQUE INDEX idx_newsletter_delivery ON newsletter_deliveries (campaign, subscriber)'
		]
	}
];

export async function ensureNewsletter(pb: PocketBase) {
	for (const definition of newsletterCollections) {
		const expected = {
			...definition,
			type: 'base',
			listRule: admin,
			viewRule: admin,
			createRule: null,
			updateRule: null,
			deleteRule: null
		};
		let existing;
		try {
			existing = await pb.collections.getOne(definition.name);
		} catch (error) {
			if (!(error instanceof ClientResponseError) || error.status !== 404) throw error;
		}
		if (!existing) {
			await pb.collections.create(expected);
			existing = await pb.collections.getOne(definition.name);
		}
		const additions: typeof consentFields = [];
		for (const field of definition.fields) {
			const actual = existing.fields.find((candidate) => candidate.name === field.name);
			if (
				!actual &&
				definition.name === 'newsletter_subscribers' &&
				consentFields.some((item) => item.name === field.name)
			) {
				additions.push(field);
				continue;
			}
			if (
				!actual ||
				Object.entries(field).some(
					([key, value]) => JSON.stringify(actual[key]) !== JSON.stringify(value)
				)
			)
				throw new Error(`Newsletter schema mismatch: ${definition.name}.${field.name}`);
		}
		for (const key of ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule'] as const)
			if (existing[key] !== expected[key])
				throw new Error(`Newsletter permissions mismatch: ${definition.name}.${key}`);
		if (definition.indexes.some((index) => !existing.indexes.includes(index)))
			throw new Error(`Newsletter indexes mismatch: ${definition.name}`);
		if (additions.length) {
			await pb.collections.update(existing.id, { fields: [...existing.fields, ...additions] });
			const saved = await pb.collections.getOne(existing.id);
			for (const field of additions) {
				const actual = saved.fields.find((candidate) => candidate.name === field.name);
				if (
					!actual ||
					Object.entries(field).some(
						([key, value]) => JSON.stringify(actual[key]) !== JSON.stringify(value)
					)
				)
					throw new Error(`Newsletter consent field read-back mismatch: ${field.name}`);
			}
		}
	}
}
