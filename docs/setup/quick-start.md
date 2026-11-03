# Quick Start

Copy `.env.example` to private `.env` and set unique `POCKETBASE_ADMIN_PASSWORD` and
`MINIO_ROOT_PASSWORD` values before starting local services:

```bash
make install
make dev
```

## What happens automatically

On a new machine, the local Make targets will:

1. Start PocketBase
2. Create or upgrade the PocketBase schema
3. Import the bundled seed data from `data/json-output/` if those files exist
4. Seed local Admin and User demo login accounts
5. Download Voyager `0.59.0` into `static/voyager/0.59.0/` if it is missing
6. Start the frontend

## Default URLs

- Frontend: `http://localhost:60020`
- PocketBase admin UI: `http://localhost:60021/_/`

## Demo accounts

These are created automatically for local development:

- `admin@pure3d.eu` / `1234567890`
- `user@pure3d.eu` / `1234567890`

If no content data is available yet, the application still starts correctly. You will get an empty database plus working login, demo users, and role-based access.

## Private local `.env`

Local service passwords must be supplied explicitly; there are no Compose password fallbacks.
Never reuse production credentials. All published service ports bind only to localhost.
To create your private configuration:

```bash
cp .env.example .env
```

Then edit:

- `POCKETBASE_PORT`
- `FRONTEND_PORT`
- `POCKETBASE_ADMIN_EMAIL`
- `POCKETBASE_ADMIN_PASSWORD`
- `MINIO_ROOT_PASSWORD`
- `PUBLIC_ASSET_BASE_URL`

## Data locations

### Database seed data

The setup container imports from:

- `data/json-output/`

You do not need to manually populate this folder after cloning if the repository already includes the JSON export.
If the folder or files are missing, setup still succeeds and the app starts with no imported collections or editions.

If you want to regenerate it from BSON, place the BSON files in:

- `data/db/`

Then run:

```bash
bun scripts/read-bson.ts
```

### 3D static assets

The frontend reads local scene and viewer assets from:

- `static/project/{collectionPubNum}/`
- `static/project/{collectionPubNum}/edition/{editionPubNum}/`
- `static/voyager/{version}/`

If those files are missing, the app can still start, but editions that rely on local assets will not render correctly.

Voyager runtime is now downloaded automatically by Docker Compose and should not be committed to Git.

## Verification

After startup, check:

```bash
docker compose ps
```

You should see:

- `pocketbase` running
- `frontend` running
- `pocketbase-setup` exited successfully

Then open:

- `http://localhost:60020`
- `http://localhost:60021/_/`

## Start from scratch again

```bash
docker compose down
rm -rf pocketbase/pb_data
docker compose up -d
```
