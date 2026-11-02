FROM golang:1.27.3-alpine AS build
WORKDIR /src
COPY services/stream-go/go.mod services/stream-go/go.sum ./
RUN go mod download
COPY services/stream-go/ ./
RUN CGO_ENABLED=0 go build -trimpath -o /stream-service ./cmd/stream-service && CGO_ENABLED=0 go build -trimpath -o /stream-discover ./cmd/stream-discover
FROM alpine:3.23
RUN apk add --no-cache ca-certificates && addgroup -g 10001 app && adduser -D -u 10001 -G app app && mkdir /state /sessions && chown app:app /state /sessions
COPY --from=build /stream-service /stream-discover /usr/local/bin/
USER app
WORKDIR /app
ENTRYPOINT ["/usr/local/bin/stream-service"]
