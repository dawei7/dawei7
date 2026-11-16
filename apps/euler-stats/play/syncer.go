package play

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/dawei7/dawei7/apps/euler-stats/db"
)

// PlayFetcher abstracts Google Play GCS, Reporting, and Publisher APIs.
type PlayFetcher interface {
	ListBucketObjects(ctx context.Context) ([]GCSObject, error)
	DownloadObject(ctx context.Context, objectName string) ([]byte, error)
	FetchReportingVitals(ctx context.Context) ([]db.PlayVitalsRow, error)
	FetchPlayTracks(ctx context.Context) ([]db.PlayTrackRow, error)
}

// SyncStore abstracts Postgres operations needed by the Play Store syncer.
type SyncStore interface {
	TryPlayAdvisoryLock(ctx context.Context) (unlock func(), acquired bool, err error)
	PlayLastSuccessfulPoll(ctx context.Context) (*time.Time, error)
	GetPlaySyncedFiles(ctx context.Context) (map[string]db.PlaySyncFile, error)
	SavePlaySync(ctx context.Context, run db.PlayPollRunInput, batch db.PlaySyncBatch) (int64, error)
	RecordPlayPollRun(ctx context.Context, run db.PlayPollRunInput) error
}

// Syncer polls Google Play Store reports and hourly vitals without duplicating rows.
type Syncer struct {
	fetcher     PlayFetcher
	store       SyncStore
	packageName string
	nowFn       func() time.Time
	mu          sync.Mutex
	staleAge    time.Duration
}

// NewSyncer creates a Syncer using the provided Play client and Postgres store.
func NewSyncer(fetcher PlayFetcher, store SyncStore, packageName string) *Syncer {
	return &Syncer{
		fetcher:     fetcher,
		store:       store,
		packageName: packageName,
		nowFn:       func() time.Time { return time.Now().UTC() },
		staleAge:    55 * time.Minute,
	}
}

// SyncResult summarizes one Play Store sync execution.
type SyncResult struct {
	PollRunID            int64 `json:"poll_run_id"`
	GCSObjectsSeen       int   `json:"gcs_objects_seen"`
	GCSObjectsDownloaded int   `json:"gcs_objects_downloaded"`
	GCSRowsUpserted      int   `json:"gcs_rows_upserted"`
	VitalsRowsUpserted   int   `json:"vitals_rows_upserted"`
	ReviewsUpserted      int   `json:"reviews_upserted"`
	DurationMs           int   `json:"duration_ms"`
}

// SyncOnce fetches only changed GCS Play reports plus latest Reporting API vitals and tracks,
// upserting everything idempotently so hourly runs never create duplicate rows.
func (s *Syncer) SyncOnce(ctx context.Context) (SyncResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	unlock, acquired, err := s.store.TryPlayAdvisoryLock(ctx)
	if err != nil {
		return SyncResult{}, fmt.Errorf("acquire play advisory lock: %w", err)
	}
	if !acquired {
		return SyncResult{}, fmt.Errorf("another Play Store sync is already in progress")
	}
	defer unlock()

	started := s.nowFn()

	objects, err := s.fetcher.ListBucketObjects(ctx)
	if err != nil {
		s.recordError(ctx, started, err)
		return SyncResult{}, err
	}

	prevFiles, err := s.store.GetPlaySyncedFiles(ctx)
	if err != nil {
		s.recordError(ctx, started, err)
		return SyncResult{}, fmt.Errorf("load play_sync_files: %w", err)
	}

	var batch db.PlaySyncBatch
	var downloaded, gcsRows int

	for _, obj := range objects {
		if !isSupportedReportObject(obj.Name, s.packageName) {
			continue
		}
		if prev, ok := prevFiles[obj.Name]; ok &&
			prev.ETag == obj.ETag &&
			prev.MD5Hash == obj.MD5Hash &&
			prev.Generation == obj.GenerationInt() {
			continue
		}

		raw, err := s.fetcher.DownloadObject(ctx, obj.Name)
		if err != nil {
			s.recordError(ctx, started, err)
			return SyncResult{}, err
		}
		parsed, err := ParseGCSCSV(obj.Name, s.packageName, raw)
		if err != nil {
			s.recordError(ctx, started, err)
			return SyncResult{}, err
		}

		downloaded++
		rowsCount := parsed.TotalRows()
		gcsRows += rowsCount

		batch.Installs = append(batch.Installs, parsed.Installs...)
		batch.StorePerformance = append(batch.StorePerformance, parsed.StorePerformance...)
		batch.Ratings = append(batch.Ratings, parsed.Ratings...)
		batch.Crashes = append(batch.Crashes, parsed.Crashes...)
		batch.Reviews = append(batch.Reviews, parsed.Reviews...)

		var updPtr *time.Time
		if !obj.Updated.IsZero() {
			t := obj.Updated.UTC()
			updPtr = &t
		}
		batch.Files = append(batch.Files, db.PlaySyncFile{
			ObjectName:      obj.Name,
			ETag:            obj.ETag,
			MD5Hash:         obj.MD5Hash,
			Generation:      obj.GenerationInt(),
			SizeBytes:       obj.SizeInt(),
			ObjectUpdatedAt: updPtr,
			SyncedAt:        started,
			RowsUpserted:    rowsCount,
		})
	}

	vitals, err := s.fetcher.FetchReportingVitals(ctx)
	if err != nil {
		log.Printf("play reporting vitals warning: %v", err)
	} else {
		batch.Vitals = vitals
	}

	tracks, err := s.fetcher.FetchPlayTracks(ctx)
	if err != nil {
		log.Printf("play publisher tracks warning: %v", err)
	} else {
		batch.Tracks = tracks
	}

	durMs := int(s.nowFn().Sub(started).Milliseconds())
	run := db.PlayPollRunInput{
		PolledAt:             started,
		DurationMs:           durMs,
		Status:               "ok",
		GCSObjectsSeen:       len(objects),
		GCSObjectsDownloaded: downloaded,
		GCSRowsUpserted:      gcsRows,
		VitalsRowsUpserted:   len(batch.Vitals),
		ReviewsUpserted:      len(batch.Reviews),
	}

	runID, err := s.store.SavePlaySync(ctx, run, batch)
	if err != nil {
		return SyncResult{}, err
	}

	return SyncResult{
		PollRunID:            runID,
		GCSObjectsSeen:       len(objects),
		GCSObjectsDownloaded: downloaded,
		GCSRowsUpserted:      gcsRows,
		VitalsRowsUpserted:   len(batch.Vitals),
		ReviewsUpserted:      len(batch.Reviews),
		DurationMs:           durMs,
	}, nil
}

func (s *Syncer) recordError(ctx context.Context, started time.Time, err error) {
	durMs := int(s.nowFn().Sub(started).Milliseconds())
	_ = s.store.RecordPlayPollRun(ctx, db.PlayPollRunInput{
		PolledAt:     started,
		DurationMs:   durMs,
		Status:       "error",
		ErrorMessage: err.Error(),
	})
}

func isSupportedReportObject(name, pkg string) bool {
	if !strings.HasSuffix(name, ".csv") {
		return false
	}
	if pkg != "" && !strings.Contains(name, pkg) {
		return false
	}
	return strings.HasPrefix(name, "stats/installs/") ||
		strings.HasPrefix(name, "stats/store_performance/") ||
		strings.HasPrefix(name, "stats/ratings/") ||
		strings.HasPrefix(name, "stats/crashes/") ||
		strings.HasPrefix(name, "reviews/")
}

// RunScheduler runs an immediate catch-up sync if stale, then polls hourly at :01:05 UTC.
func (s *Syncer) RunScheduler(ctx context.Context) {
	last, err := s.store.PlayLastSuccessfulPoll(ctx)
	if err != nil {
		log.Printf("play scheduler poll check error: %v", err)
	}
	if last == nil || s.nowFn().Sub(*last) >= s.staleAge {
		s.runAndLog(ctx, "play-startup")
	} else {
		log.Printf("skipping play startup sync (last successful sync at %s)", last.Format(time.RFC3339))
	}

	for {
		next := db.NextPlayTopOfHour(s.nowFn())
		wait := time.Until(next)
		if wait < time.Second {
			wait = time.Second
		}
		log.Printf("next Google Play sync scheduled for %s (in %s)", next.Format(time.RFC3339), wait.Round(time.Second))

		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
			if !s.runAndLog(ctx, "play-hourly") {
				retry := time.NewTimer(5 * time.Minute)
				select {
				case <-ctx.Done():
					retry.Stop()
					return
				case <-retry.C:
					s.runAndLog(ctx, "play-retry")
				}
			}
		}
	}
}

func (s *Syncer) runAndLog(ctx context.Context, trigger string) bool {
	syncCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()

	res, err := s.SyncOnce(syncCtx)
	if err != nil {
		log.Printf("[%s] play sync error: %v", trigger, err)
		return false
	}
	log.Printf("[%s] play sync #%d ok: gcs_seen=%d downloaded=%d gcs_rows=%d vitals=%d reviews=%d (%dms)",
		trigger, res.PollRunID, res.GCSObjectsSeen, res.GCSObjectsDownloaded, res.GCSRowsUpserted, res.VitalsRowsUpserted, res.ReviewsUpserted, res.DurationMs)
	return true
}
