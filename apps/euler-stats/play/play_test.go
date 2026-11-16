package play

import (
	"bytes"
	"context"
	"encoding/binary"
	"testing"
	"time"
	"unicode/utf16"

	"github.com/dawei7/dawei7/apps/euler-stats/db"
)

func encodeUTF16LEBOM(s string) []byte {
	var buf bytes.Buffer
	buf.Write([]byte{0xFF, 0xFE})
	for _, u := range utf16.Encode([]rune(s)) {
		_ = binary.Write(&buf, binary.LittleEndian, u)
	}
	return buf.Bytes()
}

func TestParseGCSCSVsUTF16AndReviewsDedupeKey(t *testing.T) {
	installCSV := encodeUTF16LEBOM("Date,Package name,Country,Daily Device Installs,Daily Device Uninstalls,Daily Device Upgrades,Total User Installs,Daily User Installs,Daily User Uninstalls,Active Device Installs,Install events,Update events,Uninstall events\r\n" +
		"2026-11-01,com.mathn.tablet,CH,4,1,0,0,4,1,12,4,2,1\r\n")

	rep, err := ParseGCSCSV("stats/installs/installs_com.mathn.tablet_202611_country.csv", "com.mathn.tablet", installCSV)
	if err != nil {
		t.Fatalf("parse installs CSV: %v", err)
	}
	if len(rep.Installs) != 1 || rep.Installs[0].DimensionType != "country" || rep.Installs[0].DimensionValue != "CH" || rep.Installs[0].DailyDeviceInstalls != 4 || rep.Installs[0].ActiveDeviceInstalls != 12 {
		t.Fatalf("unexpected parsed install row: %+v", rep.Installs)
	}

	storeCSV := encodeUTF16LEBOM("Date,Package name,Traffic source,Search term,UTM source,UTM campaign,Store listing acquisitions,Store listing visitors,Store listing conversion rate\r\n" +
		"2026-11-01,com.mathn.tablet,Search,euler,utm_s,utm_c,12,25,0.48\r\n")
	spRep, err := ParseGCSCSV("stats/store_performance/store_performance_com.mathn.tablet_202611_traffic_source.csv", "com.mathn.tablet", storeCSV)
	if err != nil {
		t.Fatalf("parse store perf CSV: %v", err)
	}
	if len(spRep.StorePerformance) != 1 || spRep.StorePerformance[0].Visitors != 25 || spRep.StorePerformance[0].Acquisitions != 12 || spRep.StorePerformance[0].SearchTerm != "euler" {
		t.Fatalf("unexpected store perf row: %+v", spRep.StorePerformance)
	}

	revCSV := encodeUTF16LEBOM("Package Name,App Version Code,App Version Name,Reviewer Language,Device,Review Submit Date and Time,Review Submit Millis Since Epoch,Review Last Update Date and Time,Review Last Update Millis Since Epoch,Star Rating,Review Title,Review Text,Developer Reply Date and Time,Developer Reply Millis Since Epoch,Developer Reply Text,Review Link\r\n" +
		"com.mathn.tablet,42,5.0.0,en,a26x,2026-11-08T15:52:12Z,1794153132441,2026-11-08T15:52:12Z,1794153132441,5,,,,,,\r\n")
	revRep1, err := ParseGCSCSV("reviews/reviews_com.mathn.tablet_202611.csv", "com.mathn.tablet", revCSV)
	revRep2, _ := ParseGCSCSV("reviews/reviews_com.mathn.tablet_202611.csv", "com.mathn.tablet", revCSV)
	if err != nil || len(revRep1.Reviews) != 1 {
		t.Fatalf("parse review CSV: err=%v len=%d", err, len(revRep1.Reviews))
	}
	if revRep1.Reviews[0].ReviewKey == "" || revRep1.Reviews[0].ReviewKey != revRep2.Reviews[0].ReviewKey {
		t.Fatalf("expected deterministic review_key across parses: %s vs %s", revRep1.Reviews[0].ReviewKey, revRep2.Reviews[0].ReviewKey)
	}
}

func TestParseReportingQueryResponse(t *testing.T) {
	raw := []byte(`{
		"rows": [{
			"aggregationPeriod": "HOURLY",
			"startTime": {"year": 2026, "month": 11, "day": 9, "hours": 11, "timeZone": {"id": "UTC"}},
			"dimensions": [{"dimension": "reportType", "stringValue": "CRASH"}],
			"metrics": [
				{"metric": "errorReportCount", "decimalValue": {"value": "5"}},
				{"metric": "distinctUsers", "decimalValue": {"value": "1"}}
			]
		}]
	}`)
	rows, next, err := ParseReportingQueryResponse("com.mathn.tablet", "errorCountMetricSet", raw)
	if err != nil || next != "" || len(rows) != 1 {
		t.Fatalf("unexpected parse result: rows=%d next=%q err=%v", len(rows), next, err)
	}
	wantTime := time.Date(2026, 11, 9, 11, 0, 0, 0, time.UTC)
	if !rows[0].BucketStart.Equal(wantTime) || rows[0].DimensionValue != "CRASH" {
		t.Fatalf("unexpected vitals row: %+v", rows[0])
	}
}

type fakePlayFetcher struct {
	objects   []GCSObject
	downloads int
}

func (f *fakePlayFetcher) ListBucketObjects(context.Context) ([]GCSObject, error) {
	return f.objects, nil
}

func (f *fakePlayFetcher) DownloadObject(context.Context, string) ([]byte, error) {
	f.downloads++
	return encodeUTF16LEBOM("Date,Package name,Daily Device Installs,Daily Device Uninstalls,Daily Device Upgrades,Total User Installs,Daily User Installs,Daily User Uninstalls,Active Device Installs,Install events,Update events,Uninstall events\r\n2026-11-01,com.mathn.tablet,3,0,0,0,3,0,10,3,0,0\r\n"), nil
}

func (f *fakePlayFetcher) FetchReportingVitals(context.Context) ([]db.PlayVitalsRow, error) {
	return []db.PlayVitalsRow{{
		PackageName: "com.mathn.tablet", MetricSet: "errorCountMetricSet", AggregationPeriod: "HOURLY",
		BucketStart: time.Date(2026, 11, 16, 11, 0, 0, 0, time.UTC), DimensionKey: "reportType", DimensionValue: "CRASH",
		MetricsJSON: []byte(`{"errorReportCount":0,"distinctUsers":1}`),
	}}, nil
}

func (f *fakePlayFetcher) FetchPlayTracks(context.Context) ([]db.PlayTrackRow, error) {
	return []db.PlayTrackRow{{PackageName: "com.mathn.tablet", TrackName: "production", ReleaseName: "5.4.3"}}, nil
}

type memPlayStore struct {
	files map[string]db.PlaySyncFile
	runs  []db.PlayPollRunInput
}

func (m *memPlayStore) TryPlayAdvisoryLock(context.Context) (func(), bool, error) {
	return func() {}, true, nil
}
func (m *memPlayStore) PlayLastSuccessfulPoll(context.Context) (*time.Time, error) { return nil, nil }
func (m *memPlayStore) GetPlaySyncedFiles(context.Context) (map[string]db.PlaySyncFile, error) {
	return m.files, nil
}
func (m *memPlayStore) SavePlaySync(_ context.Context, run db.PlayPollRunInput, b db.PlaySyncBatch) (int64, error) {
	m.runs = append(m.runs, run)
	for _, f := range b.Files {
		m.files[f.ObjectName] = f
	}
	return int64(len(m.runs)), nil
}
func (m *memPlayStore) RecordPlayPollRun(_ context.Context, run db.PlayPollRunInput) error {
	m.runs = append(m.runs, run)
	return nil
}

func TestSyncerSkipsUnchangedGCSFilesOnHourlyRePoll(t *testing.T) {
	now := time.Date(2026, 11, 16, 14, 1, 5, 0, time.UTC)
	fetcher := &fakePlayFetcher{
		objects: []GCSObject{{
			Name: "stats/installs/installs_com.mathn.tablet_202611_overview.csv",
			ETag: "etag-1", MD5Hash: "abc", Generation: "100", Size: "300", Updated: now,
		}},
	}
	store := &memPlayStore{files: make(map[string]db.PlaySyncFile)}
	s := NewSyncer(fetcher, store, "com.mathn.tablet")

	// Poll 1: downloads the file.
	r1, err := s.SyncOnce(context.Background())
	if err != nil || r1.GCSObjectsDownloaded != 1 || r1.GCSRowsUpserted != 1 {
		t.Fatalf("unexpected poll 1 result: %+v err=%v", r1, err)
	}

	// Poll 2 (next hour, unchanged ETag): downloads 0 GCS files!
	r2, err := s.SyncOnce(context.Background())
	if err != nil || r2.GCSObjectsDownloaded != 0 || fetcher.downloads != 1 {
		t.Fatalf("expected unchanged GCS file to be skipped on poll 2: %+v downloads=%d err=%v", r2, fetcher.downloads, err)
	}

	// Poll 3 (ETag changed): re-downloads cleanly!
	fetcher.objects[0].ETag = "etag-2"
	fetcher.objects[0].Generation = "101"
	r3, err := s.SyncOnce(context.Background())
	if err != nil || r3.GCSObjectsDownloaded != 1 || fetcher.downloads != 2 {
		t.Fatalf("expected changed GCS file to be re-downloaded on poll 3: %+v downloads=%d err=%v", r3, fetcher.downloads, err)
	}
}
