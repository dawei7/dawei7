// docker-api-proxy: translates Docker API v1.24 calls → v1.44+
// Needed because Traefik v3.x hardcodes API 1.24, but Docker Engine 29+
// requires minimum 1.44. This proxy upgrades the version in the URL path
// and strips Min-Api-Version from /_ping responses.
package main

import (
	"context"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"regexp"
)

// Match versioned paths < 1.44: /v1.24/, /v1.38/, /v1.43/ etc.
var oldVersionRe = regexp.MustCompile(`^/v1\.(2[0-9]|3[0-9]|4[0-3])\b`)

func main() {
	sockPath := "/var/run/docker.sock"

	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return net.Dial("unix", sockPath)
		},
	}

	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = "http"
			req.URL.Host = "docker"
			// Upgrade any API version < 1.44 to 1.44
			req.URL.Path = oldVersionRe.ReplaceAllString(req.URL.Path, "/v1.44")
			req.URL.RawQuery = req.URL.RawQuery
		},
		Transport: transport,
		ModifyResponse: func(resp *http.Response) error {
			// Strip the min-api-version header so the Go SDK won't reject us
			resp.Header.Del("Min-Api-Version")
			return nil
		},
	}

	addr := ":2375"
	log.Printf("docker-api-proxy listening on %s → unix:%s", addr, sockPath)
	if err := http.ListenAndServe(addr, proxy); err != nil {
		log.Fatal(err)
	}
}
