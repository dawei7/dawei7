# ─── Build Stage ──────────────────────────────────────────────────────────────
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Install templ CLI
RUN go install github.com/a-h/templ/cmd/templ@latest

# Install Tailwind CSS standalone CLI (curl follows HTTPS redirects; wget/busybox does not)
RUN apk add --no-cache curl \
    && curl -fsSLo /usr/local/bin/tailwindcss \
       https://github.com/tailwindlabs/tailwindcss/releases/latest/download/tailwindcss-linux-x64 \
    && chmod +x /usr/local/bin/tailwindcss

COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Generate Go code from .templ files
RUN templ generate

# Generate Tailwind CSS
RUN mkdir -p public && tailwindcss -i input.css -o public/style.css --minify

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server .

# ─── Final Stage ──────────────────────────────────────────────────────────────
# Uses scratch (zero OS) — all templates are compiled into the binary
FROM scratch

WORKDIR /app
COPY --from=builder /app/server .

EXPOSE 8080
ENTRYPOINT ["/app/server"]
