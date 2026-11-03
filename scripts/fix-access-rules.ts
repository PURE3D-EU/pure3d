#!/usr/bin/env bun
/**
 * Restore the checked-in read rules, never blanket public access.
 */
import schema from '../pocketbase/pb_schema/collections.json';
const PB_URL = process.env.POCKETBASE_URL || 'http://127.0.0.1:60021';
const ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD;

async function main() {
	const target = new URL(PB_URL);
	if (
		!['http:', 'https:'].includes(target.protocol) ||
		(!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) &&
			target.origin !== 'http://pocketbase:8090') ||
		target.username ||
		target.password ||
		target.search ||
		target.hash ||
		target.pathname !== '/'
	)
		throw new Error('Access-rule repair is restricted to a local PocketBase origin.');
	if (!ADMIN_EMAIL?.trim() || !ADMIN_PASSWORD?.trim())
		throw new Error('Set POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD explicitly.');
	// Authenticate
	const authResponse = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ identity: ADMIN_EMAIL, password: ADMIN_PASSWORD })
	});

	if (!authResponse.ok) {
		throw new Error(`Auth failed: ${await authResponse.text()}`);
	}

	const { token } = await authResponse.json();
	console.log('✅ Authenticated\n');

	const collections = ['site', 'collections', 'editions', 'collectionUsers', 'editionUsers'];

	for (const collectionName of collections) {
		console.log(`📝 Updating ${collectionName} access rules...`);

		// Get the collection
		const getResponse = await fetch(`${PB_URL}/api/collections/${collectionName}`, {
			headers: { Authorization: token }
		});

		if (!getResponse.ok) {
			console.log(`   ❌ Collection ${collectionName} not found`);
			continue;
		}

		const collection = await getResponse.json();

		const desired = schema.find((item) => item.name === collectionName)!;
		const updateResponse = await fetch(`${PB_URL}/api/collections/${collection.id}`, {
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json',
				Authorization: token
			},
			body: JSON.stringify({
				listRule: desired.listRule,
				viewRule: desired.viewRule
			})
		});

		if (updateResponse.ok) {
			console.log(`   ✅ ${collectionName} access rules updated`);
		} else {
			console.log(`   ❌ Failed to update ${collectionName}: ${await updateResponse.text()}`);
		}
	}

	console.log('\n✅ All access rules updated!');
}

main().catch((error) => {
	console.error('Access-rule repair failed:', error.message);
	process.exitCode = 1;
});
