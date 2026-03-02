# ─── Build Stage ──────────────────────────────────────────────────────────────
FROM golang:1.24 AS builder

WORKDIR /app

# Install templ CLI
RUN go install github.com/a-h/templ/cmd/templ@latest

# Install Tailwind CSS standalone CLI
# Resolve the actual latest version tag via API (avoids broken /latest/download/ redirect)
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && TWCSS_VER=$(curl -fsSL "https://api.github.com/repos/tailwindlabs/tailwindcss/releases/latest" \
    | grep '"tag_name"' | head -1 | cut -d'"' -f4) \
    && echo "Downloading tailwindcss ${TWCSS_VER}" \
    && curl -fSL "https://github.com/tailwindlabs/tailwindcss/releases/download/${TWCSS_VER}/tailwindcss-linux-x64" \
    -o /usr/local/bin/tailwindcss \
    && chmod +x /usr/local/bin/tailwindcss \
    && tailwindcss --version

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
