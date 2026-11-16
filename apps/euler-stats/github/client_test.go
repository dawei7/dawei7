package github

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestFetchAllReleasesPaginatesReleasesAndAssets(t *testing.T) {
	var baseURL string
	mux := http.NewServeMux()
	mux.HandleFunc("GET /repos/dawei7/professor-euler-library/releases", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-RateLimit-Remaining", "58")
		w.Header().Set("X-RateLimit-Reset", "1794840000")
		page := r.URL.Query().Get("page")
		if page == "" || page == "1" {
			w.Header().Set("Link", fmt.Sprintf(`<%s/repos/dawei7/professor-euler-library/releases?per_page=100&page=2>; rel="next"`, baseURL))
			_ = json.NewEncoder(w).Encode([]Release{
				{ID: 1, TagName: "curriculum", Name: "Curriculum", Draft: false},
				{ID: 99, TagName: "draft-tag", Name: "Draft", Draft: true},
			})
			return
		}
		_ = json.NewEncoder(w).Encode([]Release{
			{ID: 2, TagName: "books", Name: "Books", Draft: false},
		})
	})
	mux.HandleFunc("GET /repos/dawei7/professor-euler-library/releases/1/assets", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-RateLimit-Remaining", "57")
		page := r.URL.Query().Get("page")
		if page == "" || page == "1" {
			w.Header().Set("Link", fmt.Sprintf(`<%s/repos/dawei7/professor-euler-library/releases/1/assets?per_page=100&page=2>; rel="next"`, baseURL))
			_ = json.NewEncoder(w).Encode([]Asset{
				{ID: 101, Name: "alg1_wb1-1413444f.mcbundle", DownloadCount: 7},
			})
			return
		}
		_ = json.NewEncoder(w).Encode([]Asset{
			{ID: 102, Name: "alg1_wb1_phone-bfe83743.mcbundle", DownloadCount: 4},
		})
	})
	mux.HandleFunc("GET /repos/dawei7/professor-euler-library/releases/2/assets", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-RateLimit-Remaining", "56")
		_ = json.NewEncoder(w).Encode([]Asset{
			{ID: 201, Name: "book_of_proof_hammack-ccadcf9e.mcbundle", DownloadCount: 10},
		})
	})

	srv := httptest.NewServer(mux)
	defer srv.Close()
	baseURL = srv.URL

	client := NewClient("")
	client.APIBaseURL = srv.URL

	res, err := client.FetchAllReleases(context.Background())
	if err != nil {
		t.Fatalf("FetchAllReleases failed: %v", err)
	}
	if len(res.Releases) != 2 {
		t.Fatalf("expected 2 non-draft releases, got %d", len(res.Releases))
	}
	if len(res.Releases[0].Assets) != 2 {
		t.Fatalf("expected 2 paginated assets on release 1, got %d", len(res.Releases[0].Assets))
	}
	if len(res.Releases[1].Assets) != 1 {
		t.Fatalf("expected 1 asset on release 2, got %d", len(res.Releases[1].Assets))
	}
	if res.RateLimit.Remaining == nil || *res.RateLimit.Remaining != 56 {
		t.Fatalf("unexpected rate limit remaining: %+v", res.RateLimit.Remaining)
	}
}

func TestCatalogRefreshEnrichesAndUsesETag(t *testing.T) {
	var libCalls atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc("GET /dawei7/professor-euler-library/main/catalog/library.json", func(w http.ResponseWriter, r *http.Request) {
		libCalls.Add(1)
		if r.Header.Get("If-None-Match") == `"v1"` {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", `"v1"`)
		_, _ = w.Write([]byte(`{
			"levels":[{"id":"computer-science","title":"Computer science & AI"}],
			"books":[{"id":"maschinelles_lernen_thimm_2026","title":"Maschinelles Lernen","author":"Matthias Thimm","level":"computer-science","license":"CC BY-NC-ND 4.0","pages":382,"exercises":0,"included":false,"asset":"maschinelles_lernen_thimm_2026-3a5223a5.mcbundle"}],
			"recognizer":{"id":"m6","asset":"math-reader-m6-634359fd.zip"}
		}`))
	})
	mux.HandleFunc("GET /dawei7/professor-euler-library/main/catalog/curriculum.json", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{
			"courses":[{
				"code":"ALG1",
				"title":"Algebra 1",
				"workbooks":[{
					"id":"ALG1-WB1",
					"n":1,
					"title":"Foundations",
					"asset":"alg1_wb1-1413444f.mcbundle",
					"pages":400,
					"phone":{"asset":"alg1_wb1_phone-bfe83743.mcbundle","pages":510},
					"languages":{"de":{"asset":"alg1_wb1_de-89e46efb.mcbundle","pages":410,"phone":{"asset":"alg1_wb1_de_phone-db6d1b23.mcbundle","pages":520}}}
				}]
			}]
		}`))
	})

	srv := httptest.NewServer(mux)
	defer srv.Close()

	client := NewClient("")
	client.RawBaseURL = srv.URL
	cache := NewCatalogCache()

	cat, err := cache.Refresh(context.Background(), client)
	if err != nil {
		t.Fatalf("Refresh 1 failed: %v", err)
	}
	if _, err := cache.Refresh(context.Background(), client); err != nil {
		t.Fatalf("Refresh 2 failed: %v", err)
	}
	if libCalls.Load() != 2 {
		t.Fatalf("expected 2 HTTP calls with ETag check, got %d", libCalls.Load())
	}

	key, meta := cat.Resolve("curriculum", "alg1_wb1_de_phone-db6d1b23.mcbundle")
	if key != "alg1_wb1_de_phone" || meta.Language != "de" || meta.Edition != "phone" || meta.Subject != "Algebra 1" {
		t.Fatalf("unexpected curriculum enrichment: key=%s meta=%+v", key, meta)
	}

	_, bookMeta := cat.Resolve("books", "maschinelles_lernen_thimm_2026-3a5223a5.mcbundle")
	if bookMeta.Language != "de" || bookMeta.Category != "German Textbook" || bookMeta.Author != "Matthias Thimm" {
		t.Fatalf("unexpected German CS book enrichment: %+v", bookMeta)
	}

	_, recMeta := cat.Resolve("books", "math-reader-m6-634359fd.zip")
	if recMeta.Category != "App Component" || recMeta.DisplayTitle != "Calculate Handwriting Model (m6)" {
		t.Fatalf("unexpected recognizer enrichment: %+v", recMeta)
	}

	_, fallbackArchive := cat.Resolve("books", "editable-sources-e136d828.zip")
	if fallbackArchive.Category != "Source Archive" || fallbackArchive.DisplayTitle != "Editable Sources Archive" {
		t.Fatalf("unexpected fallback archive enrichment: %+v", fallbackArchive)
	}
}
