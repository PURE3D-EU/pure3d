![Netherlands eScience Center](https://raw.githubusercontent.com/NLeSC/.github/24b2ff028f19395c636c2aea9fb9570f6fa35e59/profile/escience.png)

# Pure3D

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Research Software Directory](https://img.shields.io/badge/rsd-Pure_3D_Platform-00a3e3.svg)](https://research-software-directory.org/projects/pure3d-20)

A web platform for exploring 3D digital collections and editions in cultural heritage,
with interactive viewing powered by [Smithsonian Voyager](https://smithsonian.github.io/dpo-voyager/).

[Visit Pure3D](https://pure3d.eu) · [Documentation](docs/README.md)

Built with SvelteKit 2, Svelte 5, Tailwind CSS 4, DaisyUI, PocketBase and Bun.

## Local development

Install [Bun](https://bun.sh/), Docker with Docker Compose, and
[mkcert](https://github.com/FiloSottile/mkcert), then run:

```sh
git clone https://github.com/PURE3D-EU/pure3d.git
cd pure3d
cp .env.example .env
# Set unique local POCKETBASE_ADMIN_PASSWORD and MINIO_ROOT_PASSWORD values in .env.
make dev
```

Open **https://127.0.0.1:60020**. This provisions the local PocketBase and MinIO services,
installs Voyager, and starts the Docker frontend. Certificate setup may require administrator
approval. Local commands use local services even if an existing `.env` points to production.

Private seed data and 3D assets are not included; obtain them from a project maintainer.
For setup details, asset provisioning, local ORCID sign-in and alternative workflows
(including a native Bun frontend), see [Development](docs/development.md).

**Production access is explicit:** `make dev-prod` connects a local frontend to live services;
changes affect production data. See [Live OVH opt-in](docs/development.md#live-ovh-opt-in).

## Security policies

- Keep credentials, database backups, private assets and service data out of Git. Use private
  `.env` files and never reuse production credentials for development.
- Bind local services to loopback and require explicit service passwords. Production access,
  hook deployment and schema migrations require separate authorisation; frontend releases do
  not deploy backend protections.
- Enforce permissions and private-record/file access in PocketBase, not just the UI. Reviewer
  verdicts follow the review workflow; unsafe raw storage deletion is disabled.
- Clear private browser state on account changes. Gemini API keys stay in memory and are sent
  in request headers, not URLs; unowned legacy gallery images are quarantined rather than deleted.
- Run real-backend security journeys in CI with a checksum-pinned PocketBase binary. Review
  dependency advisories and verify affected feature workflows; passing checks is not a complete
  security assessment.

Removing a backup from the current tree does not erase old commits. Historical credential
exposure needs a reuse assessment, rotation where necessary and separately approved history cleanup.
See [Security hardening](docs/security-hardening.md) for applied controls, verification evidence,
remaining advisories and deployment limitations.

## Documentation

- [Development](docs/development.md) — setup, commands, configuration, certificates and assets
- [Testing](docs/testing.md) — feature tests and backend verification
- [Roles and permissions](docs/ROLES.md) — access control
- [ORCID](docs/orcid.md) — authentication configuration and operations
- [Open calls](docs/open-calls.md) — CMS administration and migration
- [Releases](docs/releases.md) — automatic releases from `main` and GitHub Pages deployment
- [Documentation index](docs/README.md) — architecture, PocketBase and Voyager guides

## Licence

[Apache 2.0](LICENSE).
