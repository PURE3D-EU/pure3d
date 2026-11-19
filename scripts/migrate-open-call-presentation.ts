#!/usr/bin/env bun
import PocketBase from 'pocketbase';
import { isDeepStrictEqual } from 'node:util';
import { openCallPresentationFields } from './open-calls-schema';
import { verifiedProductionBackup } from './production-backup';

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--apply'))
	throw new Error('Usage: bun --env-file=.env scripts/migrate-open-call-presentation.ts [--apply]');
const origin = 'https://main.57-129-98-223.sslip.io';
if (new URL(process.env.PROD_POCKETBASE_URL || '').origin !== origin)
	throw new Error('Production origin must match the approved OVH backend.');
const email = process.env.POCKETBASE_PRODUCTION_ADMIN_EMAIL;
const password = process.env.POCKETBASE_PRODUCTION_ADMIN_PASSWORD;
if (!email || !password) throw new Error('Production credentials required.');
const pb = new PocketBase(origin);
await pb.collection('_superusers').authWithPassword(email, password);
const before = await pb.collections.getOne('open_calls');
const missing = openCallPresentationFields.filter((field) => {
	const existing = before.fields.find((candidate) => candidate.name === field.name);
	if (!existing) return true;
	if (Object.entries(field).some(([key, value]) => !isDeepStrictEqual(existing[key], value)))
		throw new Error(`Existing field differs: ${field.name}. Reconcile manually.`);
	return false;
});
if (!missing.length) {
	console.log('Cover and short description fields already exist; no changes needed.');
	process.exit(0);
}
console.log(
	`Preflight: add optional fields to open_calls: ${missing.map(({ name }) => name).join(', ')}.`
);
if (!args.includes('--apply')) process.exit(0);
await verifiedProductionBackup(pb, 'open-call-presentation-before');
const current = await pb.collections.getOne('open_calls');
if (!isDeepStrictEqual(current, before))
	throw new Error('Collection changed during backup. Retry after reviewing the changes.');
await pb.collections.update(before.id, { fields: [...before.fields, ...missing] });
const after = await pb.collections.getOne('open_calls');
for (const field of openCallPresentationFields) {
	const saved = after.fields.find((candidate) => candidate.name === field.name);
	if (!saved || Object.entries(field).some(([key, value]) => !isDeepStrictEqual(saved[key], value)))
		throw new Error(`Field readback failed: ${field.name}`);
}
for (const field of before.fields)
	if (
		!isDeepStrictEqual(
			after.fields.find((candidate) => candidate.id === field.id),
			field
		)
	)
		throw new Error(`Unrelated field changed: ${field.name}`);
for (const rule of ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule'] as const)
	if (before[rule] !== after[rule]) throw new Error(`Permission changed: ${rule}`);
console.log('Cover and short description verified; existing fields and permissions preserved.');
