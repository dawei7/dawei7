package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/dawei7/dawei7/apps/euler-stats/db"
	"github.com/dawei7/dawei7/apps/euler-stats/poller"
)

type fakeAnalyticsReader struct {
	lastParams db.QueryParams
	pingErr    error
}

func (f *fakeAnalyticsReader) Ping(context.Context) error { return f.pingErr }

func (f *fakeAnalyticsReader) PollHistoryBounds(context.Context) (*time.Time, *time.Time, error) {
	t := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	return &t, &t, nil
}

func (f *fakeAnalyticsReader) GetOverview(_ context.Context, p db.QueryParams) (db.OverviewResponse, error) {
	f.lastParams = p
	return db.OverviewResponse{}, nil
}

func (f *fakeAnalyticsReader) GetTimeSeries(_ context.Context, p db.QueryParams) (db.TimeSeriesResponse, error) {
	f.lastParams = p
	cum := int64(509)
	return db.TimeSeriesResponse{
		Granularity: p.Granularity,
		GroupBy:     p.GroupBy,
		Timezone:    p.TZName,
		SeriesKeys:  []string{"curriculum", "books"},
		Buckets: []db.TimeSeriesBucket{{
			Timestamp:  time.Date(2026, 11, 16, 14, 0, 0, 0, time.UTC),
			Label:      "Nov 16 14:00",
			Delta:      12,
			Cumulative: &cum,
			Series:     map[string]int64{"curriculum": 8, "books": 4},
		}},
	}, nil
}

func (f *fakeAnalyticsReader) GetAssets(_ context.Context, p db.QueryParams, _ db.AssetMode, _, _ string) ([]db.AssetRow, error) {
	f.lastParams = p
	return []db.AssetRow{{
		AssetID:                 1,
		ReleaseTag:              "curriculum",
		AssetName:               "alg1_wb1-1413444f.mcbundle",
		ItemKey:                 "alg1_wb1",
		DisplayTitle:            "Algebra 1 · WB 1",
		VersionCount:            2,
		CurrentVersionDownloads: 3,
		AllTimeDownloads:        10,
		WindowDelta:             2,
	}}, nil
}

func (f *fakeAnalyticsReader) GetItemVersions(_ context.Context, releaseTag, itemKey string) ([]db.AssetRow, error) {
	return []db.AssetRow{
		{AssetID: 2, ReleaseTag: releaseTag, ItemKey: itemKey, AssetName: itemKey + "-new.mcbundle", IsActive: true, AllTimeDownloads: 3},
		{AssetID: 1, ReleaseTag: releaseTag, ItemKey: itemKey, AssetName: itemKey + "-old.mcbundle", IsActive: false, AllTimeDownloads: 7},
	}, nil
}

func (f *fakeAnalyticsReader) GetPollRuns(context.Context, int) ([]db.PollRunRow, error) {
	return []db.PollRunRow{{ID: 1, Status: "ok"}}, nil
}

func (f *fakeAnalyticsReader) PlayDateBounds(context.Context) (*time.Time, *time.Time, error) {
	t := time.Date(2026, 9, 25, 0, 0, 0, 0, time.UTC)
	return &t, &t, nil
}

func (f *fakeAnalyticsReader) GetPlayOverview(_ context.Context, pkgName string, _, _ time.Time, _ string, enabled bool) (db.PlayOverviewResponse, error) {
	var ov db.PlayOverviewResponse
	ov.Sync.PackageName = pkgName
	ov.Sync.Enabled = enabled
	ov.Totals.DeviceInstalls = 42
	return ov, nil
}

func (f *fakeAnalyticsReader) GetPlayTimeSeries(_ context.Context, _ string, gran db.Granularity, _, _ time.Time, _ *time.Location, tzName, country string) (db.PlayTimeSeriesResponse, error) {
	return db.PlayTimeSeriesResponse{
		Granularity: gran,
		Timezone:    tzName,
		Country:     country,
		Points: []db.PlayTimeSeriesPoint{{
			Timestamp:      time.Date(2026, 11, 9, 11, 0, 0, 0, time.UTC),
			Label:          "Nov 09 11:00",
			DeviceInstalls: 3,
			Crashes:        5,
		}},
	}, nil
}

func (f *fakeAnalyticsReader) GetPlayReviews(context.Context, string, int) ([]db.PlayReviewView, error) {
	return []db.PlayReviewView{{ReviewKey: "r1", StarRating: 5}}, nil
}

func (f *fakeAnalyticsReader) GetPlayVitals(context.Context, string, int) ([]db.PlayVitalsSummaryRow, error) {
	return []db.PlayVitalsSummaryRow{{MetricSet: "errorCountMetricSet", AggregationPeriod: "HOURLY"}}, nil
}

func (f *fakeAnalyticsReader) GetPlayPollRuns(context.Context, int) ([]db.PlayPollRunRow, error) {
	return []db.PlayPollRunRow{{ID: 1, Status: "ok"}}, nil
}

type fakePollRunner struct{ called bool }

func (f *fakePollRunner) PollOnce(context.Context) (poller.PollResult, error) {
	f.called = true
	return poller.PollResult{PollRunID: 42, TotalDownloads: 509}, nil
}

func TestHandlersValidationCSVAndAdminAuth(t *testing.T) {
	reader := &fakeAnalyticsReader{}
	runner := &fakePollRunner{}
	mux := newMux(reader, runner, nil, appConfig{
		adminSecret: "top-secret",
		playPackage: "com.mathn.tablet",
		playEnabled: true,
	})

	// 1. Valid timeseries JSON
	req := httptest.NewRequest(http.MethodGet, "/api/timeseries?granularity=hour&group_by=release&tz=Europe/Zurich", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if reader.lastParams.Granularity != db.GranularityHour || reader.lastParams.TZName != "Europe/Zurich" {
		t.Fatalf("unexpected parsed params: %+v", reader.lastParams)
	}

	// 2. Invalid granularity -> 400
	reqBad := httptest.NewRequest(http.MethodGet, "/api/timeseries?granularity=minute", nil)
	recBad := httptest.NewRecorder()
	mux.ServeHTTP(recBad, reqBad)
	if recBad.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid granularity, got %d", recBad.Code)
	}

	// 3. CSV export
	reqCSV := httptest.NewRequest(http.MethodGet, "/api/export.csv?type=timeseries&granularity=hour", nil)
	recCSV := httptest.NewRecorder()
	mux.ServeHTTP(recCSV, reqCSV)
	if recCSV.Code != http.StatusOK || !strings.Contains(recCSV.Body.String(), "delta_curriculum,delta_books") {
		t.Fatalf("unexpected CSV export response (%d): %s", recCSV.Code, recCSV.Body.String())
	}

	// 4. POST /api/poll auth check
	reqUnauth := httptest.NewRequest(http.MethodPost, "/api/poll", nil)
	recUnauth := httptest.NewRecorder()
	mux.ServeHTTP(recUnauth, reqUnauth)
	if recUnauth.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without bearer token, got %d", recUnauth.Code)
	}

	reqAuth := httptest.NewRequest(http.MethodPost, "/api/poll", nil)
	reqAuth.Header.Set("Authorization", "Bearer top-secret")
	recAuth := httptest.NewRecorder()
	mux.ServeHTTP(recAuth, reqAuth)
	if recAuth.Code != http.StatusOK || !runner.called {
		t.Fatalf("expected 200 and runner called, got %d", recAuth.Code)
	}
	var pollBody poller.PollResult
	if err := json.Unmarshal(recAuth.Body.Bytes(), &pollBody); err != nil || pollBody.PollRunID != 42 {
		t.Fatalf("unexpected poll body: %s", recAuth.Body.String())
	}

	// 5. Item versions endpoint + item_key timeseries filter
	reqVer := httptest.NewRequest(http.MethodGet, "/api/item-versions?release=curriculum&item_key=alg1_wb1", nil)
	recVer := httptest.NewRecorder()
	mux.ServeHTTP(recVer, reqVer)
	if recVer.Code != http.StatusOK || !strings.Contains(recVer.Body.String(), "alg1_wb1-old.mcbundle") {
		t.Fatalf("unexpected item-versions response (%d): %s", recVer.Code, recVer.Body.String())
	}

	reqTSItem := httptest.NewRequest(http.MethodGet, "/api/timeseries?granularity=day&item_key=alg1_wb1", nil)
	recTSItem := httptest.NewRecorder()
	mux.ServeHTTP(recTSItem, reqTSItem)
	if recTSItem.Code != http.StatusOK || reader.lastParams.ItemKey != "alg1_wb1" {
		t.Fatalf("expected item_key parsed into QueryParams, got %+v", reader.lastParams)
	}

	// 6. Play Store endpoints
	reqPlayOv := httptest.NewRequest(http.MethodGet, "/api/play/overview?range=all", nil)
	recPlayOv := httptest.NewRecorder()
	mux.ServeHTTP(recPlayOv, reqPlayOv)
	if recPlayOv.Code != http.StatusOK || !strings.Contains(recPlayOv.Body.String(), `"device_installs":42`) {
		t.Fatalf("unexpected play overview response (%d): %s", recPlayOv.Code, recPlayOv.Body.String())
	}

	reqPlayTS := httptest.NewRequest(http.MethodGet, "/api/play/timeseries?granularity=hour&tz=Europe/Zurich", nil)
	recPlayTS := httptest.NewRecorder()
	mux.ServeHTTP(recPlayTS, reqPlayTS)
	if recPlayTS.Code != http.StatusOK || !strings.Contains(recPlayTS.Body.String(), `"crashes":5`) {
		t.Fatalf("unexpected play timeseries response (%d): %s", recPlayTS.Code, recPlayTS.Body.String())
	}

	reqPlayCSV := httptest.NewRequest(http.MethodGet, "/api/play/export.csv?type=timeseries", nil)
	recPlayCSV := httptest.NewRecorder()
	mux.ServeHTTP(recPlayCSV, reqPlayCSV)
	if recPlayCSV.Code != http.StatusOK || !strings.Contains(recPlayCSV.Body.String(), "device_installs,device_uninstalls") {
		t.Fatalf("unexpected play CSV response (%d): %s", recPlayCSV.Code, recPlayCSV.Body.String())
	}
}

func TestSPAHandlerPWAHeaders(t *testing.T) {
	mockDist := fstest.MapFS{
		"index.html":           &fstest.MapFile{Data: []byte("<!doctype html><html><body>ok</body></html>")},
		"manifest.webmanifest": &fstest.MapFile{Data: []byte(`{"name":"Euler Stats"}`)},
		"sw.js":                &fstest.MapFile{Data: []byte("self.addEventListener('fetch', () => {});")},
		"icons/icon-192.png":   &fstest.MapFile{Data: []byte{0x89, 0x50, 0x4e, 0x47}},
		"assets/app-123.js":    &fstest.MapFile{Data: []byte("console.log(1)")},
	}
	h := newSPAHandler(mockDist)

	cases := []struct {
		path        string
		wantCT      string
		wantCC      string
		wantContain string
	}{
		{"/manifest.webmanifest", "application/manifest+json", "no-cache", "Euler Stats"},
		{"/sw.js", "application/javascript", "no-cache", "addEventListener"},
		{"/icons/icon-192.png", "image/png", "max-age=604800", ""},
		{"/assets/app-123.js", "", "immutable", "console.log"},
		{"/unknown-route", "text/html", "no-cache", "<!doctype html>"},
	}

	for _, tc := range cases {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: expected 200, got %d", tc.path, rec.Code)
		}
		if tc.wantCT != "" && !strings.Contains(rec.Header().Get("Content-Type"), tc.wantCT) {
			t.Fatalf("%s: expected Content-Type containing %q, got %q", tc.path, tc.wantCT, rec.Header().Get("Content-Type"))
		}
		if tc.wantCC != "" && !strings.Contains(rec.Header().Get("Cache-Control"), tc.wantCC) {
			t.Fatalf("%s: expected Cache-Control containing %q, got %q", tc.path, tc.wantCC, rec.Header().Get("Cache-Control"))
		}
		if tc.wantContain != "" && !strings.Contains(rec.Body.String(), tc.wantContain) {
			t.Fatalf("%s: expected body containing %q, got %q", tc.path, tc.wantContain, rec.Body.String())
		}
	}
}
