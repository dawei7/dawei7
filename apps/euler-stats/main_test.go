package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/dawei7/dawei7/apps/euler-stats/db"
	"github.com/dawei7/dawei7/apps/euler-stats/notify"
	"github.com/dawei7/dawei7/apps/euler-stats/poller"
)

type fakeAnalyticsReader struct {
	lastParams     db.QueryParams
	lastPlayFilter db.PlayFilter
	lastPlayFrom   time.Time
	lastPlayTo     time.Time
	pingErr        error
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

func (f *fakeAnalyticsReader) GetPlayOverview(_ context.Context, pkgName string, fromDate, toDate time.Time, filter db.PlayFilter, enabled bool) (db.PlayOverviewResponse, error) {
	f.lastPlayFrom = fromDate
	f.lastPlayTo = toDate
	f.lastPlayFilter = filter
	var ov db.PlayOverviewResponse
	ov.Sync.PackageName = pkgName
	ov.Sync.Enabled = enabled
	ov.Totals.DeviceInstalls = 42
	return ov, nil
}

func (f *fakeAnalyticsReader) GetPlayTimeSeries(_ context.Context, _ string, gran db.Granularity, _, _ time.Time, _ *time.Location, tzName string, filter db.PlayFilter) (db.PlayTimeSeriesResponse, error) {
	f.lastPlayFilter = filter
	country := ""
	if filter.DimType == "country" {
		country = filter.DimValue
	}
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

type fakeNotifier struct {
	settings db.NotificationSettings
	testSent bool
}

func (f *fakeNotifier) GetOverview(_ context.Context, _ int, adminProtected bool) (notify.NotificationStatusResponse, error) {
	return notify.NotificationStatusResponse{
		Settings: f.settings,
		SMTP: notify.SMTPStatus{
			Configured:  true,
			Host:        "smtp.gmail.com",
			Port:        "587",
			Username:    notify.DefaultGmailAddress,
			DefaultDest: notify.DefaultGmailAddress,
		},
		AdminProtected: adminProtected,
		Logs:           []db.NotificationLogEntry{},
	}, nil
}

func (f *fakeNotifier) UpdateSettings(_ context.Context, upd db.NotificationSettingsUpdate) (db.NotificationSettings, error) {
	f.settings.Enabled = upd.Enabled
	f.settings.RecipientEmail = upd.RecipientEmail
	f.settings.CrashAlertsEnabled = upd.CrashAlertsEnabled
	f.settings.CrashMinVersionCode = upd.CrashMinVersionCode
	f.settings.IncludeANRs = upd.IncludeANRs
	f.settings.DownloadAlertsEnabled = upd.DownloadAlertsEnabled
	f.settings.MinDownloadDelta = upd.MinDownloadDelta
	return f.settings, nil
}

func (f *fakeNotifier) SendTest(context.Context) (db.NotificationLogEntry, error) {
	f.testSent = true
	return db.NotificationLogEntry{ID: 1, EventType: "test", Status: "sent", Recipient: f.settings.RecipientEmail}, nil
}

func TestHandlersValidationCSVAndAdminAuth(t *testing.T) {
	reader := &fakeAnalyticsReader{}
	runner := &fakePollRunner{}
	notifier := &fakeNotifier{settings: db.NotificationSettings{
		Enabled: true, RecipientEmail: notify.DefaultGmailAddress, MinDownloadDelta: 1,
	}}
	mux := newMux(reader, runner, nil, notifier, appConfig{
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

	// 7. Interactive Qlik cross-filter params (hour, dow, dim_type, calendar date normalization)
	reqSlice := httptest.NewRequest(http.MethodGet, "/api/overview?granularity=hour&tz=Europe/Zurich&hour=3&dow=2", nil)
	recSlice := httptest.NewRecorder()
	mux.ServeHTTP(recSlice, reqSlice)
	if recSlice.Code != http.StatusOK || reader.lastParams.Hour == nil || *reader.lastParams.Hour != 3 || reader.lastParams.DOW == nil || *reader.lastParams.DOW != 2 {
		t.Fatalf("expected hour=3 dow=2, got code=%d params=%+v", recSlice.Code, reader.lastParams)
	}

	reqBadHour := httptest.NewRequest(http.MethodGet, "/api/overview?hour=25", nil)
	recBadHour := httptest.NewRecorder()
	mux.ServeHTTP(recBadHour, reqBadHour)
	if recBadHour.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 on invalid hour, got %d", recBadHour.Code)
	}

	reqPlayDim := httptest.NewRequest(http.MethodGet, "/api/play/overview?granularity=day&tz=Europe/Zurich&from=2026-11-09&to=2026-11-09&dim_type=app_version&dim_value=60", nil)
	recPlayDim := httptest.NewRecorder()
	mux.ServeHTTP(recPlayDim, reqPlayDim)
	if recPlayDim.Code != http.StatusOK || reader.lastPlayFilter.DimType != "app_version" || reader.lastPlayFilter.DimValue != "60" {
		t.Fatalf("unexpected play dim filter: code=%d filter=%+v", recPlayDim.Code, reader.lastPlayFilter)
	}
	if reader.lastPlayFrom.Format("2006-01-02") != "2026-11-09" || reader.lastPlayTo.Format("2006-01-02") != "2026-11-09" {
		t.Fatalf("expected calendar date 2026-11-09 preserved across Zurich TZ, got %s..%s", reader.lastPlayFrom, reader.lastPlayTo)
	}

	reqPlayTraffic := httptest.NewRequest(http.MethodGet, "/api/play/overview?granularity=day&tz=Europe/Zurich&dim_type=traffic_source&dim_value=Other", nil)
	recPlayTraffic := httptest.NewRecorder()
	mux.ServeHTTP(recPlayTraffic, reqPlayTraffic)
	if recPlayTraffic.Code != http.StatusOK || reader.lastPlayFilter.DimType != "traffic_source" || reader.lastPlayFilter.DimValue != "Other" {
		t.Fatalf("unexpected play traffic_source filter: code=%d filter=%+v", recPlayTraffic.Code, reader.lastPlayFilter)
	}

	reqBadPlayDim := httptest.NewRequest(http.MethodGet, "/api/play/overview?dim_type=bogus&dim_value=1", nil)
	recBadPlayDim := httptest.NewRecorder()
	mux.ServeHTTP(recBadPlayDim, reqBadPlayDim)
	if recBadPlayDim.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 on invalid dim_type, got %d", recBadPlayDim.Code)
	}

	// 8. Notifications endpoints
	reqNotifGet := httptest.NewRequest(http.MethodGet, "/api/notifications", nil)
	recNotifGet := httptest.NewRecorder()
	mux.ServeHTTP(recNotifGet, reqNotifGet)
	if recNotifGet.Code != http.StatusOK || !strings.Contains(recNotifGet.Body.String(), notify.DefaultGmailAddress) {
		t.Fatalf("unexpected GET /api/notifications response (%d): %s", recNotifGet.Code, recNotifGet.Body.String())
	}

	reqNotifUnauth := httptest.NewRequest(http.MethodPost, "/api/notifications/test", nil)
	recNotifUnauth := httptest.NewRecorder()
	mux.ServeHTTP(recNotifUnauth, reqNotifUnauth)
	if recNotifUnauth.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 on unauthenticated POST /api/notifications/test, got %d", recNotifUnauth.Code)
	}

	bodyUpd := bytes.NewBufferString(`{"enabled":true,"recipient_email":"test@example.com","crash_alerts_enabled":true,"crash_min_version_code":60,"include_anrs":true,"download_alerts_enabled":true,"min_download_delta":2}`)
	reqNotifUpd := httptest.NewRequest(http.MethodPut, "/api/notifications/settings", bodyUpd)
	reqNotifUpd.Header.Set("Authorization", "Bearer top-secret")
	recNotifUpd := httptest.NewRecorder()
	mux.ServeHTTP(recNotifUpd, reqNotifUpd)
	if recNotifUpd.Code != http.StatusOK || notifier.settings.RecipientEmail != "test@example.com" || notifier.settings.CrashMinVersionCode != 60 {
		t.Fatalf("unexpected PUT /api/notifications/settings (%d): %s", recNotifUpd.Code, recNotifUpd.Body.String())
	}

	reqNotifTest := httptest.NewRequest(http.MethodPost, "/api/notifications/test", nil)
	reqNotifTest.Header.Set("Authorization", "Bearer top-secret")
	recNotifTest := httptest.NewRecorder()
	mux.ServeHTTP(recNotifTest, reqNotifTest)
	if recNotifTest.Code != http.StatusOK || !notifier.testSent {
		t.Fatalf("expected 200 and testSent on POST /api/notifications/test (%d): %s", recNotifTest.Code, recNotifTest.Body.String())
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
