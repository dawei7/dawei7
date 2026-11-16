package poller

import (
	"context"
	"fmt"
	"log"
	"sort"
	"sync"
	"time"

	"github.com/dawei7/dawei7/apps/euler-stats/db"
	"github.com/dawei7/dawei7/apps/euler-stats/github"
)

// ReleaseFetcher fetches GitHub releases and refreshes catalog enrichment.
type ReleaseFetcher interface {
	FetchAllReleases(ctx context.Context) (github.FetchResult, error)
}

// CatalogRefresher resolves catalog metadata for assets.
type CatalogRefresher interface {
	Refresh(ctx context.Context) (*github.Catalog, error)
}

// Store abstracts persistence operations required by the hourly poller.
type Store interface {
	TryAdvisoryLock(ctx context.Context) (unlock func(), acquired bool, err error)
	PollHistoryBounds(ctx context.Context) (firstPolledAt *time.Time, lastPolledAt *time.Time, err error)
	PreviousAssetCounts(ctx context.Context) (map[int64]int64, error)
	RecordSuccessfulPoll(ctx context.Context, run db.PollRunInput, assets []db.AssetUpsert, snapshots []db.SnapshotInsert) (int64, error)
	RecordFailedPoll(ctx context.Context, run db.PollRunInput) error
}

// Poller fetches GitHub Releases hourly and writes snapshot deltas to Postgres.
type Poller struct {
	fetcher       ReleaseFetcher
	catalog       CatalogRefresher
	store         Store
	nowFn         func() time.Time
	mu            sync.Mutex
	staleAge      time.Duration
	onPollSuccess func(context.Context, PollResult)
}

type clientCatalogAdapter struct {
	client *github.Client
	cache  *github.CatalogCache
}

func (a *clientCatalogAdapter) Refresh(ctx context.Context) (*github.Catalog, error) {
	return a.cache.Refresh(ctx, a.client)
}

// New creates a Poller backed by the GitHub REST client and catalog cache.
func New(client *github.Client, store Store) *Poller {
	return &Poller{
		fetcher:  client,
		catalog:  &clientCatalogAdapter{client: client, cache: github.NewCatalogCache()},
		store:    store,
		nowFn:    func() time.Time { return time.Now().UTC() },
		staleAge: 55 * time.Minute,
	}
}

// SetOnPollSuccess registers a hook invoked after every successful GitHub poll.
func (p *Poller) SetOnPollSuccess(fn func(context.Context, PollResult)) {
	p.onPollSuccess = fn
}

// NewWithDeps creates a Poller with custom dependencies (for testing).
func NewWithDeps(fetcher ReleaseFetcher, catalog CatalogRefresher, store Store, nowFn func() time.Time) *Poller {
	return &Poller{
		fetcher:  fetcher,
		catalog:  catalog,
		store:    store,
		nowFn:    nowFn,
		staleAge: 55 * time.Minute,
	}
}

// AssetChange describes one asset whose download count increased in this poll.
type AssetChange struct {
	AssetID      int64  `json:"asset_id"`
	ReleaseTag   string `json:"release_tag"`
	AssetName    string `json:"asset_name"`
	ItemKey      string `json:"item_key"`
	DisplayTitle string `json:"display_title"`
	Language     string `json:"language"`
	Edition      string `json:"edition"`
	PrevCount    int64  `json:"prev_count"`
	CurrentCount int64  `json:"current_count"`
	Delta        int64  `json:"delta"`
}

// PollResult summarizes a single poll execution.
type PollResult struct {
	PollRunID      int64         `json:"poll_run_id"`
	PolledAt       time.Time     `json:"polled_at"`
	ReleasesCount  int           `json:"releases_count"`
	AssetsCount    int           `json:"assets_count"`
	TotalDownloads int64         `json:"total_downloads"`
	TotalDelta     int64         `json:"total_delta"`
	IsBaseline     bool          `json:"is_baseline"`
	DurationMs     int           `json:"duration_ms"`
	ChangedAssets  []AssetChange `json:"changed_assets,omitempty"`
}

// PollOnce executes one fetch-enrich-diff-persist cycle.
func (p *Poller) PollOnce(ctx context.Context) (PollResult, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	unlock, acquired, err := p.store.TryAdvisoryLock(ctx)
	if err != nil {
		return PollResult{}, fmt.Errorf("acquire advisory lock: %w", err)
	}
	if !acquired {
		return PollResult{}, fmt.Errorf("another poll is already in progress")
	}
	defer unlock()

	started := p.nowFn()
	res, err := p.fetcher.FetchAllReleases(ctx)
	if err != nil {
		durMs := int(p.nowFn().Sub(started).Milliseconds())
		_ = p.store.RecordFailedPoll(ctx, db.PollRunInput{
			PolledAt:           started,
			DurationMs:         durMs,
			Status:             "error",
			ErrorMessage:       err.Error(),
			RateLimitRemaining: res.RateLimit.Remaining,
			RateLimitResetAt:   res.RateLimit.ResetAt,
		})
		return PollResult{}, err
	}

	var catalog *github.Catalog
	if p.catalog != nil {
		var catErr error
		catalog, catErr = p.catalog.Refresh(ctx)
		if catErr != nil {
			log.Printf("catalog refresh warning (using cached/fallback metadata): %v", catErr)
		}
	}

	firstPolledAt, _, err := p.store.PollHistoryBounds(ctx)
	if err != nil {
		return PollResult{}, fmt.Errorf("load poll history bounds: %w", err)
	}
	prevCounts, err := p.store.PreviousAssetCounts(ctx)
	if err != nil {
		return PollResult{}, fmt.Errorf("load previous asset counts: %w", err)
	}

	isInitialBaseline := firstPolledAt == nil
	var assets []db.AssetUpsert
	var snapshots []db.SnapshotInsert
	var changedAssets []AssetChange
	var totalDownloads int64
	var totalDelta int64
	seenAssetIDs := make(map[int64]struct{})

	for _, rel := range res.Releases {
		for _, a := range rel.Assets {
			if _, dup := seenAssetIDs[a.ID]; dup {
				continue
			}
			seenAssetIDs[a.ID] = struct{}{}

			itemKey, meta := catalog.Resolve(rel.TagName, a.Name)
			var createdPtr, updatedPtr *time.Time
			if !a.CreatedAt.IsZero() {
				t := a.CreatedAt.UTC()
				createdPtr = &t
			}
			if !a.UpdatedAt.IsZero() {
				t := a.UpdatedAt.UTC()
				updatedPtr = &t
			}

			delta, snapBaseline := computeAssetDelta(
				a.DownloadCount,
				a.CreatedAt,
				a.ID,
				prevCounts,
				isInitialBaseline,
				firstPolledAt,
			)
			if !snapBaseline && delta > 0 {
				changedAssets = append(changedAssets, AssetChange{
					AssetID:      a.ID,
					ReleaseTag:   rel.TagName,
					AssetName:    a.Name,
					ItemKey:      itemKey,
					DisplayTitle: meta.DisplayTitle,
					Language:     meta.Language,
					Edition:      meta.Edition,
					PrevCount:    prevCounts[a.ID],
					CurrentCount: a.DownloadCount,
					Delta:        delta,
				})
			}

			assets = append(assets, db.AssetUpsert{
				AssetID:             a.ID,
				ReleaseID:           rel.ID,
				ReleaseTag:          rel.TagName,
				ReleaseName:         rel.Name,
				AssetName:           a.Name,
				ItemKey:             itemKey,
				DisplayTitle:        meta.DisplayTitle,
				Category:            meta.Category,
				Subject:             meta.Subject,
				Language:            meta.Language,
				Edition:             meta.Edition,
				Author:              meta.Author,
				License:             meta.License,
				Pages:               meta.Pages,
				Exercises:           meta.Exercises,
				IncludedInApp:       meta.IncludedInApp,
				SizeBytes:           a.Size,
				DownloadURL:         a.BrowserDownloadURL,
				AssetCreatedAt:      createdPtr,
				AssetUpdatedAt:      updatedPtr,
				SeenAt:              started,
				LatestDownloadCount: a.DownloadCount,
			})

			snapshots = append(snapshots, db.SnapshotInsert{
				AssetID:        a.ID,
				ReleaseTag:     rel.TagName,
				DownloadCount:  a.DownloadCount,
				DeltaDownloads: delta,
				IsBaseline:     snapBaseline,
				SizeBytes:      a.Size,
			})

			totalDownloads += a.DownloadCount
			totalDelta += delta
		}
	}

	sort.Slice(changedAssets, func(i, j int) bool {
		if changedAssets[i].Delta != changedAssets[j].Delta {
			return changedAssets[i].Delta > changedAssets[j].Delta
		}
		return changedAssets[i].DisplayTitle < changedAssets[j].DisplayTitle
	})

	durMs := int(p.nowFn().Sub(started).Milliseconds())
	runInput := db.PollRunInput{
		PolledAt:           started,
		DurationMs:         durMs,
		Status:             "ok",
		ReleasesCount:      len(res.Releases),
		AssetsCount:        len(assets),
		TotalDownloads:     totalDownloads,
		TotalDelta:         totalDelta,
		IsBaseline:         isInitialBaseline,
		RateLimitRemaining: res.RateLimit.Remaining,
		RateLimitResetAt:   res.RateLimit.ResetAt,
	}

	runID, err := p.store.RecordSuccessfulPoll(ctx, runInput, assets, snapshots)
	if err != nil {
		return PollResult{}, err
	}

	out := PollResult{
		PollRunID:      runID,
		PolledAt:       started,
		ReleasesCount:  len(res.Releases),
		AssetsCount:    len(assets),
		TotalDownloads: totalDownloads,
		TotalDelta:     totalDelta,
		IsBaseline:     isInitialBaseline,
		DurationMs:     durMs,
		ChangedAssets:  changedAssets,
	}
	if p.onPollSuccess != nil {
		p.onPollSuccess(ctx, out)
	}
	return out, nil
}

func computeAssetDelta(
	currentCount int64,
	createdAt time.Time,
	assetID int64,
	prevCounts map[int64]int64,
	isInitialBaseline bool,
	firstPolledAt *time.Time,
) (delta int64, isBaseline bool) {
	if isInitialBaseline {
		return 0, true
	}
	if prev, ok := prevCounts[assetID]; ok {
		if currentCount <= prev {
			return 0, false
		}
		return currentCount - prev, false
	}
	// Newly seen asset after tracking began: if it existed well before tracking started,
	// avoid injecting its historical downloads as a fake current-hour spike.
	if firstPolledAt != nil && !createdAt.IsZero() && createdAt.Before(firstPolledAt.Add(-2*time.Hour)) {
		return 0, true
	}
	if currentCount < 0 {
		return 0, false
	}
	return currentCount, false
}

// RunScheduler runs an initial catch-up poll if stale, then polls once per hour aligned to :00:05 UTC.
func (p *Poller) RunScheduler(ctx context.Context) {
	_, lastPolledAt, err := p.store.PollHistoryBounds(ctx)
	if err != nil {
		log.Printf("scheduler poll bounds check error: %v", err)
	}
	if lastPolledAt == nil || p.nowFn().Sub(*lastPolledAt) >= p.staleAge {
		p.runAndLog(ctx, "startup")
	} else {
		log.Printf("skipping startup poll (last successful poll at %s)", lastPolledAt.Format(time.RFC3339))
	}

	for {
		next := db.NextTopOfHour(p.nowFn())
		wait := time.Until(next)
		if wait < time.Second {
			wait = time.Second
		}
		log.Printf("next GitHub releases poll scheduled for %s (in %s)", next.Format(time.RFC3339), wait.Round(time.Second))

		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
			if !p.runAndLog(ctx, "hourly") {
				// Retry once after 5 minutes on transient failure.
				retryTimer := time.NewTimer(5 * time.Minute)
				select {
				case <-ctx.Done():
					retryTimer.Stop()
					return
				case <-retryTimer.C:
					p.runAndLog(ctx, "hourly-retry")
				}
			}
		}
	}
}

func (p *Poller) runAndLog(ctx context.Context, trigger string) bool {
	pollCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	res, err := p.PollOnce(pollCtx)
	if err != nil {
		log.Printf("[%s] poll error: %v", trigger, err)
		return false
	}
	log.Printf("[%s] poll #%d ok: releases=%d assets=%d total=%d delta=%d baseline=%v (%dms)",
		trigger, res.PollRunID, res.ReleasesCount, res.AssetsCount, res.TotalDownloads, res.TotalDelta, res.IsBaseline, res.DurationMs)
	return true
}
