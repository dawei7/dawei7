package poller

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/dawei7/dawei7/apps/euler-stats/db"
	"github.com/dawei7/dawei7/apps/euler-stats/github"
)

type fakeFetcher struct {
	res github.FetchResult
	err error
}

func (f *fakeFetcher) FetchAllReleases(context.Context) (github.FetchResult, error) {
	return f.res, f.err
}

type fakeCatalog struct{}

func (f *fakeCatalog) Refresh(context.Context) (*github.Catalog, error) {
	return nil, nil
}

type memStore struct {
	runs       []db.PollRunInput
	assets     map[int64]int64
	snapshots  []db.SnapshotInsert
	lockBusy   bool
	firstPoll  *time.Time
	lastPoll   *time.Time
}

func newMemStore() *memStore {
	return &memStore{assets: make(map[int64]int64)}
}

func (m *memStore) TryAdvisoryLock(context.Context) (func(), bool, error) {
	if m.lockBusy {
		return nil, false, nil
	}
	return func() {}, true, nil
}

func (m *memStore) PollHistoryBounds(context.Context) (*time.Time, *time.Time, error) {
	return m.firstPoll, m.lastPoll, nil
}

func (m *memStore) PreviousAssetCounts(context.Context) (map[int64]int64, error) {
	cp := make(map[int64]int64, len(m.assets))
	for k, v := range m.assets {
		cp[k] = v
	}
	return cp, nil
}

func (m *memStore) RecordSuccessfulPoll(_ context.Context, run db.PollRunInput, assets []db.AssetUpsert, snapshots []db.SnapshotInsert) (int64, error) {
	m.runs = append(m.runs, run)
	t := run.PolledAt
	if m.firstPoll == nil {
		m.firstPoll = &t
	}
	m.lastPoll = &t
	for _, a := range assets {
		m.assets[a.AssetID] = a.LatestDownloadCount
	}
	m.snapshots = append(m.snapshots, snapshots...)
	return int64(len(m.runs)), nil
}

func (m *memStore) RecordFailedPoll(_ context.Context, run db.PollRunInput) error {
	m.runs = append(m.runs, run)
	return nil
}

func TestPollerBaselineThenHourlyDeltaAndNewAsset(t *testing.T) {
	now := time.Date(2026, 11, 16, 14, 0, 5, 0, time.UTC)
	fetcher := &fakeFetcher{
		res: github.FetchResult{
			Releases: []github.Release{{
				ID: 1, TagName: "curriculum", Name: "Curriculum",
				Assets: []github.Asset{
					{ID: 10, Name: "alg1_wb1-1413444f.mcbundle", DownloadCount: 100, CreatedAt: now.Add(-72 * time.Hour)},
					{ID: 11, Name: "alg1_wb2-852bc149.mcbundle", DownloadCount: 50, CreatedAt: now.Add(-72 * time.Hour)},
				},
			}},
		},
	}
	store := newMemStore()
	p := NewWithDeps(fetcher, &fakeCatalog{}, store, func() time.Time { return now })

	// 1. First poll -> baseline (delta = 0, total = 150)
	res1, err := p.PollOnce(context.Background())
	if err != nil {
		t.Fatalf("poll 1 failed: %v", err)
	}
	if !res1.IsBaseline || res1.TotalDownloads != 150 || res1.TotalDelta != 0 {
		t.Fatalf("unexpected baseline result: %+v", res1)
	}

	// 2. Next hour: asset 10 gained +5, asset 11 stayed 50, brand new asset 12 published with 3 downloads,
	//    and an old late-discovered asset 13 (created 10 days ago) appeared with 20 downloads (baseline!).
	now = now.Add(time.Hour)
	fetcher.res = github.FetchResult{
		Releases: []github.Release{{
			ID: 1, TagName: "curriculum", Name: "Curriculum",
			Assets: []github.Asset{
				{ID: 10, Name: "alg1_wb1-1413444f.mcbundle", DownloadCount: 105, CreatedAt: now.Add(-73 * time.Hour)},
				{ID: 11, Name: "alg1_wb2-852bc149.mcbundle", DownloadCount: 50, CreatedAt: now.Add(-73 * time.Hour)},
				{ID: 12, Name: "calc_wb6-deadbeef.mcbundle", DownloadCount: 3, CreatedAt: now.Add(-15 * time.Minute)},
				{ID: 13, Name: "old_missed-11112222.mcbundle", DownloadCount: 20, CreatedAt: now.Add(-240 * time.Hour)},
			},
		}},
	}
	res2, err := p.PollOnce(context.Background())
	if err != nil {
		t.Fatalf("poll 2 failed: %v", err)
	}
	if res2.IsBaseline {
		t.Fatalf("poll 2 must not be baseline")
	}
	if res2.TotalDownloads != 178 {
		t.Fatalf("expected total 178, got %d", res2.TotalDownloads)
	}
	if res2.TotalDelta != 8 { // 5 from asset 10 + 3 from newly created asset 12
		t.Fatalf("expected delta 8, got %d", res2.TotalDelta)
	}

	// 3. Clamp negative counter anomaly safely.
	now = now.Add(time.Hour)
	fetcher.res.Releases[0].Assets[0].DownloadCount = 99
	res3, err := p.PollOnce(context.Background())
	if err != nil {
		t.Fatalf("poll 3 failed: %v", err)
	}
	if res3.TotalDelta != 0 {
		t.Fatalf("expected clamped delta 0, got %d", res3.TotalDelta)
	}
}

func TestPollerRecordsFailure(t *testing.T) {
	now := time.Date(2026, 11, 16, 14, 0, 5, 0, time.UTC)
	fetcher := &fakeFetcher{err: errors.New("github 502")}
	store := newMemStore()
	p := NewWithDeps(fetcher, &fakeCatalog{}, store, func() time.Time { return now })

	if _, err := p.PollOnce(context.Background()); err == nil {
		t.Fatalf("expected error from PollOnce")
	}
	if len(store.runs) != 1 || store.runs[0].Status != "error" || store.runs[0].ErrorMessage != "github 502" {
		t.Fatalf("expected recorded failed poll run, got %+v", store.runs)
	}
}
