#!/usr/bin/env bun
import schema from '../pocketbase/pb_schema/collections.json';

const url = process.env.POCKETBASE_URL || 'http://127.0.0.1:60021';
const email = process.env.POCKETBASE_ADMIN_EMAIL;
const password = process.env.POCKETBASE_ADMIN_PASSWORD;

if (!email || !password)
	throw new Error('Set POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD before migrating.');

const definition = schema.find((collection) => collection.name === 'editions');
if (!definition) throw new Error('Editions schema is missing.');
const proposalFieldNames = new Set([
	'proposalType',
	'proposalPurpose',
	'proposalModelReferences',
	'proposalArgument',
	'proposalThreeDRationale',
	'proposalAudience',
	'proposalContextualMaterial',
	'proposalHasExistingModel',
	'proposalModelSources',
	'proposalCopyrightOwnership',
	'proposalDigitisationSituation',
	'proposalSupportingLinks',
	'proposalSupportingFiles',
	'proposalModels',
	'proposalModelFiles',
	'proposalModelAssets',
	'proposalModelScenes',
	'proposalAuthorAffiliations',
	'proposalSnapshot',
	'proposalSubmittedAt'
]);

const login = await fetch(`${url}/api/collections/_superusers/auth-with-password`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ identity: email, password })
});
if (!login.ok) throw new Error(`Authentication failed: ${await login.text()}`);
const { token } = await login.json();
const headers = { 'Content-Type': 'application/json', Authorization: token };
const response = await fetch(`${url}/api/collections/editions`, { headers });
if (!response.ok) throw new Error(`Could not load editions: ${await response.text()}`);
const editions = await response.json();
const fields = editions.fields || [];
for (const field of definition.fields) {
	if (
		proposalFieldNames.has(field.name) &&
		!fields.some((existing: { name: string }) => existing.name === field.name)
	)
		fields.push(field);
}
const update = await fetch(`${url}/api/collections/${editions.id}`, {
	method: 'PATCH',
	headers,
	body: JSON.stringify({ fields })
});
if (!update.ok) throw new Error(`Could not update editions: ${await update.text()}`);
console.log('Proposal fields installed. Proposal model uploads are limited to 200 MB per file.');
