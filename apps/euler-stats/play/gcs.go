package play

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/dawei7/dawei7/apps/euler-stats/db"
	"golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

const DefaultGCSBaseURL = "https://storage.googleapis.com"

// GCSObject captures metadata for one object in the Play export bucket.
type GCSObject struct {
	Name       string    `json:"name"`
	ETag       string    `json:"etag"`
	MD5Hash    string    `json:"md5Hash"`
	Generation string    `json:"generation"`
	Size       string    `json:"size"`
	Updated    time.Time `json:"updated"`
}

func (o GCSObject) GenerationInt() int64 {
	n, _ := strconv.ParseInt(o.Generation, 10, 64)
	return n
}

func (o GCSObject) SizeInt() int64 {
	n, _ := strconv.ParseInt(o.Size, 10, 64)
	return n
}

// ParsedReport holds typed rows decoded from one Play Console CSV object.
type ParsedReport struct {
	Installs         []db.PlayInstallRow
	StorePerformance []db.PlayStorePerfRow
	Ratings          []db.PlayRatingRow
	Crashes          []db.PlayCrashRow
	Reviews          []db.PlayReviewRow
}

func (p ParsedReport) TotalRows() int {
	return len(p.Installs) + len(p.StorePerformance) + len(p.Ratings) + len(p.Crashes) + len(p.Reviews)
}

// Client interacts with GCS bulk Play reports, Play Developer Reporting API, and Android Publisher API.
type Client struct {
	HTTPClient       *http.Client
	TokenSource      *TokenSource
	GCSBaseURL       string
	ReportingBaseURL string
	PublisherBaseURL string
	Bucket           string
	PackageName      string
}

// NewClient creates a Play Store API client.
func NewClient(ts *TokenSource, bucket, packageName string) *Client {
	return &Client{
		HTTPClient:       &http.Client{Timeout: 45 * time.Second},
		TokenSource:      ts,
		GCSBaseURL:       DefaultGCSBaseURL,
		ReportingBaseURL: DefaultReportingBaseURL,
		PublisherBaseURL: DefaultPublisherBaseURL,
		Bucket:           bucket,
		PackageName:      packageName,
	}
}

func (c *Client) doAuthed(ctx context.Context, method, rawURL string, body io.Reader, contentType string) ([]byte, int, error) {
	req, err := http.NewRequestWithContext(ctx, method, rawURL, body)
	if err != nil {
		return nil, 0, err
	}
	if c.TokenSource != nil {
		tok, err := c.TokenSource.Token(ctx)
		if err != nil {
			return nil, 0, err
		}
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return data, resp.StatusCode, nil
}

// ListBucketObjects lists all objects in the Play Console export GCS bucket.
func (c *Client) ListBucketObjects(ctx context.Context) ([]GCSObject, error) {
	var all []GCSObject
	pageToken := ""
	base := strings.TrimRight(c.GCSBaseURL, "/")

	for {
		u := fmt.Sprintf("%s/storage/v1/b/%s/o?maxResults=1000", base, url.PathEscape(c.Bucket))
		if pageToken != "" {
			u += "&pageToken=" + url.QueryEscape(pageToken)
		}
		data, status, err := c.doAuthed(ctx, http.MethodGet, u, nil, "")
		if err != nil {
			return nil, fmt.Errorf("list GCS bucket: %w", err)
		}
		if status < 200 || status >= 300 {
			return nil, fmt.Errorf("list GCS bucket HTTP %d: %s", status, strings.TrimSpace(string(data)))
		}
		var resp struct {
			Items         []GCSObject `json:"items"`
			NextPageToken string      `json:"nextPageToken"`
		}
		if err := json.Unmarshal(data, &resp); err != nil {
			return nil, fmt.Errorf("decode GCS list: %w", err)
		}
		all = append(all, resp.Items...)
		if resp.NextPageToken == "" {
			break
		}
		pageToken = resp.NextPageToken
	}
	return all, nil
}

// DownloadObject downloads the raw bytes of a GCS object.
func (c *Client) DownloadObject(ctx context.Context, objectName string) ([]byte, error) {
	base := strings.TrimRight(c.GCSBaseURL, "/")
	u := fmt.Sprintf("%s/storage/v1/b/%s/o/%s?alt=media",
		base, url.PathEscape(c.Bucket), url.PathEscape(objectName))
	data, status, err := c.doAuthed(ctx, http.MethodGet, u, nil, "")
	if err != nil {
		return nil, fmt.Errorf("download %s: %w", objectName, err)
	}
	if status < 200 || status >= 300 {
		return nil, fmt.Errorf("download %s HTTP %d: %s", objectName, status, strings.TrimSpace(string(data)))
	}
	return data, nil
}

// DecodePlayCSV converts UTF-16LE/BE (with BOM) or UTF-8 CSV bytes into clean UTF-8 string.
func DecodePlayCSV(raw []byte) (string, error) {
	if len(raw) >= 2 && ((raw[0] == 0xFF && raw[1] == 0xFE) || (raw[0] == 0xFE && raw[1] == 0xFF)) {
		dec := unicode.UTF16(unicode.LittleEndian, unicode.UseBOM).NewDecoder()
		out, err := io.ReadAll(transform.NewReader(bytes.NewReader(raw), dec))
		if err != nil {
			return "", fmt.Errorf("decode UTF-16 CSV: %w", err)
		}
		return strings.TrimPrefix(string(out), "\uFEFF"), nil
	}
	// Strip UTF-8 BOM if present.
	return strings.TrimPrefix(string(bytes.TrimPrefix(raw, []byte{0xEF, 0xBB, 0xBF})), "\uFEFF"), nil
}

// ParseGCSCSV parses a Play Console CSV file according to its object path.
func ParseGCSCSV(objectName, packageName string, raw []byte) (ParsedReport, error) {
	var out ParsedReport
	text, err := DecodePlayCSV(raw)
	if err != nil {
		return out, err
	}
	if strings.TrimSpace(text) == "" {
		return out, nil
	}

	cr := csv.NewReader(strings.NewReader(text))
	cr.FieldsPerRecord = -1
	rows, err := cr.ReadAll()
	if err != nil {
		return out, fmt.Errorf("parse CSV %s: %w", objectName, err)
	}
	if len(rows) <= 1 {
		return out, nil
	}

	colIdx := make(map[string]int, len(rows[0]))
	for i, h := range rows[0] {
		colIdx[strings.ToLower(strings.TrimSpace(h))] = i
	}

	get := func(rec []string, key string) string {
		if idx, ok := colIdx[key]; ok && idx < len(rec) {
			return strings.TrimSpace(rec[idx])
		}
		return ""
	}

	dimType, dimCol := inferDimensionFromPath(objectName)

	switch {
	case strings.HasPrefix(objectName, "stats/installs/"):
		for _, rec := range rows[1:] {
			d, ok := parseDate(get(rec, "date"))
			if !ok {
				continue
			}
			pkg := fallbackStr(get(rec, "package name"), packageName)
			dimVal := ""
			if dimCol != "" {
				dimVal = get(rec, dimCol)
			}
			out.Installs = append(out.Installs, db.PlayInstallRow{
				ReportDate:            d,
				PackageName:           pkg,
				DimensionType:         dimType,
				DimensionValue:        dimVal,
				DailyDeviceInstalls:   parseInt64(get(rec, "daily device installs")),
				DailyDeviceUninstalls: parseInt64(get(rec, "daily device uninstalls")),
				DailyDeviceUpgrades:   parseInt64(get(rec, "daily device upgrades")),
				TotalUserInstalls:     parseInt64(get(rec, "total user installs")),
				DailyUserInstalls:     parseInt64(get(rec, "daily user installs")),
				DailyUserUninstalls:   parseInt64(get(rec, "daily user uninstalls")),
				ActiveDeviceInstalls:  parseInt64(get(rec, "active device installs")),
				InstallEvents:         parseInt64(get(rec, "install events")),
				UpdateEvents:          parseInt64(get(rec, "update events")),
				UninstallEvents:       parseInt64(get(rec, "uninstall events")),
			})
		}

	case strings.HasPrefix(objectName, "stats/store_performance/"):
		for _, rec := range rows[1:] {
			d, ok := parseDate(get(rec, "date"))
			if !ok {
				continue
			}
			pkg := fallbackStr(get(rec, "package name"), packageName)
			var dimVal, searchTerm, utmSource, utmCampaign string
			if dimType == "traffic_source" {
				dimVal = get(rec, "traffic source")
				searchTerm = get(rec, "search term")
				utmSource = get(rec, "utm source")
				utmCampaign = get(rec, "utm campaign")
			} else {
				dimVal = get(rec, "country / region")
			}
			out.StorePerformance = append(out.StorePerformance, db.PlayStorePerfRow{
				ReportDate:     d,
				PackageName:    pkg,
				DimensionType:  dimType,
				DimensionValue: dimVal,
				SearchTerm:     searchTerm,
				UTMSource:      utmSource,
				UTMCampaign:    utmCampaign,
				Acquisitions:   parseInt64(get(rec, "store listing acquisitions")),
				Visitors:       parseInt64(get(rec, "store listing visitors")),
				ConversionRate: parseFloat64(get(rec, "store listing conversion rate")),
			})
		}

	case strings.HasPrefix(objectName, "stats/ratings/"):
		for _, rec := range rows[1:] {
			d, ok := parseDate(get(rec, "date"))
			if !ok {
				continue
			}
			pkg := fallbackStr(get(rec, "package name"), packageName)
			dimVal := ""
			if dimCol != "" {
				dimVal = get(rec, dimCol)
			}
			out.Ratings = append(out.Ratings, db.PlayRatingRow{
				ReportDate:     d,
				PackageName:    pkg,
				DimensionType:  dimType,
				DimensionValue: dimVal,
				DailyAvgRating: parseFloatPtr(get(rec, "daily average rating")),
				TotalAvgRating: parseFloatPtr(get(rec, "total average rating")),
			})
		}

	case strings.HasPrefix(objectName, "stats/crashes/"):
		for _, rec := range rows[1:] {
			d, ok := parseDate(get(rec, "date"))
			if !ok {
				continue
			}
			pkg := fallbackStr(get(rec, "package name"), packageName)
			dimVal := ""
			if dimCol != "" {
				dimVal = get(rec, dimCol)
			}
			out.Crashes = append(out.Crashes, db.PlayCrashRow{
				ReportDate:     d,
				PackageName:    pkg,
				DimensionType:  dimType,
				DimensionValue: dimVal,
				DailyCrashes:   parseInt64(get(rec, "daily crashes")),
				DailyANRs:      parseInt64(get(rec, "daily anrs")),
			})
		}

	case strings.HasPrefix(objectName, "reviews/"):
		for _, rec := range rows[1:] {
			pkg := fallbackStr(get(rec, "package name"), packageName)
			subAt, ok := parseReviewTimestamp(get(rec, "review submit date and time"), get(rec, "review submit millis since epoch"))
			if !ok {
				continue
			}
			updAt, ok2 := parseReviewTimestamp(get(rec, "review last update date and time"), get(rec, "review last update millis since epoch"))
			if !ok2 {
				updAt = subAt
			}
			var repPtr *time.Time
			if repAt, ok3 := parseReviewTimestamp(get(rec, "developer reply date and time"), get(rec, "developer reply millis since epoch")); ok3 {
				repPtr = &repAt
			}

			verCode := get(rec, "app version code")
			verName := get(rec, "app version name")
			lang := get(rec, "reviewer language")
			device := get(rec, "device")
			stars := int(parseInt64(get(rec, "star rating")))
			title := get(rec, "review title")
			body := get(rec, "review text")
			replyText := get(rec, "developer reply text")
			link := get(rec, "review link")

			reviewKey := link
			if reviewKey == "" {
				subMs := get(rec, "review submit millis since epoch")
				sum := sha256.Sum256([]byte(strings.Join([]string{
					subMs, subAt.Format(time.RFC3339Nano), device, verCode, lang, strconv.Itoa(stars), title, body,
				}, "|")))
				reviewKey = "hash:" + hex.EncodeToString(sum[:16])
			}

			out.Reviews = append(out.Reviews, db.PlayReviewRow{
				PackageName:      pkg,
				ReviewKey:        reviewKey,
				AppVersionCode:   verCode,
				AppVersionName:   verName,
				ReviewerLanguage: lang,
				Device:           device,
				SubmittedAt:      subAt,
				UpdatedAt:        updAt,
				StarRating:       stars,
				ReviewTitle:      title,
				ReviewText:       body,
				ReplyAt:          repPtr,
				ReplyText:        replyText,
				ReviewLink:       link,
			})
		}
	}

	return out, nil
}

func inferDimensionFromPath(objectName string) (dimType, csvCol string) {
	switch {
	case strings.HasSuffix(objectName, "_overview.csv"):
		return "overview", ""
	case strings.HasSuffix(objectName, "_country.csv"):
		return "country", "country"
	case strings.HasSuffix(objectName, "_device.csv"):
		return "device", "device"
	case strings.HasSuffix(objectName, "_app_version.csv"):
		return "app_version", "app version code"
	case strings.HasSuffix(objectName, "_os_version.csv"):
		return "os_version", "android os version"
	case strings.HasSuffix(objectName, "_language.csv"):
		return "language", "language"
	case strings.HasSuffix(objectName, "_carrier.csv"):
		return "carrier", "carrier"
	case strings.HasSuffix(objectName, "_traffic_source.csv"):
		return "traffic_source", "traffic source"
	default:
		return "unknown", ""
	}
}

func parseDate(raw string) (time.Time, bool) {
	t, err := time.Parse("2006-01-02", strings.TrimSpace(raw))
	if err != nil {
		return time.Time{}, false
	}
	return t.UTC(), true
}

func parseReviewTimestamp(isoRaw, millisRaw string) (time.Time, bool) {
	if isoRaw != "" {
		if t, err := time.Parse(time.RFC3339, isoRaw); err == nil {
			return t.UTC(), true
		}
	}
	if millisRaw != "" {
		if ms, err := strconv.ParseInt(millisRaw, 10, 64); err == nil && ms > 0 {
			return time.UnixMilli(ms).UTC(), true
		}
	}
	return time.Time{}, false
}

func parseInt64(raw string) int64 {
	raw = strings.ReplaceAll(strings.TrimSpace(raw), ",", "")
	if raw == "" || strings.EqualFold(raw, "na") {
		return 0
	}
	v, _ := strconv.ParseInt(raw, 10, 64)
	return v
}

func parseFloat64(raw string) float64 {
	raw = strings.ReplaceAll(strings.TrimSpace(raw), ",", "")
	if raw == "" || strings.EqualFold(raw, "na") {
		return 0
	}
	v, _ := strconv.ParseFloat(raw, 64)
	return v
}

func parseFloatPtr(raw string) *float64 {
	raw = strings.ReplaceAll(strings.TrimSpace(raw), ",", "")
	if raw == "" || strings.EqualFold(raw, "na") {
		return nil
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return nil
	}
	return &v
}

func fallbackStr(v, def string) string {
	if v != "" {
		return v
	}
	return def
}
