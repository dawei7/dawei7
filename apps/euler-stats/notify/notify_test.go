package notify

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/dawei7/dawei7/apps/euler-stats/db"
	"github.com/dawei7/dawei7/apps/euler-stats/poller"
)

type sentMail struct {
	to, subject, textBody, htmlBody string
}

type fakeSender struct {
	configured bool
	mails      []sentMail
}

func (f *fakeSender) Send(_ context.Context, to, subject, textBody, htmlBody string) error {
	if !f.configured {
		return ErrNotConfigured
	}
	f.mails = append(f.mails, sentMail{to, subject, textBody, htmlBody})
	return nil
}

func (f *fakeSender) Status() SMTPStatus {
	return SMTPStatus{
		Configured:  f.configured,
		Host:        "smtp.gmail.com",
		Port:        "587",
		Username:    DefaultGmailAddress,
		From:        "Professor Euler Stats <ai.professor.euler@gmail.com>",
		DefaultDest: DefaultGmailAddress,
	}
}

type memNotifyStore struct {
	settings db.NotificationSettings
	states   map[string]int64
	signals  []db.CrashSignal
	tracks   []db.PlayTrackRow
	logs     []db.NotificationLogEntry
}

func newMemNotifyStore() *memNotifyStore {
	return &memNotifyStore{
		settings: db.NotificationSettings{
			Enabled:               true,
			RecipientEmail:        DefaultGmailAddress,
			CrashAlertsEnabled:    true,
			CrashSince:            time.Date(2026, 11, 16, 0, 0, 0, 0, time.UTC),
			DownloadAlertsEnabled: true,
			MinDownloadDelta:      1,
		},
		states: make(map[string]int64),
		tracks: []db.PlayTrackRow{{TrackName: "production", ReleaseName: "5.4.3", VersionCodes: "60"}},
	}
}

func (m *memNotifyStore) GetNotificationSettings(_ context.Context, _ string) (db.NotificationSettings, error) {
	return m.settings, nil
}
func (m *memNotifyStore) UpdateNotificationSettings(_ context.Context, upd db.NotificationSettingsUpdate) (db.NotificationSettings, error) {
	m.settings.Enabled = upd.Enabled
	m.settings.RecipientEmail = upd.RecipientEmail
	m.settings.CrashAlertsEnabled = upd.CrashAlertsEnabled
	m.settings.CrashMinVersionCode = upd.CrashMinVersionCode
	m.settings.IncludeANRs = upd.IncludeANRs
	m.settings.DownloadAlertsEnabled = upd.DownloadAlertsEnabled
	m.settings.MinDownloadDelta = upd.MinDownloadDelta
	return m.settings, nil
}
func (m *memNotifyStore) GetCrashAlertStates(context.Context) (map[string]int64, error) {
	return m.states, nil
}
func (m *memNotifyStore) UpsertCrashAlertStates(_ context.Context, updates map[string]int64) error {
	for k, v := range updates {
		m.states[k] = v
	}
	return nil
}
func (m *memNotifyStore) InsertNotificationLog(_ context.Context, entry db.NotificationLogEntry) (int64, error) {
	entry.ID = int64(len(m.logs) + 1)
	m.logs = append(m.logs, entry)
	return entry.ID, nil
}
func (m *memNotifyStore) GetNotificationLogs(context.Context, int) ([]db.NotificationLogEntry, error) {
	return m.logs, nil
}
func (m *memNotifyStore) GetRecentCrashSignals(context.Context, string, time.Time, bool, int64) ([]db.CrashSignal, []db.PlayTrackRow, error) {
	return m.signals, m.tracks, nil
}

func TestDownloadDeltaNotification(t *testing.T) {
	store := newMemNotifyStore()
	sender := &fakeSender{configured: true}
	svc := NewService(store, sender, "com.mathn.tablet", "https://euler-stats.dawei7.com")

	// Zero delta -> no email
	svc.CheckAndNotifyDownloads(context.Background(), poller.PollResult{
		PollRunID: 2, TotalDownloads: 509, TotalDelta: 0,
	})
	if len(sender.mails) != 0 {
		t.Fatalf("expected 0 mails on zero delta, got %d", len(sender.mails))
	}

	// Positive delta -> sends email with itemized delta
	svc.CheckAndNotifyDownloads(context.Background(), poller.PollResult{
		PollRunID:      3,
		PolledAt:       time.Date(2026, 11, 16, 15, 0, 5, 0, time.UTC),
		AssetsCount:    141,
		TotalDownloads: 513,
		TotalDelta:     4,
		ChangedAssets: []poller.AssetChange{{
			AssetID: 1, ReleaseTag: "curriculum", AssetName: "alg1-abc.mcbundle",
			DisplayTitle: "Algebra 1 · WB 1", Language: "en", Edition: "tablet",
			PrevCount: 10, CurrentCount: 14, Delta: 4,
		}},
	})
	if len(sender.mails) != 1 {
		t.Fatalf("expected 1 mail, got %d", len(sender.mails))
	}
	if sender.mails[0].to != DefaultGmailAddress || !strings.Contains(sender.mails[0].subject, "+4 asset download") {
		t.Fatalf("unexpected mail: %+v", sender.mails[0])
	}
	if !strings.Contains(sender.mails[0].textBody, "Algebra 1 · WB 1") || !strings.Contains(sender.mails[0].textBody, "+4 (10 -> 14)") {
		t.Fatalf("expected delta breakdown in body, got:\n%s", sender.mails[0].textBody)
	}
}

func TestCrashAlertDeduplicatesAcrossPolls(t *testing.T) {
	store := newMemNotifyStore()
	sender := &fakeSender{configured: true}
	svc := NewService(store, sender, "com.mathn.tablet", "https://euler-stats.dawei7.com")

	store.signals = []db.CrashSignal{{
		StateKey: "vitals:2026-11-16T15:00:00Z:CRASH:v60", Source: "vitals_hourly",
		Period: "HOURLY", BucketTime: time.Date(2026, 11, 16, 15, 0, 0, 0, time.UTC),
		TimeLabel: "2026-11-16 15:00 UTC", ReportType: "CRASH", VersionCode: 60,
		Count: 2, DistinctUsers: 1,
	}}

	// Poll 1: +2 crashes triggers email
	svc.CheckAndNotifyPlayCrashes(context.Background())
	if len(sender.mails) != 1 || !strings.Contains(sender.mails[0].subject, "+2 new") {
		t.Fatalf("expected +2 crash alert, got %+v", sender.mails)
	}

	// Poll 2 (unchanged count): no duplicate email
	svc.CheckAndNotifyPlayCrashes(context.Background())
	if len(sender.mails) != 1 {
		t.Fatalf("expected no duplicate crash alert, got %d mails", len(sender.mails))
	}

	// Poll 3 (count increased from 2 -> 5): +3 delta triggers second email
	store.signals[0].Count = 5
	svc.CheckAndNotifyPlayCrashes(context.Background())
	if len(sender.mails) != 2 || !strings.Contains(sender.mails[1].subject, "+3 new") {
		t.Fatalf("expected +3 crash delta alert, got %+v", sender.mails)
	}
}
