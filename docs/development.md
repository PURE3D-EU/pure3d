# Development

## Recommended Local Workflow

Use `make dev` for a Docker frontend, PocketBase, and MinIO. Use `make dev-web`
for the same local services with a native Bun frontend. Neither command needs a
production `.env` to be replaced or edited.

| Command                         | Behavior                                                |
| ------------------------------- | ------------------------------------------------------- |
| `make dev`                      | Full local Docker development stack                     |
| `make dev-cert`                 | Trust mkcert CA and generate missing HTTPS certificate  |
| `make dev-web` / `make bun-dev` | Local Docker services, native Bun frontend              |
| `make install`                  | Provision local services, Voyager, and available assets |
| `make db`                       | Start local PocketBase and MinIO                        |
| `make seed-assets`              | Mirror `static/project/` into the local MinIO bucket    |
| `make stack`                    | Start all local Compose services                        |
| `make db-logs` / `make db-stop` | Follow logs / stop local backend services               |
| `make stack-stop`               | Stop the local Compose stack                            |
| `make dev-prod`                 | Native Bun frontend connected to live OVH, no Docker    |

Obtain private seed data from a maintainer for `data/json-output/` and assets for
`static/project/`. Run `make seed-assets` after adding assets. Legacy
`project/<collection>/<edition>/...` storage paths are preserved. Seed data and
assets are not downloaded from production by these commands.

## Configuration Contract

Local commands select `docker-compose.yml` plus `docker-compose.local.yml`:

- Browser frontend/PocketBase base URL: `https://127.0.0.1:${FRONTEND_PORT:-60020}`.
- Browser assets: `https://127.0.0.1:${FRONTEND_PORT:-60020}/assets`.
- Native Vite HTTPS proxies `/api` to PocketBase and `/assets` to MinIO with the
  prefix rewritten to `/${R2_BUCKET:-pure3d-assets}/...`; legacy asset paths remain unchanged.
- Private `DEV_HTTPS=1`, `DEV_POCKETBASE_TARGET`, `DEV_ASSET_TARGET`, and `DEV_ASSET_BUCKET`
  configure this routing. Docker targets are `http://pocketbase:8090` and `http://minio:9000`;
  native targets are `http://127.0.0.1:${POCKETBASE_PORT:-60021}` and
  `http://127.0.0.1:${MINIO_API_PORT:-60023}`. Never use `PUBLIC_` or `VITE_` for these internals.
- Operator PocketBase UI remains `http://localhost:${POCKETBASE_PORT:-60021}/_/`.
- Setup PocketBase: `http://pocketbase:8090`.
- Setup storage endpoint: `http://minio:9000`, using `MINIO_ROOT_USER` and
  `MINIO_ROOT_PASSWORD`, not production `R2_ACCESS_KEY_ID` or `R2_SECRET_ACCESS_KEY`.
- PocketBase ORCID issuer: `https://orcid.org` (real ORCID, not sandbox).
- Local Bun containers receive empty `ORCID_CLIENT_ID` and `ORCID_CLIENT_SECRET`
  so mounted `.env` files cannot automatically supply production credentials.
- Native Bun exports explicit local public URLs and empty ORCID credentials
  **after** sourcing `.env`.

Existing `FRONTEND_PORT` (60020), `POCKETBASE_PORT` (60021), `MINIO_API_PORT`
(60023), and `MINIO_CONSOLE_PORT` (60024) remain configurable. Container ports
remain 14273, 8090, 9000, and 9001. Host service ports bind only to `127.0.0.1`.
Set unique local `POCKETBASE_ADMIN_PASSWORD` and `MINIO_ROOT_PASSWORD` values in private `.env`;
Compose refuses missing or empty passwords. Do not reuse production credentials. The backend and
MinIO server images are pinned; applying an image update requires a deliberate local restart.

Use the Make targets, not bare `docker compose up` or `bun run dev`, for this
isolation contract. The base Compose file alone still accepts environment settings.

## Local Certificate Trust

Install mkcert first (`brew install mkcert` on macOS). `make dev`, `make dev-web`, and
`make stack` depend on `make dev-cert`. If either certificate file is missing, the target
runs `mkcert -install` to trust its development CA and generates `.certs/localhost.pem`
and `.certs/localhost-key.pem` with SANs `localhost`, `127.0.0.1`, and `::1`.
The key is restricted to mode 600 and `.certs/` is ignored by Git.

CA installation can ask for administrator approval. Trust is local to your machine/browser;
restart the browser after installation, and follow mkcert's browser-specific trust instructions
if necessary. Never commit or share certificate keys or the CA private key in `mkcert -CAROOT`.
If macOS cannot show its approval prompt from an automation session, run `mkcert -install`
directly in your Terminal, approve it there, and rerun `make dev-cert`.
Use `https://127.0.0.1:60020`, not literal `localhost`: ORCID's web validator rejects a hostname
without a dot, while an HTTPS IP callback is accepted. No new service or host port is used.
Vite reads certificates only for its development server with `DEV_HTTPS=1`, never during
build or preview. The HTTPS server fails rather than silently selecting a different port.

## Live OVH Opt-In

```sh
make dev-prod
```

**Connected to production: changes affect live data.**

This installs dependencies and runs Vite directly with Bun, without Docker.
It forces PocketBase to `https://api.pure3d.eu` and assets to
`https://api.pure3d.eu/assets`, regardless of `.env` public settings.
It does not start backend/setup dependencies, stop existing local services, or
manage any production services. No UI mode flag is required; the actual
PocketBase URL identifies the connection.

The frontend is plain HTTP at `http://localhost:${FRONTEND_PORT:-60020}` in this mode.
`DEV_HTTPS=0` is forced to prevent shared `.env` settings from enabling local proxies or
certificate loading. `make dev-prod` has no certificate prerequisite.

The development header shows an amber **production db** label underneath the logo when its
actual PocketBase URL points to OVH, and a blue **dev** label in local mode. Neither label
appears in production builds. Login sessions and catalogue caches are separated by backend
URL. Local mode also offers one-click Admin and User demo logins; they are never shown by
`make dev-prod` or a production build.
URL during development, so switching modes does not inherit the other mode's
session or cached data. Existing production-build session storage is unchanged.

The Bun scripts explicitly set `NODE_ENV=development` for the dev server and
`NODE_ENV=production` for builds. A value inherited from `.env` cannot make a
production build display development-only UI.

## Local Real ORCID

Normal `make dev` does not run `configure-orcid.ts --apply` or an automatic OAuth
cutover. Reuse the existing **real ORCID OAuth application** and your real ORCID account.
Sharing an identity provider does not share an application database: users, permissions,
editions, and sessions still belong to the separate local PocketBase, not OVH.
No sandbox application or account is needed.

In the existing ORCID application's registration, **add** this exact redirect URI:

```text
https://127.0.0.1:60020/api/oauth2-redirect
```

Keep the production callback `https://api.pure3d.eu/api/oauth2-redirect` and leave the real
application URL pointing at `https://pure3d.eu`. Do not replace the production callback. A custom
`FRONTEND_PORT` requires an additional exact
allowlist entry with that port; changing only the Make port does not update ORCID.

Keep the existing real client ID and secret in private `.env`. Local frontend/setup
containers deliberately receive blank credentials, so merely starting the stack cannot
configure OAuth. Run the existing tool explicitly on the host. Inspect its offline instructions:

Rotating the shared ORCID client secret requires updating both PocketBase configurations;
it does not synchronize accounts, roles, or data between those databases.

```sh
bun --no-env-file scripts/configure-orcid.ts
```

For preparation, override the database destination explicitly. These commands assume default
ports and local superuser credentials in `.env`; supply your local superuser values privately
if that file instead contains OVH admin credentials. Never print or paste secrets into logs:

```sh
POCKETBASE_URL=http://localhost:60021 \
PUBLIC_POCKETBASE_URL=https://127.0.0.1:60020 \
ORCID_ISSUER=https://orcid.org ORCID_ENVIRONMENT=production \
bun --env-file=.env scripts/configure-orcid.ts --prepare
```

Follow the tool's backup and privileged-account mapping requirements before
explicitly enabling real ORCID on the local database:

```sh
POCKETBASE_URL=http://localhost:60021 \
PUBLIC_POCKETBASE_URL=https://127.0.0.1:60020 \
ORCID_ISSUER=https://orcid.org ORCID_ENVIRONMENT=production \
bun --env-file=.env scripts/configure-orcid.ts --apply
```

`ORCID_ENVIRONMENT=production` selects the real identity provider, not the application
database. Apply changes authentication and invalidates existing user sessions; keep it on
the explicit local database and satisfy all backup and mapping gates in [ORCID operations](orcid.md).
Empty credentials do not enable sign-in, and imported records are not proof of verified ownership.

Until a provider is configured, the login screen displays an explicit
configuration message and disables sign-in instead of opening a popup that
immediately closes. Reload the page after completing provider configuration.

## Testing

```sh
bun --no-env-file test src scripts pocketbase
```

The maintained suite exercises feature entry points and observable outcomes, not source text,
configuration snapshots, or isolated helpers. See [Testing](testing.md) for scope and the
disposable native PocketBase integration command. Backend HTTP journeys are skipped unless
`PB_TEST_BINARY` is supplied; a passing default run does not verify those journeys.
