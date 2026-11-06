#!/usr/bin/env bun
import PocketBase, { ClientResponseError } from 'pocketbase';
import { ensureNewsletter, newsletterCollections } from './newsletter-schema';
import { verifiedProductionBackup } from './production-backup';

async function main() {
	if (process.argv.slice(2).some((arg) => arg !== '--apply'))
		throw new Error('Usage: bun --env-file=.env scripts/migrate-newsletter.ts [--apply]');
	const origin = 'https://main.57-129-98-223.sslip.io';
	if (new URL(process.env.PROD_POCKETBASE_URL || '').origin !== origin)
		throw new Error('Production origin must match the approved backend.');
	const email = process.env.POCKETBASE_PRODUCTION_ADMIN_EMAIL;
	const password = process.env.POCKETBASE_PRODUCTION_ADMIN_PASSWORD;
	if (!email || !password) throw new Error('Production credentials required.');
	const pb = new PocketBase(origin);
	await pb.collection('_superusers').authWithPassword(email, password);
	const existing = await pb.collections.getFullList();
	for (const definition of newsletterCollections) {
		const collection = existing.find((item) => item.name === definition.name);
		const missing = collection
			? definition.fields.filter(
					(field) => !collection.fields.some((item) => item.name === field.name)
				)
			: [];
		console.log(
			`${definition.name}: ${!collection ? 'will create' : missing.length ? `will add fields: ${missing.map((field) => field.name).join(', ')}` : 'exists; will verify'}`
		);
	}
	if (!process.argv.includes('--apply')) return;
	await verifiedProductionBackup(pb, 'newsletter-before');
	await ensureNewsletter(pb);
	console.log('Newsletter collections created and permissions verified. Hooks deploy separately.');
}

main().catch((error) => {
	// SDK error objects can contain authenticated request details; never dump them.
	console.error(
		error instanceof ClientResponseError
			? `Newsletter migration failed (PocketBase status ${error.status}). Inspect state before retrying.`
			: error instanceof Error
				? error.message
				: 'Newsletter migration failed.'
	);
	process.exitCode = 1;
});
