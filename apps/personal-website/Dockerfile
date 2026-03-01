# ─── Build Stage ──────────────────────────────────────────────────────────────
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Install templ CLI (needed to generate *_templ.go from *.templ files)
RUN go install github.com/a-h/templ/cmd/templ@latest

COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Generate Go code from .templ files
RUN templ generate

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server .

# ─── Final Stage ──────────────────────────────────────────────────────────────
# Uses scratch (zero OS) — all templates are compiled into the binary
FROM scratch

WORKDIR /app
COPY --from=builder /app/server .

EXPOSE 8080
ENTRYPOINT ["/app/server"]
