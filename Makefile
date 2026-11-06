.PHONY: release release-dry-run help install db db-logs db-stop dev-cert dev dev-prod dev-web bun-dev seed-assets stack stack-stop

LOCAL_COMPOSE = docker compose -f docker-compose.yml -f docker-compose.local.yml

help:
	@echo "Pure3D commands"
	@echo "  make release     Optional manual fallback: build, commit/tag, push and publish"
	@echo "  make release-dry-run  Read-only offline release preview"
	@echo "  Main pushes release automatically; add RELEASE_ARGS=--patch for manual maintenance releases"
	@echo "  make install     Install deps and provision local MinIO/PocketBase/Voyager"
	@echo "  make db          Start local MinIO + PocketBase and print URLs"
	@echo "  make db-logs     Follow PocketBase logs"
	@echo "  make db-stop     Stop local database/storage services"
	@echo "  make dev         Run full local dev app in Docker/OrbStack"
	@echo "  make dev-cert    Trust mkcert CA and create missing local HTTPS certificate"
	@echo "  make dev-prod    Run native Bun frontend against production (no Docker)"
	@echo "  make dev-web     Run DB/MinIO in Docker, then native Bun frontend"
	@echo "  make bun-dev     Alias for dev-web"
	@echo "  make seed-assets Mirror static/project into local MinIO bucket"
	@echo "  make stack       Start full Docker stack"
	@echo "  make stack-stop  Stop full Docker stack"

install:
	@$(LOCAL_COMPOSE) up -d minio minio-setup pocketbase pocketbase-setup voyager-setup
	@$(MAKE) seed-assets
	@echo ""
	@echo "Local services are installed and provisioned."
	@echo "Run 'make dev' to start the frontend container."

db:
	@$(LOCAL_COMPOSE) up -d minio pocketbase
	@echo ""
	@set -a; [ ! -f .env ] || . ./.env; set +a; \
		echo "PocketBase admin: http://localhost:$${POCKETBASE_PORT:-60021}/_/"; \
		echo "PocketBase health: http://localhost:$${POCKETBASE_PORT:-60021}/api/health"; \
		echo "MinIO console:    http://localhost:$${MINIO_CONSOLE_PORT:-60024}"; \
		echo "Asset bucket:     http://localhost:$${MINIO_API_PORT:-60023}/$${R2_BUCKET:-pure3d-assets}"

db-logs:
	$(LOCAL_COMPOSE) logs -f minio minio-setup pocketbase pocketbase-setup

db-stop:
	$(LOCAL_COMPOSE) stop minio minio-setup pocketbase pocketbase-setup

dev-cert:
	@command -v mkcert >/dev/null || { echo "Install mkcert first (macOS: brew install mkcert)."; exit 1; }
	@if [ ! -f .certs/localhost.pem ] || [ ! -f .certs/localhost-key.pem ]; then \
		mkdir -p .certs && mkcert -install && \
		mkcert -cert-file .certs/localhost.pem -key-file .certs/localhost-key.pem localhost 127.0.0.1 ::1; \
	fi
	@chmod 600 .certs/localhost-key.pem

dev: dev-cert
	$(LOCAL_COMPOSE) up frontend

dev-prod:
	@echo "Connected to production: changes affect live data."
	@set -a; [ ! -f .env ] || . ./.env; set +a; \
		export DEV_HTTPS=0; unset DEV_PUBLIC_URL; \
		export PUBLIC_DEMO_LOGIN=0; \
		export PUBLIC_POCKETBASE_URL="https://api.pure3d.eu"; \
		export PUBLIC_ASSET_BASE_URL="https://api.pure3d.eu/assets"; \
		bun install && bun run dev --host 127.0.0.1 --port "$${FRONTEND_PORT:-60020}" --strictPort

dev-web: dev-cert
	@$(LOCAL_COMPOSE) up -d minio minio-setup pocketbase pocketbase-setup voyager-setup
	@set -a; [ ! -f .env ] || . ./.env; set +a; \
		export PUBLIC_POCKETBASE_URL="https://127.0.0.1:$${FRONTEND_PORT:-60020}"; \
		export PUBLIC_ASSET_BASE_URL="$$PUBLIC_POCKETBASE_URL/assets"; \
		export DEV_HTTPS=1 DEV_POCKETBASE_TARGET="http://127.0.0.1:$${POCKETBASE_PORT:-60021}"; \
		export DEV_ASSET_TARGET="http://127.0.0.1:$${MINIO_API_PORT:-60023}" DEV_ASSET_BUCKET="$${R2_BUCKET:-pure3d-assets}"; \
		export PUBLIC_DEMO_LOGIN=1; \
		export ORCID_CLIENT_ID= ORCID_CLIENT_SECRET=; \
		bun install && bun run dev --host 127.0.0.1 --port "$${FRONTEND_PORT:-60020}"

bun-dev: dev-web

seed-assets:
	@$(LOCAL_COMPOSE) up -d minio minio-setup
	@if [ ! -d static/project ]; then \
		echo "No static/project directory found; nothing to seed."; \
		exit 0; \
	fi
	$(LOCAL_COMPOSE) run --rm --entrypoint /bin/sh minio-setup -lc 'mc alias set local http://minio:9000 "$$MINIO_ROOT_USER" "$$MINIO_ROOT_PASSWORD" && mc mirror --overwrite /app/static/project local/$$R2_BUCKET/project'

stack: dev-cert
	$(LOCAL_COMPOSE) up

stack-stop:
	$(LOCAL_COMPOSE) down

release:
	bun --no-env-file scripts/release.ts $(RELEASE_ARGS)

release-dry-run:
	bun --no-env-file scripts/release.ts --dry-run $(RELEASE_ARGS)
