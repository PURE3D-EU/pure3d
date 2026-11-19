import PocketBase, { ClientResponseError } from 'pocketbase';

export const openCallsAdminRule = '@request.auth.id != "" && @request.auth.role = "admin"';
export const openCallsReadRule = `isPublished = true || (${openCallsAdminRule})`;
export const openCallPresentationFields = [
	{
		name: 'cover',
		type: 'file',
		maxSelect: 1,
		maxSize: 10000000,
		mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
		protected: false
	},
	{ name: 'shortDescription', type: 'text', required: false, max: 300 }
];
export const openCallsFields = [
	{ name: 'title', type: 'text', required: true, max: 500 },
	...openCallPresentationFields,
	{ name: 'body', type: 'editor', maxSize: 2000000 },
	{ name: 'deadline', type: 'date' },
	{ name: 'isPublished', type: 'bool' },
	{ name: 'order', type: 'number' },
	{ name: 'created', type: 'autodate', onCreate: true },
	{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
];

export async function ensureOpenCalls(pb: PocketBase) {
	try {
		const existing = await pb.collections.getOne('open_calls');
		const missing = [];
		for (const field of openCallsFields) {
			const actual = existing.fields.find((candidate) => candidate.name === field.name);
			if (!actual && openCallPresentationFields.some(({ name }) => name === field.name)) {
				missing.push(field);
				continue;
			}
			if (
				!actual ||
				Object.entries(field).some(
					([key, value]) => JSON.stringify(actual[key]) !== JSON.stringify(value)
				)
			)
				throw new Error(`Existing open_calls schema differs: ${field.name}. Reconcile manually.`);
		}
		if (
			existing.listRule !== openCallsReadRule ||
			existing.viewRule !== openCallsReadRule ||
			[existing.createRule, existing.updateRule, existing.deleteRule].some(
				(rule) => rule !== openCallsAdminRule
			)
		)
			throw new Error('Existing open_calls permissions differ. Reconcile manually.');
		return missing.length
			? pb.collections.update(existing.id, { fields: [...existing.fields, ...missing] })
			: existing;
	} catch (error) {
		if (!(error instanceof ClientResponseError) || error.status !== 404) throw error;
	}
	return pb.collections.create({
		name: 'open_calls',
		type: 'base',
		fields: openCallsFields,
		listRule: openCallsReadRule,
		viewRule: openCallsReadRule,
		createRule: openCallsAdminRule,
		updateRule: openCallsAdminRule,
		deleteRule: openCallsAdminRule
	});
}

export async function ensureProposalOpenCall(pb: PocketBase) {
	const calls = await pb.collections.getOne('open_calls');
	const editions = await pb.collections.getOne('editions');
	const definition = {
		name: 'proposalOpenCall',
		type: 'relation',
		collectionId: calls.id,
		maxSelect: 1,
		required: false,
		cascadeDelete: false
	};
	const existing = editions.fields.find((field) => field.name === definition.name);
	if (existing) {
		if (Object.entries(definition).some(([key, value]) => existing[key] !== value))
			throw new Error('Existing proposalOpenCall relation differs. Reconcile manually.');
		return editions;
	}
	return pb.collections.update(editions.id, { fields: [...editions.fields, definition] });
}
