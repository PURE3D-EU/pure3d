# October 2026 legacy website recovery

Read this before returning to the original archive. This is a historical recovery receipt and
starting point, not permission to repeat production writes. Re-discover current records, storage,
services and authorisation before acting.

## Original archive and authoritative content

Original ZIP:

```text
/Volumes/DATA-ext/PROJECTS/eScience Center/Pure 3D -2/Full backup - 06 Oct 2026.zip
```

The archive contains backend files and a separate WordPress backup. Inside
`Full backup - 06 Oct 2026/backend backup/`, use:

- `published/prod/project/<collection number>/db.json` for collection metadata.
- `published/prod/project/<collection number>/edition/<edition number>/db.json` for published
  edition metadata, with assets under the same edition directory.
- `data/working/prod/project/<project MongoDB ID>/edition/<edition MongoDB ID>/` to recover
  referenced files missing from the published tree, after verifying the exact edition identity.

The BSON dumps under `data/test/db/` and `published/prod/db/` are stale snapshots. Do not treat
their extra tutorials, test records or removed drafts as newly published editions. Do not extract
the entire roughly 37 GB archive unnecessarily; inventory it and read the required entries first.

## Recovery completed on 22 October 2026

Compared the 67 published edition metadata records with production using legacy IDs, parent
relations and publication numbers. Imported only:

- The **Amateur Cinema** collection, legacy publication number **24**, with its 12 editions.
  New PocketBase collection ID: `e6581833c2f4398`.
- **Maastricht 333 CE: (Re)Constructing the Late Roman Castellum**, edition **2** in the existing
  **Maastricht 1748** collection, publication number **3**.
  New PocketBase edition ID: `d0889c111134862`.

Immediately afterwards, production had 36 collections and 131 editions. The existing 35
collections and 118 editions were checked to be unchanged. These counts are historical, not
preconditions for a future import.

Most assets already existed in production storage. Recovered 59 referenced images from the
matching working directories. Conditional no-overwrite uploads, checksums and anonymous public
reads were verified. Nine references were absent from the entire archive: one Brownie article,
four Siemens scene-image JPEGs and four older GLB references. Do not invent replacements or
claim the archive contains those files.

Names, manual attribution and historical publication dates were preserved without manufacturing
ORCIDs, account access or peer-review evidence. Normal API validation created inactive records;
a separately reviewed, exact-record transaction restored their documented historical publication
state. That transaction was a one-off preservation migration, not a reusable publication route.
Future work must obey current validation and obtain fresh review/authorisation for any exception.

## Where the evidence lives

Private, ignored local audit directory: `data/legacy-2026-10-06-audit/`. Start with `CHECKPOINT.md`,
then the source/candidate manifests, `publication-plan.json`, `verification-report.json`,
`production-publication-receipt.json`, asset receipts and `missing-source-assets.json`. Local
scratch scripts and temporary directories are not guaranteed to survive; do not depend on them
as the only recovery evidence or run them blindly.

On the approved production VPS, the historical root-owned recovery directory is:

```text
/var/backups/pure3d-legacy-editions-20261022/
```

It contains `pre-import-verified.zip`, `receipt/publication-receipt.json` and
`completed-audit-receipts.tar`. The verified pre-import ZIP SHA-256 is:

```text
f05b9a42d114e9fbb42b373efd264b6cf430d426af505f8c37fde3ff17c33817
```

The task's private server working directory was
`/opt/pure3d-archive/migration-receipts/legacy-editions-2026-10-06/`. Verify paths, ownership,
checksums and receipt state before use. A receipt marked only `prepared` means the outcome is
unresolved: compare database before/after states rather than retrying.

For future recovery, create a new verified backup and exact append-only manifest. Match legacy
`_id` to `mongoId`, then check collection/edition publication coordinates; investigate conflicts
instead of choosing the first record or matching on title alone. Preserve `pubNum` and relative
file paths. For legacy externally stored scenes, retain the author-tool scene settings and do
not populate `sceneDocument`, `modelFile` or `modelAssets` unless deliberately converting storage.
Verify the actual production asset backend; local `.env` R2 values may point to MinIO.

Never overwrite existing objects, upload private `db.json` files as public assets, or restore the
old whole database over later edits. Rollback requires fresh approval and exact postimage checks
on only the records created by the migration. Preserve unrelated data and later changes.

## Link compatibility and partner communication

See [legacy-redirects.md](legacy-redirects.md) for the live activation receipt from 23 October
2026, nginx map generation, DNS/TLS requirements, the reviewed duplicate Petrol Lamp mapping,
private proxy rollback locations and 648 passing historical redirect checks.

Edition links are the priority: a published legacy edition URL must open that exact edition.
Preserve query parameters and fragments; model, article, image and audio URLs must remain files.
Do not resurrect an unpublished edition solely to make an old URL return content. The agreed
policy for old WordPress posts is to send them to the landing page; configuration of that
fallback was not verified in this recovery conversation, so check it before announcing it.

Fresh acceptance must cover DNS, valid TLS, redirect destinations, public record access, asset
reads and actual viewer/tour behaviour. A fast redirect or a passing heading check does not
prove that a large 3D scene is ready. State which legacy URL families are verified rather than
promising that every URL from the former infrastructure works.
