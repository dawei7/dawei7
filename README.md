# dawei7.com — Server Infrastructure

> All my personal projects, experiments, and apps live at **[dawei7.com](https://dawei7.com)** and its subdomains. This repository contains the complete server infrastructure that powers them.

---

## About Me

I'm **David Schmid**, a Data Engineer at **Axpo Solutions AG**, born on 12 November 1986. I'm married with two children. Outside of work I'm deeply passionate about AI — following the field closely and building things with it whenever I can.

---

## Table of Contents

- [Overview](#overview)
- [Hardware](#hardware)
- [Architecture](#architecture)
- [Services](#services)
  - [socket-proxy](#socket-proxy)
  - [traefik](#traefik)
  - [postgres](#postgres)
  - [redis](#redis)
  - [personal-website](#personal-website)
- [Networking](#networking)
- [TLS / SSL](#tls--ssl)
- [CI/CD](#cicd)
- [Adding a New App](#adding-a-new-app)
- [Local Development](#local-development)
- [Directory Structure](#directory-structure)

---

## Overview

Everything runs on a single VPS behind **Traefik v3** as a reverse proxy. All apps are Dockerized, deployed automatically via **GitHub Actions**, and served over HTTPS with certificates issued by **Let's Encrypt**. The primary language for all services is **Go 1.24**.

```
Internet → Traefik (:443) → personal-website (dawei7.com)
                          → app-x           (app-x.dawei7.com)
                          → traefik UI      (traefik.dawei7.com)
```

---

## Hardware

| Spec    | Value                          |
|---------|-------------------------------|
| Provider | Hostinger KVM 4              |
| CPU     | 4 vCPU                        |
| RAM     | 16 GB                         |
| Disk    | 200 GB NVMe SSD               |
| OS      | Ubuntu 24.04 LTS              |
| Docker  | Engine 29.2.1 (API 1.53)      |
| IP      | `72.62.156.184`               |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        VPS                              │
│                                                         │
│  ┌────────────┐   TCP :2375   ┌──────────────────────┐  │
│  │  Traefik   │ ────────────► │   socket-proxy       │  │
│  │  v3.3      │               │  (docker-api-proxy)  │  │
│  └─────┬──────┘               └──────────┬───────────┘  │
│        │                                 │              │
│        │ HTTP routing                    │ unix socket  │
│        │                          /var/run/docker.sock  │
│  ──────┼──────────────────────────────────────────────  │
│        │  [proxy network]                               │
│        ▼                                                │
│  ┌──────────────────┐                                   │
│  │ personal-website │  dawei7.com                       │
│  │ (Go, ~5MB image) │                                   │
│  └──────────────────┘                                   │
│                                                         │
│  ──────────────── [internal network] ────────────────── │
│                                                         │
│  ┌──────────────┐          ┌──────────────┐             │
│  │  PostgreSQL  │          │    Redis     │             │
│  │  17-alpine   │          │   8-alpine   │             │
│  └──────────────┘          └──────────────┘             │
└─────────────────────────────────────────────────────────┘
```

---

## Services

### socket-proxy

**Image:** built from `./docker-api-proxy` → `ghcr.io/dawei7/docker-api-proxy:latest`

A custom Go reverse proxy that solves a hard incompatibility between Traefik v3 and Docker Engine 29:

- **Problem:** Traefik's Go SDK hardcodes Docker API version `1.24` in all requests. Docker Engine 29 enforces a minimum of `1.44` and rejects older calls with: *"client version 1.24 is too old. Minimum supported API version is 1.44"*.
- **Solution:** This proxy listens on TCP `:2375`, rewrites any versioned path below `1.44` (e.g. `/v1.24/containers/...` → `/v1.44/containers/...`), and strips the `Min-Api-Version` header from `/_ping` responses so Traefik's SDK doesn't self-reject.
- **Traffic impact:** Zero. Traefik only calls the Docker API for container discovery — not on each HTTP request. App traffic flows directly from Traefik to containers.

```
Traefik → tcp://socket-proxy:2375 → (rewrite v1.24→v1.44) → /var/run/docker.sock
```

Key code (`docker-api-proxy/main.go`):
```go
var oldVersionRe = regexp.MustCompile(`^/v1\.(2[0-9]|3[0-9]|4[0-3])\b`)

Director: func(req *http.Request) {
    req.URL.Path = oldVersionRe.ReplaceAllString(req.URL.Path, "/v1.44")
},
ModifyResponse: func(resp *http.Response) error {
    resp.Header.Del("Min-Api-Version")
    return nil
},
```

---

### traefik

**Image:** `traefik:v3.3`

The central reverse proxy and edge router. All incoming traffic on ports `80` and `443` enters here.

**Static config** (`traefik/traefik.yml`):

| Setting | Value |
|---------|-------|
| HTTP entrypoint | `:80` — permanent redirect to HTTPS |
| HTTPS entrypoint | `:443` — TLS termination |
| HTTP/3 (QUIC) | Enabled on port `443` |
| Docker provider | `tcp://socket-proxy:2375` |
| `exposedByDefault` | `false` — containers must opt-in with `traefik.enable=true` |
| Dashboard | `https://traefik.dawei7.com` — basic auth protected |
| Access log | `/var/log/traefik/access.log` — 4xx/5xx only |
| Certificate resolver | `letsencrypt` via TLS-ALPN-01 challenge |

**Why `tlsChallenge` instead of `httpChallenge`:** The global HTTP→HTTPS redirect on entrypoint `web` intercepts Let's Encrypt's HTTP validation requests before Traefik can serve them, causing a `500`. TLS-ALPN-01 runs entirely on port `443` during the TLS handshake and is unaffected by the redirect.

**Container discovery:** Traefik watches Docker for containers with `traefik.enable=true` and automatically creates routers, services, and TLS certs for them. No config file changes needed when adding new apps.

---

### postgres

**Image:** `postgres:17-alpine`

Primary relational database. Tuned for the 16 GB RAM VPS:

| Parameter | Value | Reason |
|-----------|-------|--------|
| `shared_buffers` | `512MB` | ~25% of available DB memory |
| `effective_cache_size` | `4GB` | OS + Postgres cache estimate for query planner |
| `maintenance_work_mem` | `128MB` | Faster `VACUUM`, `CREATE INDEX` |
| `checkpoint_completion_target` | `0.9` | Spread checkpoint I/O over 90% of interval |
| `wal_buffers` | `16MB` | Write-ahead log buffer |
| `max_connections` | `200` | Connection ceiling |

- Data persisted in Docker volume `postgres_data`
- Init scripts in `postgres/init/` run once on first start
- Only reachable on the `internal` Docker network — not exposed to the internet
- Healthcheck: `pg_isready` every 10s

---

### redis

**Image:** `redis:8-alpine`

In-memory store used for sessions, rate limiting, caching, and job queues.

| Parameter | Value |
|-----------|-------|
| `maxmemory` | `512MB` |
| `maxmemory-policy` | `allkeys-lru` — evict least recently used when full |
| `appendonly` | `yes` — AOF persistence so data survives restarts |
| Auth | Password required (`REDIS_PASSWORD` from `.env`) |

- Only reachable on the `internal` Docker network
- Healthcheck: `redis-cli ping` every 10s

---

### personal-website

**Image:** `ghcr.io/dawei7/personal-website:latest`

A minimal Go HTTP server (~5 MB final image, built on `scratch`):

- Serves static files from `./public/`
- Exposes `/health` → `{"status":"ok"}` for health checks
- Listens on port `8080` internally
- Routed by Traefik at `dawei7.com` and `www.dawei7.com`
- `www` permanently redirects to the apex domain

**Dockerfile** is a two-stage build:
1. `golang:1.24-alpine` — compiles the binary with `CGO_ENABLED=0`
2. `scratch` — copies only the binary and `public/` assets (~5 MB total)

---

## Networking

Three isolated Docker networks:

| Network | Type | Members | Purpose |
|---------|------|---------|---------|
| `proxy` | external | traefik, apps | Public-facing HTTP routing |
| `internal` | internal | postgres, redis, apps that need DB | Private — no external access |
| `socket-proxy` | internal | traefik, socket-proxy | Isolated Docker API access |

Apps that need the database get both `proxy` and `internal`. Infrastructure services (postgres, redis) are on `internal` only with no Traefik labels — completely invisible from the internet.

---

## TLS / SSL

- **Provider:** Let's Encrypt (production ACME, `acme-v02.api.letsencrypt.org`)
- **Challenge type:** TLS-ALPN-01 (`tlsChallenge`) — validated over port 443, no HTTP required
- **Storage:** `/opt/server/traefik/acme.json` (chmod 600, not committed to git)
- **Auto-renewal:** Traefik renews certificates automatically before expiry (30 days prior)
- **Scope:** A certificate is issued automatically for every `Host()` rule on every router with `tls.certresolver=letsencrypt`

---

## CI/CD

Two GitHub Actions workflows:

### `deploy.yml` — full stack deploy

Triggered on every push to `main`. SSHes into the VPS and:

1. `git pull origin main` — pulls latest config
2. `docker compose pull --ignore-buildable` — pulls updated images from registries
3. `docker compose build socket-proxy` — rebuilds the local proxy from source
4. `docker compose up -d --remove-orphans` — restarts only changed containers
5. `docker image prune -f` — cleans dangling images

### `deploy-personal-website.yml` — app deploy

Triggered only when `apps/personal-website/**` changes. Runs in parallel:

1. Builds the Docker image on the GitHub Actions runner
2. Pushes to `ghcr.io/dawei7/personal-website:latest` and `:${{ github.sha }}`
3. SSHes into the VPS: `docker compose pull personal-website && docker compose up -d --no-deps personal-website`
4. Uses build cache (`type=gha`) to keep rebuilds fast

**GitHub Secrets required:**

| Secret | Value |
|--------|-------|
| `VPS_HOST` | `srv1442027.hstgr.cloud` |
| `VPS_USER` | `root` |
| `VPS_SSH_KEY` | Ed25519 private key for VPS access |

---

## Adding a New App

1. Create `apps/your-app/` with a `Dockerfile`, `main.go`, and `go.mod`
2. Add a service block to `docker-compose.yml`:

```yaml
your-app:
  image: ghcr.io/dawei7/your-app:latest
  container_name: your-app
  restart: unless-stopped
  networks:
    - proxy      # for Traefik routing
    - internal   # add this if the app needs postgres/redis
  labels:
    - "traefik.enable=true"
    - "traefik.http.routers.your-app.rule=Host(`your-app.dawei7.com`)"
    - "traefik.http.routers.your-app.entrypoints=websecure"
    - "traefik.http.routers.your-app.tls.certresolver=letsencrypt"
```

3. Copy `.github/workflows/deploy-personal-website.yml` → `deploy-your-app.yml`, update the `paths`, `IMAGE`, and `APP_DIR` variables
4. Add a DNS A record `your-app` → `72.62.156.184` in Hostinger hPanel
5. Push to `main` — CI builds, pushes, deploys, and Traefik auto-issues a certificate

---

## Local Development

```bash
# Copy env template
cp .env.example .env
# Edit .env with local values

# Start only infra (postgres + redis) with local ports exposed
docker compose -f docker-compose.dev.yml up -d

# Run your app locally
cd apps/personal-website
go run .
```

The `docker-compose.dev.yml` file is **not** auto-loaded by Docker Compose (it's not named `override.yml`) — it must be passed explicitly with `-f`. This prevents dev settings (exposed DB ports, local builds) from leaking into production on the VPS.

---

## Directory Structure

```
.
├── .github/
│   └── workflows/
│       ├── deploy.yml                     # Full stack CI/CD
│       └── deploy-personal-website.yml    # personal-website CI/CD
├── apps/
│   └── personal-website/
│       ├── Dockerfile                     # Multi-stage Go → scratch
│       ├── go.mod
│       ├── main.go                        # Static file server + /health
│       └── public/
│           └── index.html
├── docker-api-proxy/
│   ├── Dockerfile                         # Multi-stage Go → scratch
│   ├── go.mod
│   └── main.go                            # Docker API v1.24→v1.44 proxy
├── postgres/
│   └── init/
│       └── 01-init.sql                    # Runs once on first DB start
├── scripts/
│   ├── server-init.sh                     # Manual VPS bootstrap reference
│   ├── _bootstrap.py                      # Automated VPS setup (paramiko)
│   └── _start_stack.py                    # Stack startup helper
├── traefik/
│   └── traefik.yml                        # Traefik static config
├── .env.example                           # Environment variable template
├── .gitignore
├── docker-compose.dev.yml                 # Local dev overrides (not auto-loaded)
└── docker-compose.yml                     # Production stack
```
