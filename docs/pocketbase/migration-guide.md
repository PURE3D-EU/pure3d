# PocketBase Migration Guide

Keep legacy attribution and membership intent intact while moving to ORCID-backed accounts.
The authoritative procedure is now [ORCID attribution, migration and onboarding](../orcid.md).
This replaces the old MongoDB-to-`projects` bootstrap and application-password examples.

## Choose the Right Workflow

- **Existing database:** use the explicit-target read-only inventory, reviewed credit manifest,
  backup-gated apply and private audit described in the ORCID guide. Do not run local bootstrap,
  delete the database, or reimport source records to resolve a conflict.
- **New isolated local database:** follow [local setup](../setup/from-scratch.md). The active
  `scripts/import-data.ts` reads `data/json-output/` and preserves deferred author memberships in
  private onboarding reports. Source counts depend on the actual backup; no fixed import total is promised.
- **Account preparation and cutover:** deploy the complete PocketBase hooks, use
  `scripts/configure-orcid.ts --prepare`, approve/read back pending mappings, then use `--apply`
  under maintenance isolation. Both write modes require verified backups. Cutover revokes existing
  application-user sessions; superuser recovery remains separate.

## Current Contracts

The application uses `collections`, `editions`, `collectionUsers`, `editionUsers`, and the workflow
collections defined in `pocketbase/pb_schema/collections.json`. Legacy `project` source documents
become `collections`; new code must not query an obsolete PocketBase `projects` collection.

Both content collections use ordered `credits` with exact names, duplicates, person/organization
types and creator/contributor roles. ORCIDs are optional for credits in the application; legacy
migration safeguards are separate. Never manufacture OAuth proof or silently downgrade an
unresolved author to a contributor/collaborator.

## Application Authentication

Use the existing `authStore.loginWithOrcid()` in `src/lib/database/stores/auth.svelte.ts`. It uses
PocketBase's `oidc` provider with `scopes: ['openid']`, checks verified ORCID identity and attempts
public-profile refresh. Do not restore application email/password login, anonymous seeded accounts,
or auth-response logging. Superuser password authentication is for protected operator/bootstrap
commands, not browser application accounts.

Register the exact OAuth callback, configure matching `ORCID_ENVIRONMENT` and backend `ORCID_ISSUER`,
and keep sandbox databases/credentials separate. See the [ORCID guide](../orcid.md) for the complete
security, backup, approval, audit and verification requirements.

## Troubleshooting

Preserve source JSON, reviewed manifests, private audits and backups. A partial import or migration
may have completed earlier records; read the per-record results before retrying. Never delete
`pocketbase/pb_data`, clear collections or weaken validation as a generic fix. Missing ORCID mappings,
unreviewed author assignments, snapshot conflicts and failed backup confirmation need explicit review.
