package github

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path"
	"regexp"
	"strings"
	"sync"
)

var assetHashSuffixRe = regexp.MustCompile(`-[0-9a-f]{8}$`)

// EnrichedAsset combines GitHub release asset data with Professor Euler catalog metadata.
type EnrichedAsset struct {
	AssetID       int64
	ReleaseID     int64
	ReleaseTag    string
	ReleaseName   string
	AssetName     string
	ItemKey       string
	DisplayTitle  string
	Category      string
	Subject       string
	Language      string
	Edition       string
	Author        string
	License       string
	Pages         int
	Exercises     int
	IncludedInApp bool
	SizeBytes     int64
	DownloadCount int64
	DownloadURL   string
	CreatedAt     string
	UpdatedAt     string
}

type libraryCatalog struct {
	Levels []struct {
		ID    string `json:"id"`
		Title string `json:"title"`
	} `json:"levels"`
	Books []struct {
		ID        string `json:"id"`
		Number    string `json:"number"`
		Title     string `json:"title"`
		Author    string `json:"author"`
		Level     string `json:"level"`
		License   string `json:"license"`
		Notice    string `json:"notice"`
		Pages     int    `json:"pages"`
		Exercises int    `json:"exercises"`
		Included  bool   `json:"included"`
		Asset     string `json:"asset"`
	} `json:"books"`
	Recognizer *struct {
		ID    string `json:"id"`
		Asset string `json:"asset"`
	} `json:"recognizer"`
}

type curriculumAssetEntry struct {
	Asset string `json:"asset"`
	Pages int    `json:"pages"`
}

type curriculumLanguageEntry struct {
	Asset string                `json:"asset"`
	Pages int                   `json:"pages"`
	Phone *curriculumAssetEntry `json:"phone"`
}

type curriculumCatalog struct {
	Courses []struct {
		Code      string `json:"code"`
		Title     string `json:"title"`
		Workbooks []struct {
			ID        string                             `json:"id"`
			N         int                                `json:"n"`
			Title     string                             `json:"title"`
			Asset     string                             `json:"asset"`
			Pages     int                                `json:"pages"`
			Phone     *curriculumAssetEntry              `json:"phone"`
			Languages map[string]curriculumLanguageEntry `json:"languages"`
		} `json:"workbooks"`
	} `json:"courses"`
}

// Catalog holds indexed metadata from library.json and curriculum.json.
type Catalog struct {
	byAsset   map[string]CatalogMeta
	byItemKey map[string]CatalogMeta
}

// CatalogMeta stores human-readable enrichment fields for a single asset.
type CatalogMeta struct {
	DisplayTitle  string
	Category      string
	Subject       string
	Language      string
	Edition       string
	Author        string
	License       string
	Pages         int
	Exercises     int
	IncludedInApp bool
}

// CatalogCache fetches and caches library.json and curriculum.json with ETag support.
type CatalogCache struct {
	mu             sync.Mutex
	libraryETag    string
	curriculumETag string
	library        *libraryCatalog
	curriculum     *curriculumCatalog
	compiled       *Catalog
}

// NewCatalogCache returns an empty catalog cache.
func NewCatalogCache() *CatalogCache {
	return &CatalogCache{}
}

// Refresh fetches library.json and curriculum.json (falling back to cached data on non-fatal errors).
func (cc *CatalogCache) Refresh(ctx context.Context, client *Client) (*Catalog, error) {
	cc.mu.Lock()
	defer cc.mu.Unlock()

	libURL := fmt.Sprintf("%s/%s/%s/main/catalog/library.json",
		strings.TrimRight(client.RawBaseURL, "/"), client.Owner, client.Repo)
	curURL := fmt.Sprintf("%s/%s/%s/main/catalog/curriculum.json",
		strings.TrimRight(client.RawBaseURL, "/"), client.Owner, client.Repo)

	var errs []string
	if raw, etag, modified, err := fetchRaw(ctx, client, libURL, cc.libraryETag); err != nil {
		errs = append(errs, "library.json: "+err.Error())
	} else if modified {
		var parsed libraryCatalog
		if err := json.Unmarshal(raw, &parsed); err != nil {
			errs = append(errs, "parse library.json: "+err.Error())
		} else {
			cc.library = &parsed
			cc.libraryETag = etag
			cc.compiled = nil
		}
	}

	if raw, etag, modified, err := fetchRaw(ctx, client, curURL, cc.curriculumETag); err != nil {
		errs = append(errs, "curriculum.json: "+err.Error())
	} else if modified {
		var parsed curriculumCatalog
		if err := json.Unmarshal(raw, &parsed); err != nil {
			errs = append(errs, "parse curriculum.json: "+err.Error())
		} else {
			cc.curriculum = &parsed
			cc.curriculumETag = etag
			cc.compiled = nil
		}
	}

	if cc.compiled == nil {
		cc.compiled = buildCatalog(cc.library, cc.curriculum)
	}

	if len(errs) > 0 {
		return cc.compiled, fmt.Errorf("%s", strings.Join(errs, "; "))
	}
	return cc.compiled, nil
}

func fetchRaw(ctx context.Context, client *Client, url, etag string) ([]byte, string, bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, "", false, err
	}
	req.Header.Set("User-Agent", client.UserAgent)
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}

	resp, err := client.HTTPClient.Do(req)
	if err != nil {
		return nil, "", false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotModified {
		return nil, etag, false, nil
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", false, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", false, err
	}
	return body, resp.Header.Get("ETag"), true, nil
}

func buildCatalog(lib *libraryCatalog, cur *curriculumCatalog) *Catalog {
	cat := &Catalog{
		byAsset:   make(map[string]CatalogMeta),
		byItemKey: make(map[string]CatalogMeta),
	}

	if lib != nil {
		levelTitles := make(map[string]string, len(lib.Levels))
		for _, lvl := range lib.Levels {
			levelTitles[lvl.ID] = lvl.Title
		}
		for _, b := range lib.Books {
			subj := levelTitles[b.Level]
			if subj == "" {
				subj = "Open Textbook"
			}
			lang := inferBookLanguage(b.ID, b.Level, b.Title, b.Notice)
			category := "Open Textbook"
			if lang == "de" {
				if strings.HasPrefix(b.ID, "de_p_") {
					category = "German Practice Exams"
				} else {
					category = "German Textbook"
				}
			}
			meta := CatalogMeta{
				DisplayTitle:  b.Title,
				Category:      category,
				Subject:       subj,
				Language:      lang,
				Edition:       "all",
				Author:        b.Author,
				License:       b.License,
				Pages:         b.Pages,
				Exercises:     b.Exercises,
				IncludedInApp: b.Included,
			}
			if b.Asset != "" {
				cat.byAsset[b.Asset] = meta
				cat.byItemKey[ExtractItemKey(b.Asset)] = meta
			}
			if b.ID != "" {
				cat.byItemKey[b.ID] = meta
			}
		}
		if lib.Recognizer != nil && lib.Recognizer.Asset != "" {
			title := "Calculate Handwriting Model"
			if lib.Recognizer.ID != "" {
				title = fmt.Sprintf("Calculate Handwriting Model (%s)", lib.Recognizer.ID)
			}
			meta := CatalogMeta{
				DisplayTitle: title,
				Category:     "App Component",
				Subject:      "Calculate Model",
				Language:     "all",
				Edition:      "all",
				Author:       "Professor Euler",
			}
			cat.byAsset[lib.Recognizer.Asset] = meta
			cat.byItemKey[ExtractItemKey(lib.Recognizer.Asset)] = meta
		}
	}

	if cur != nil {
		for _, course := range cur.Courses {
			for _, wb := range course.Workbooks {
				baseTitle := fmt.Sprintf("%s · WB %d: %s", course.Title, wb.N, wb.Title)
				addWB := func(asset string, pages int, lang, edition string) {
					if asset == "" {
						return
					}
					meta := CatalogMeta{
						DisplayTitle: baseTitle,
						Category:     "Curriculum",
						Subject:      course.Title,
						Language:     lang,
						Edition:      edition,
						Author:       "David Schmid",
						License:      "Professor Euler Curriculum",
						Pages:        pages,
					}
					cat.byAsset[asset] = meta
					cat.byItemKey[ExtractItemKey(asset)] = meta
				}
				addWB(wb.Asset, wb.Pages, "en", "tablet")
				if wb.Phone != nil {
					addWB(wb.Phone.Asset, wb.Phone.Pages, "en", "phone")
				}
				for langCode, lEntry := range wb.Languages {
					addWB(lEntry.Asset, lEntry.Pages, langCode, "tablet")
					if lEntry.Phone != nil {
						addWB(lEntry.Phone.Asset, lEntry.Phone.Pages, langCode, "phone")
					}
				}
			}
		}
	}

	return cat
}

// Resolve looks up catalog enrichment for an asset, falling back to filename heuristics.
func (c *Catalog) Resolve(releaseTag, assetName string) (string, CatalogMeta) {
	itemKey := ExtractItemKey(assetName)
	if c != nil {
		if m, ok := c.byAsset[assetName]; ok {
			return itemKey, m
		}
		if m, ok := c.byItemKey[itemKey]; ok {
			return itemKey, m
		}
	}
	return itemKey, fallbackMeta(releaseTag, assetName, itemKey)
}

// ExtractItemKey strips the extension and trailing 8-hex content hash from an asset filename.
// Example: "alg1_wb1-1413444f.mcbundle" -> "alg1_wb1".
func ExtractItemKey(assetName string) string {
	ext := path.Ext(assetName)
	base := strings.TrimSuffix(assetName, ext)
	return assetHashSuffixRe.ReplaceAllString(base, "")
}

func inferBookLanguage(id, level, title, notice string) string {
	if level == "german" || strings.HasPrefix(id, "de_") {
		return "de"
	}
	combined := strings.ToLower(title + " " + notice)
	for _, marker := range []string{"auflage", "grundlagen", "maschinelles lernen", "eingebettete systeme", "probeklausuren"} {
		if strings.Contains(combined, marker) {
			return "de"
		}
	}
	return "en"
}

func fallbackMeta(releaseTag, assetName, itemKey string) CatalogMeta {
	lower := strings.ToLower(itemKey)
	switch {
	case strings.HasPrefix(lower, "editable-sources"):
		return CatalogMeta{
			DisplayTitle: "Editable Sources Archive",
			Category:     "Source Archive",
			Subject:      "Authoring Sources",
			Language:     "all",
			Edition:      "all",
		}
	case strings.HasPrefix(lower, "math-reader"):
		return CatalogMeta{
			DisplayTitle: "Calculate Handwriting Model (" + strings.TrimPrefix(lower, "math-reader-") + ")",
			Category:     "App Component",
			Subject:      "Calculate Model",
			Language:     "all",
			Edition:      "all",
		}
	case releaseTag == "curriculum":
		lang := "en"
		if strings.Contains(lower, "_de") {
			lang = "de"
		}
		edition := "tablet"
		if strings.Contains(lower, "_phone") {
			edition = "phone"
		}
		subject := inferCurriculumSubject(lower)
		return CatalogMeta{
			DisplayTitle: formatSlugTitle(itemKey),
			Category:     "Curriculum",
			Subject:      subject,
			Language:     lang,
			Edition:      edition,
		}
	default:
		lang := "en"
		cat := "Open Textbook"
		if strings.HasPrefix(lower, "de_p_") {
			lang = "de"
			cat = "German Practice Exams"
		} else if strings.HasPrefix(lower, "de_") {
			lang = "de"
			cat = "German Textbook"
		}
		return CatalogMeta{
			DisplayTitle: formatSlugTitle(itemKey),
			Category:     cat,
			Subject:      "Mathematics",
			Language:     lang,
			Edition:      "all",
		}
	}
}

func inferCurriculumSubject(lower string) string {
	switch {
	case strings.HasPrefix(lower, "alg1_"):
		return "Algebra 1"
	case strings.HasPrefix(lower, "alg2_"):
		return "Algebra 2"
	case strings.HasPrefix(lower, "geo_"):
		return "Geometry"
	case strings.HasPrefix(lower, "prec_"):
		return "Precalculus"
	case strings.HasPrefix(lower, "calc_"):
		return "Calculus"
	default:
		return "Curriculum"
	}
}

func formatSlugTitle(slug string) string {
	parts := strings.Split(strings.ReplaceAll(slug, "-", "_"), "_")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p == "" {
			continue
		}
		out = append(out, strings.ToUpper(p[:1])+p[1:])
	}
	return strings.Join(out, " ")
}
