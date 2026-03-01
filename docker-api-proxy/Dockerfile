FROM golang:1.24-alpine AS builder
WORKDIR /app
COPY go.mod .
COPY main.go .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o proxy .

FROM scratch
COPY --from=builder /app/proxy /proxy
EXPOSE 2375
ENTRYPOINT ["/proxy"]
