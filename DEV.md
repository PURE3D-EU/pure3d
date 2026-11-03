## Component ID Convention

Every Svelte component **must** have an `id` attribute on its root HTML element, using kebab-case derived from the component filename. This makes components identifiable in the DOM for debugging, testing, and programmatic access.

- `ProfileCard.svelte` → `<div id="profile-card">`
- `HearingTest.svelte` → `<div id="hearing-test">`
- `CreateProfileModal.svelte` → `<div id="create-profile-modal">`

If a component has multiple root elements (fragment), wrap them in a `<div id="component-name">...</div>`.

## Local PocketBase + S3 Assets

Development runs fully locally through Docker/OrbStack:

- PocketBase: `http://localhost:60021`
- MinIO S3 API: `http://localhost:60023`
- MinIO console: `http://localhost:60024`
- MinIO user: `pure3d`; set a unique `MINIO_ROOT_PASSWORD` in private `.env`
- Default bucket: `pure3d-assets`

PocketBase is configured to use MinIO through its S3-compatible storage settings. The setup service applies these settings on `docker compose up`:

```env
R2_ENDPOINT=http://minio:9000
R2_BUCKET=pure3d-assets
R2_ACCESS_KEY_ID=pure3d
# Local Make commands supply MINIO_ROOT_PASSWORD, never production R2 credentials.
PUBLIC_ASSET_BASE_URL=http://localhost:60023/pure3d-assets
```

Use `http://minio:9000` for PocketBase because it runs inside the Docker network. Use `http://localhost:60023/pure3d-assets` for the browser-facing asset URL.

### Install Local Development Services

Run this after cloning, after dependency changes, or after changing local service/storage configuration:

First copy `.env.example` to `.env` and set unique local `POCKETBASE_ADMIN_PASSWORD` and
`MINIO_ROOT_PASSWORD` values. Compose refuses empty passwords. Never reuse production secrets.
Services publish only on loopback; do not expose this development stack to a shared network.

```sh
make install
```

This starts MinIO, initializes the asset bucket, starts PocketBase, applies schema/data setup, installs Voyager runtime files, and mirrors `static/project` into MinIO when that directory exists. Dependencies are installed inside the Docker/OrbStack containers; a local Bun install is not required for normal development.

### Start Local Development

After `make install`, use `make dev` for day-to-day development:

```sh
make dev
```

This runs the frontend container with Docker Compose. Compose starts MinIO, PocketBase, setup services, and Voyager setup if needed. It intentionally avoids requiring a local Bun install.

The important URLs are:

```txt
Frontend:         http://localhost:60020
PocketBase admin: http://localhost:60021/_/
MinIO console:    http://localhost:60024
Asset bucket:     http://localhost:60023/pure3d-assets
```

### Start Or Restart Services Only

```sh
make db
```

If you changed storage env vars, force the setup service to run again:

```sh
make install
```

### Verify Local Services

```sh
curl http://localhost:60021/api/health
curl -I http://localhost:60023/pure3d-assets/
```

Open the MinIO console at `http://localhost:60024` and confirm the `pure3d-assets` bucket exists.

### Seed Historical Project Assets

Imported legacy editions use publication-number paths, not PocketBase file fields:

```txt
project/<collectionPubNum>/icon.png
project/<collectionPubNum>/edition/<editionPubNum>/scene.svx.json
project/<collectionPubNum>/edition/<editionPubNum>/<models/textures/etc>
```

The frontend builds those URLs from `PUBLIC_ASSET_BASE_URL`. For example, collection 13 edition 20 resolves locally to:

```txt
http://localhost:60023/pure3d-assets/project/13/edition/20/scene.svx.json
```

If you have the legacy asset tree locally under `static/project`, `make install` mirrors it into MinIO automatically. To rerun only the asset mirror step:

```sh
make seed-assets
```

Then verify a known scene file:

```sh
curl -I http://localhost:60023/pure3d-assets/project/13/edition/20/scene.svx.json
```

If that returns `404`, the metadata exists in PocketBase but the asset files have not been seeded into MinIO.

### Uploaded Files Vs Historical Assets

New uploads through PocketBase file fields are stored by PocketBase in MinIO using PocketBase's internal storage keys and are served via PocketBase file URLs.

Historical imported editions are different: they use the legacy `project/...` folder layout above. Those folders must be mirrored into the `pure3d-assets` bucket for local browsing.

## R2 Storage (Production)

Production uses Cloudflare R2 as the S3-compatible backend.

### One-Time R2 Bucket Setup

1. Create an R2 bucket, for example `pure3d-assets`, in the Cloudflare dashboard.
2. Create an R2 API token with Object Read + Write on that bucket. Note the Access Key ID, Secret Access Key, and endpoint (`https://<account>.r2.cloudflarestorage.com`).
3. Apply a CORS policy on the bucket permitting `GET` and `PUT` from the production frontend origin:

```json
[
	{
		"AllowedOrigins": ["https://<your-frontend-domain>"],
		"AllowedMethods": ["GET", "PUT"],
		"AllowedHeaders": ["*"],
		"ExposeHeaders": ["ETag"],
		"MaxAgeSeconds": 3600
	}
]
```

### Production Environment Variables

In the production `.env` or deployment environment:

```
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
R2_BUCKET=pure3d-assets
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
PUBLIC_ASSET_BASE_URL=https://<public-assets-domain>
```

The `pocketbase-setup` container applies these to PocketBase's storage settings on every `docker compose up`.
