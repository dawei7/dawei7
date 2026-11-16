package play

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/dawei7/dawei7/apps/euler-stats/db"
)

const (
	DefaultReportingBaseURL = "https://playdeveloperreporting.googleapis.com"
	DefaultPublisherBaseURL = "https://androidpublisher.googleapis.com"
)

type apiDateTime struct {
	Year     int `json:"year"`
	Month    int `json:"month"`
	Day      int `json:"day"`
	Hours    int `json:"hours,omitempty"`
	Minutes  int `json:"minutes,omitempty"`
	Seconds  int `json:"seconds,omitempty"`
	TimeZone *struct {
		ID string `json:"id"`
	} `json:"timeZone,omitempty"`
}

func (dt apiDateTime) toTime() time.Time {
	loc := time.UTC
	if dt.TimeZone != nil && dt.TimeZone.ID != "" {
		if l, err := time.LoadLocation(dt.TimeZone.ID); err == nil {
			loc = l
		}
	}
	return time.Date(dt.Year, time.Month(dt.Month), dt.Day, dt.Hours, dt.Minutes, dt.Seconds, 0, loc).UTC()
}

func fromTime(t time.Time, includeHours bool, tzID string) apiDateTime {
	loc := time.UTC
	if tzID != "" {
		if l, err := time.LoadLocation(tzID); err == nil {
			loc = l
		}
	}
	lt := t.In(loc)
	dt := apiDateTime{
		Year:  lt.Year(),
		Month: int(lt.Month()),
		Day:   lt.Day(),
		TimeZone: &struct {
			ID string `json:"id"`
		}{ID: loc.String()},
	}
	if includeHours {
		dt.Hours = lt.Hour()
	}
	return dt
}

type metricSetSpec struct {
	name       string
	metrics    []string
	dimensions []string
}

var reportingSpecs = []metricSetSpec{
	{
		name:       "errorCountMetricSet",
		metrics:    []string{"errorReportCount", "distinctUsers"},
		dimensions: []string{"reportType"},
	},
	{
		name:       "errorCountMetricSet",
		metrics:    []string{"errorReportCount", "distinctUsers"},
		dimensions: []string{"reportType", "versionCode"},
	},
	{
		name:    "crashRateMetricSet",
		metrics: []string{"crashRate", "userPerceivedCrashRate", "distinctUsers"},
	},
	{
		name:    "anrRateMetricSet",
		metrics: []string{"anrRate", "userPerceivedAnrRate", "distinctUsers"},
	},
	{
		name:       "slowStartRateMetricSet",
		metrics:    []string{"slowStartRate", "distinctUsers"},
		dimensions: []string{"startType"},
	},
	{
		name:    "excessiveWakeupRateMetricSet",
		metrics: []string{"excessiveWakeupRate", "distinctUsers"},
	},
	{
		name:    "stuckBackgroundWakelockRateMetricSet",
		metrics: []string{"stuckBackgroundWakelockRate", "distinctUsers"},
	},
	{
		name:    "lmkRateMetricSet",
		metrics: []string{"lmkRate", "distinctUsers"},
	},
}

// FetchReportingVitals queries freshnessInfo and fetches recent HOURLY and DAILY vitals across all metric sets.
func (c *Client) FetchReportingVitals(ctx context.Context) ([]db.PlayVitalsRow, error) {
	var all []db.PlayVitalsRow
	base := strings.TrimRight(c.ReportingBaseURL, "/")

	for _, spec := range reportingSpecs {
		metaURL := fmt.Sprintf("%s/v1beta1/apps/%s/%s", base, c.PackageName, spec.name)
		metaData, status, err := c.doAuthed(ctx, http.MethodGet, metaURL, nil, "")
		if err != nil {
			return nil, fmt.Errorf("fetch %s metadata: %w", spec.name, err)
		}
		if status == http.StatusForbidden || status == http.StatusNotFound {
			continue
		}
		if status < 200 || status >= 300 {
			return nil, fmt.Errorf("fetch %s metadata HTTP %d: %s", spec.name, status, strings.TrimSpace(string(metaData)))
		}

		var meta struct {
			FreshnessInfo struct {
				Freshnesses []struct {
					AggregationPeriod string       `json:"aggregationPeriod"`
					LatestEndTime     *apiDateTime `json:"latestEndTime"`
				} `json:"freshnesses"`
			} `json:"freshnessInfo"`
		}
		if err := json.Unmarshal(metaData, &meta); err != nil {
			return nil, fmt.Errorf("decode %s metadata: %w", spec.name, err)
		}

		for _, fr := range meta.FreshnessInfo.Freshnesses {
			if fr.LatestEndTime == nil {
				continue
			}
			if fr.AggregationPeriod != "HOURLY" && fr.AggregationPeriod != "DAILY" {
				continue
			}
			endTime := fr.LatestEndTime.toTime()
			lookback := 60 * 24 * time.Hour
			if fr.AggregationPeriod == "HOURLY" {
				lookback = 10 * 24 * time.Hour
			}
			startTime := endTime.Add(-lookback)

			tzID := "UTC"
			if fr.LatestEndTime.TimeZone != nil && fr.LatestEndTime.TimeZone.ID != "" {
				tzID = fr.LatestEndTime.TimeZone.ID
			}
			includeHours := fr.AggregationPeriod == "HOURLY"

			rows, err := c.queryMetricSet(ctx, base, spec, fr.AggregationPeriod,
				fromTime(startTime, includeHours, tzID), *fr.LatestEndTime)
			if err != nil {
				log.Printf("play reporting query warning (%s %s): %v", spec.name, fr.AggregationPeriod, err)
				continue
			}
			all = append(all, rows...)
		}
	}

	return all, nil
}

func (c *Client) queryMetricSet(
	ctx context.Context,
	base string,
	spec metricSetSpec,
	period string,
	startDT, endDT apiDateTime,
) ([]db.PlayVitalsRow, error) {
	queryURL := fmt.Sprintf("%s/v1beta1/apps/%s/%s:query", base, c.PackageName, spec.name)
	var out []db.PlayVitalsRow
	pageToken := ""

	for {
		payload := map[string]any{
			"timelineSpec": map[string]any{
				"aggregationPeriod": period,
				"startTime":         startDT,
				"endTime":           endDT,
			},
			"metrics":  spec.metrics,
			"pageSize": 1000,
		}
		if len(spec.dimensions) > 0 {
			payload["dimensions"] = spec.dimensions
		}
		if pageToken != "" {
			payload["pageToken"] = pageToken
		}

		rawReq, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}

		data, status, err := c.doAuthed(ctx, http.MethodPost, queryURL, bytes.NewReader(rawReq), "application/json")
		if err != nil {
			return nil, err
		}
		if status < 200 || status >= 300 {
			return nil, fmt.Errorf("HTTP %d: %s", status, strings.TrimSpace(string(data)))
		}

		rows, nextToken, err := ParseReportingQueryResponse(c.PackageName, spec.name, data)
		if err != nil {
			return nil, err
		}
		out = append(out, rows...)
		if nextToken == "" {
			break
		}
		pageToken = nextToken
	}

	return out, nil
}

// ParseReportingQueryResponse parses the JSON body of a Play Reporting :query response.
func ParseReportingQueryResponse(packageName, metricSet string, data []byte) ([]db.PlayVitalsRow, string, error) {
	var resp struct {
		Rows []struct {
			AggregationPeriod string       `json:"aggregationPeriod"`
			StartTime         *apiDateTime `json:"startTime"`
			Dimensions        []struct {
				Dimension   string `json:"dimension"`
				StringValue string `json:"stringValue"`
				Int64Value  string `json:"int64Value"`
			} `json:"dimensions"`
			Metrics []struct {
				Metric       string `json:"metric"`
				DecimalValue *struct {
					Value string `json:"value"`
				} `json:"decimalValue"`
			} `json:"metrics"`
		} `json:"rows"`
		NextPageToken string `json:"nextPageToken"`
	}
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, "", fmt.Errorf("decode reporting response: %w", err)
	}

	out := make([]db.PlayVitalsRow, 0, len(resp.Rows))
	for _, r := range resp.Rows {
		if r.StartTime == nil {
			continue
		}
		dimKey := ""
		dimVal := ""
		if len(r.Dimensions) > 0 {
			keys := make([]string, 0, len(r.Dimensions))
			vals := make([]string, 0, len(r.Dimensions))
			for _, d := range r.Dimensions {
				keys = append(keys, d.Dimension)
				val := d.StringValue
				if val == "" {
					val = d.Int64Value
				}
				vals = append(vals, val)
			}
			dimKey = strings.Join(keys, ",")
			dimVal = strings.Join(vals, ",")
		}

		metricsMap := make(map[string]float64, len(r.Metrics))
		for _, m := range r.Metrics {
			if m.DecimalValue != nil && m.DecimalValue.Value != "" {
				metricsMap[m.Metric] = parseFloat64(m.DecimalValue.Value)
			}
		}
		metricsJSON, err := json.Marshal(metricsMap)
		if err != nil {
			return nil, "", err
		}

		out = append(out, db.PlayVitalsRow{
			PackageName:       packageName,
			MetricSet:         metricSet,
			AggregationPeriod: r.AggregationPeriod,
			BucketStart:       r.StartTime.toTime(),
			DimensionKey:      dimKey,
			DimensionValue:    dimVal,
			MetricsJSON:       metricsJSON,
		})
	}
	return out, resp.NextPageToken, nil
}

// FetchPlayTracks queries Android Publisher API (read-only temporary edit) for active track releases.
func (c *Client) FetchPlayTracks(ctx context.Context) ([]db.PlayTrackRow, error) {
	base := strings.TrimRight(c.PublisherBaseURL, "/")
	editURL := fmt.Sprintf("%s/androidpublisher/v3/applications/%s/edits", base, c.PackageName)

	data, status, err := c.doAuthed(ctx, http.MethodPost, editURL, strings.NewReader("{}"), "application/json")
	if err != nil {
		return nil, fmt.Errorf("create publisher edit: %w", err)
	}
	if status < 200 || status >= 300 {
		return nil, fmt.Errorf("create publisher edit HTTP %d: %s", status, strings.TrimSpace(string(data)))
	}
	var ed struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(data, &ed); err != nil || ed.ID == "" {
		return nil, fmt.Errorf("invalid edit response: %s", string(data))
	}

	defer func() {
		delCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		delURL := fmt.Sprintf("%s/%s", editURL, ed.ID)
		_, _, _ = c.doAuthed(delCtx, http.MethodDelete, delURL, nil, "")
	}()

	tracksURL := fmt.Sprintf("%s/%s/tracks", editURL, ed.ID)
	tData, tStatus, err := c.doAuthed(ctx, http.MethodGet, tracksURL, nil, "")
	if err != nil {
		return nil, fmt.Errorf("list tracks: %w", err)
	}
	if tStatus < 200 || tStatus >= 300 {
		return nil, fmt.Errorf("list tracks HTTP %d: %s", tStatus, strings.TrimSpace(string(tData)))
	}

	var resp struct {
		Tracks []struct {
			Track    string `json:"track"`
			Releases []struct {
				Name         string   `json:"name"`
				Status       string   `json:"status"`
				VersionCodes []string `json:"versionCodes"`
				ReleaseNotes []struct {
					Language string `json:"language"`
					Text     string `json:"text"`
				} `json:"releaseNotes"`
			} `json:"releases"`
		} `json:"tracks"`
	}
	if err := json.Unmarshal(tData, &resp); err != nil {
		return nil, fmt.Errorf("decode tracks: %w", err)
	}

	now := time.Now().UTC()
	var out []db.PlayTrackRow
	for _, tr := range resp.Tracks {
		if len(tr.Releases) == 0 {
			continue
		}
		rel := tr.Releases[0]
		notes := ""
		for _, rn := range rel.ReleaseNotes {
			if rn.Language == "en-US" {
				notes = rn.Text
				break
			}
			if notes == "" {
				notes = rn.Text
			}
		}
		out = append(out, db.PlayTrackRow{
			PackageName:  c.PackageName,
			TrackName:    tr.Track,
			ReleaseName:  rel.Name,
			Status:       rel.Status,
			VersionCodes: strings.Join(rel.VersionCodes, ", "),
			ReleaseNotes: notes,
			UpdatedAt:    now,
		})
	}
	return out, nil
}
