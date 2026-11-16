package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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

func (f *fakeAnalyticsReader) GetAssets(_ context.Context, p db.QueryParams, _, _ string) ([]db.AssetRow, error) {
	f.lastParams = p
	return []db.AssetRow{{
		AssetID:          1,
		ReleaseTag:       "curriculum",
		AssetName:        "alg1_wb1-1413444f.mcbundle",
		DisplayTitle:     "Algebra 1 · WB 1",
		AllTimeDownloads: 7,
		WindowDelta:      2,
	}}, nil
}

func (f *fakeAnalyticsReader) GetPollRuns(context.Context, int) ([]db.PollRunRow, error) {
	return []db.PollRunRow{{ID: 1, Status: "ok"}}, nil
}

type fakePollRunner struct{ called bool }

func (f *fakePollRunner) PollOnce(context.Context) (poller.PollResult, error) {
	f.called = true
	return poller.PollResult{PollRunID: 42, TotalDownloads: 509}, nil
}

func TestHandlersValidationCSVAndAdminAuth(t *testing.T) {
	reader := &fakeAnalyticsReader{}
	runner := &fakePollRunner{}
	mux := newMux(reader, runner, "top-secret")

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
}
