# ─── React frontend build ─────────────────────────────────────────────────────
FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN node node_modules/typescript/bin/tsc -b && node node_modules/vite/bin/vite.js build

# ─── Go backend build ─────────────────────────────────────────────────────────
FROM golang:1.24 AS backend-builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
# Overwrite the placeholder dist with the real React build
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server .

# ─── Final Stage ──────────────────────────────────────────────────────────────
FROM scratch

WORKDIR /app
COPY --from=backend-builder /app/server .

EXPOSE 8080
ENTRYPOINT ["/app/server"]
