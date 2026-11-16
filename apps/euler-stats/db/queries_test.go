package db

import (
	"testing"
	"time"
)

func TestBuildBucketSpineHourlyAndDaily(t *testing.T) {
	zurich, err := time.LoadLocation("Europe/Zurich")
	if err != nil {
		t.Fatalf("load tz: %v", err)
	}

	from := time.Date(2026, 11, 16, 10, 15, 0, 0, time.UTC)
	to := time.Date(2026, 11, 16, 14, 45, 0, 0, time.UTC)
	hourly := BuildBucketSpine(from, to, GranularityHour, zurich)
	if len(hourly) != 5 {
		t.Fatalf("expected 5 hourly buckets, got %d", len(hourly))
	}
	if hourly[0].Unix() != time.Date(2026, 11, 16, 10, 0, 0, 0, time.UTC).Unix() {
		t.Fatalf("unexpected first hourly bucket: %v", hourly[0])
	}

	// Daily across 3 days in Europe/Zurich
	dFrom := time.Date(2026, 11, 14, 12, 0, 0, 0, zurich)
	dTo := time.Date(2026, 11, 16, 12, 0, 0, 0, zurich)
	daily := BuildBucketSpine(dFrom, dTo, GranularityDay, zurich)
	if len(daily) != 3 {
		t.Fatalf("expected 3 daily buckets, got %d", len(daily))
	}
	if FormatBucketLabel(daily[0], GranularityDay, zurich) != "Nov 14" {
		t.Fatalf("unexpected daily label: %s", FormatBucketLabel(daily[0], GranularityDay, zurich))
	}
}

func TestBuildBucketSpine6HourAndWeekAndMonth(t *testing.T) {
	from := time.Date(2026, 10, 25, 1, 0, 0, 0, time.UTC)
	to := time.Date(2026, 11, 16, 20, 0, 0, 0, time.UTC)

	weekly := BuildBucketSpine(from, to, GranularityWeek, time.UTC)
	if len(weekly) != 5 {
		t.Fatalf("expected 5 ISO week buckets (Oct 19, Oct 26, Nov 2, Nov 9, Nov 16), got %d", len(weekly))
	}
	if weekly[0].Weekday() != time.Monday {
		t.Fatalf("expected Monday start for week bucket, got %v", weekly[0].Weekday())
	}

	monthly := BuildBucketSpine(from, to, GranularityMonth, time.UTC)
	if len(monthly) != 2 {
		t.Fatalf("expected 2 monthly buckets, got %d", len(monthly))
	}

	sixH := BuildBucketSpine(
		time.Date(2026, 11, 16, 0, 10, 0, 0, time.UTC),
		time.Date(2026, 11, 16, 23, 50, 0, 0, time.UTC),
		Granularity6Hour,
		time.UTC,
	)
	if len(sixH) != 4 {
		t.Fatalf("expected 4 6-hour buckets in 1 day, got %d", len(sixH))
	}
}

func TestNextTopOfHour(t *testing.T) {
	now := time.Date(2026, 11, 16, 14, 23, 40, 0, time.UTC)
	next := NextTopOfHour(now)
	want := time.Date(2026, 11, 16, 15, 0, 5, 0, time.UTC)
	if !next.Equal(want) {
		t.Fatalf("expected %v, got %v", want, next)
	}
}

func TestParseGranularityAndGroupBy(t *testing.T) {
	if g, ok := ParseGranularity("1h"); !ok || g != GranularityHour {
		t.Fatalf("expected hour, got %v %v", g, ok)
	}
	if _, ok := ParseGranularity("bad"); ok {
		t.Fatalf("expected invalid granularity to fail")
	}
	if gb, ok := ParseGroupBy("language"); !ok || gb != GroupByLanguage {
		t.Fatalf("expected language, got %v %v", gb, ok)
	}
	if _, ok := ParseGroupBy("country"); ok {
		t.Fatalf("expected unsupported group_by to fail")
	}
	if m, ok := ParseAssetMode(""); !ok || m != AssetModeItems {
		t.Fatalf("expected default AssetModeItems, got %v %v", m, ok)
	}
	if m, ok := ParseAssetMode("files"); !ok || m != AssetModeFiles {
		t.Fatalf("expected AssetModeFiles, got %v %v", m, ok)
	}
	if _, ok := ParseAssetMode("invalid"); ok {
		t.Fatalf("expected invalid asset mode to fail")
	}
}
