# ─── Build Stage ──────────────────────────────────────────────────────────────
FROM golang:1.24-alpine AS builder

WORKDIR /app
COPY go.mod ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server .

# ─── Final Stage ──────────────────────────────────────────────────────────────
# Uses scratch (zero OS) → image is ~5MB
FROM scratch

WORKDIR /app
COPY --from=builder /app/server .
COPY --from=builder /app/public ./public

EXPOSE 8080
ENTRYPOINT ["/app/server"]
