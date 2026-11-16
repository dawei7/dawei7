package github

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultAPIBaseURL = "https://api.github.com"
	DefaultRawBaseURL = "https://raw.githubusercontent.com"
	DefaultOwner      = "dawei7"
	DefaultRepo       = "professor-euler-library"
)

var nextLinkRe = regexp.MustCompile(`<([^>]+)>;\s*rel="next"`)

// Release represents a GitHub release returned by the REST API.
type Release struct {
	ID          int64     `json:"id"`
	TagName     string    `json:"tag_name"`
	Name        string    `json:"name"`
	Draft       bool      `json:"draft"`
	Prerelease  bool      `json:"prerelease"`
	CreatedAt   time.Time `json:"created_at"`
	PublishedAt time.Time `json:"published_at"`
	AssetsURL   string    `json:"assets_url"`
	Assets      []Asset   `json:"assets"`
}

// Asset represents a GitHub release asset returned by the REST API.
type Asset struct {
	ID                 int64     `json:"id"`
	Name               string    `json:"name"`
	Label              string    `json:"label"`
	ContentType        string    `json:"content_type"`
	State              string    `json:"state"`
	Size               int64     `json:"size"`
	DownloadCount      int64     `json:"download_count"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
	BrowserDownloadURL string    `json:"browser_download_url"`
}

// RateLimit captures GitHub REST API rate-limit headers.
type RateLimit struct {
	Remaining *int
	ResetAt   *time.Time
}

// FetchResult holds all releases, flattened release assets, and latest API rate-limit info.
type FetchResult struct {
	Releases  []Release
	RateLimit RateLimit
}

// Client calls the GitHub REST API and raw content endpoints.
type Client struct {
	HTTPClient *http.Client
	APIBaseURL string
	RawBaseURL string
	Owner      string
	Repo       string
	Token      string
	UserAgent  string
}

// NewClient creates a GitHub client configured for dawei7/professor-euler-library.
func NewClient(token string) *Client {
	return &Client{
		HTTPClient: &http.Client{Timeout: 30 * time.Second},
		APIBaseURL: DefaultAPIBaseURL,
		RawBaseURL: DefaultRawBaseURL,
		Owner:      DefaultOwner,
		Repo:       DefaultRepo,
		Token:      strings.TrimSpace(token),
		UserAgent:  "euler-stats/1.0 (+https://euler-stats.dawei7.com)",
	}
}

// FetchAllReleases fetches every non-draft release and all paginated assets for each release.
func (c *Client) FetchAllReleases(ctx context.Context) (FetchResult, error) {
	var result FetchResult

	releasesURL := fmt.Sprintf("%s/repos/%s/%s/releases?per_page=100",
		strings.TrimRight(c.APIBaseURL, "/"), c.Owner, c.Repo)

	var releases []Release
	nextURL := releasesURL
	for nextURL != "" {
		var page []Release
		next, rl, err := c.getJSON(ctx, nextURL, &page)
		if err != nil {
			return result, fmt.Errorf("fetch releases: %w", err)
		}
		result.RateLimit = rl
		for _, r := range page {
			if r.Draft {
				continue
			}
			releases = append(releases, r)
		}
		nextURL = next
	}

	// Always fetch paginated /releases/{id}/assets so releases with >30 or >100
	// assets are never truncated by the summary payload.
	for i := range releases {
		assetsURL := fmt.Sprintf("%s/repos/%s/%s/releases/%d/assets?per_page=100",
			strings.TrimRight(c.APIBaseURL, "/"), c.Owner, c.Repo, releases[i].ID)

		var allAssets []Asset
		nextAssetURL := assetsURL
		for nextAssetURL != "" {
			var page []Asset
			next, rl, err := c.getJSON(ctx, nextAssetURL, &page)
			if err != nil {
				return result, fmt.Errorf("fetch assets for release %s (%d): %w", releases[i].TagName, releases[i].ID, err)
			}
			result.RateLimit = rl
			allAssets = append(allAssets, page...)
			nextAssetURL = next
		}
		releases[i].Assets = allAssets
	}

	result.Releases = releases
	return result, nil
}

func (c *Client) getJSON(ctx context.Context, url string, dst any) (string, RateLimit, error) {
	var rl RateLimit
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", rl, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", c.UserAgent)
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return "", rl, err
	}
	defer resp.Body.Close()

	rl = parseRateLimit(resp.Header)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", rl, fmt.Errorf("github HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	if err := json.NewDecoder(resp.Body).Decode(dst); err != nil {
		return "", rl, fmt.Errorf("decode JSON: %w", err)
	}

	return parseNextLink(resp.Header.Get("Link")), rl, nil
}

func parseRateLimit(h http.Header) RateLimit {
	var rl RateLimit
	if v := h.Get("X-RateLimit-Remaining"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			rl.Remaining = &n
		}
	}
	if v := h.Get("X-RateLimit-Reset"); v != "" {
		if sec, err := strconv.ParseInt(v, 10, 64); err == nil && sec > 0 {
			t := time.Unix(sec, 0).UTC()
			rl.ResetAt = &t
		}
	}
	return rl
}

func parseNextLink(linkHeader string) string {
	if linkHeader == "" {
		return ""
	}
	for _, part := range strings.Split(linkHeader, ",") {
		if m := nextLinkRe.FindStringSubmatch(strings.TrimSpace(part)); len(m) == 2 {
			return m[1]
		}
	}
	return ""
}
