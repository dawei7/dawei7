export function RoadmapTab() {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[#8d6b32]/35 bg-[#fffcf6]/90 p-6 shadow-xs">
        <div className="text-xs uppercase tracking-widest text-[#8d6b32] font-semibold">
          Country Analytics Feasibility
        </div>
        <h2 className="mt-1 text-2xl font-medium text-[#1c1914]">
          Can we analyze download countries from GitHub Releases?
        </h2>
        <p className="mt-2 text-sm text-[#4a4338] leading-relaxed">
          <strong>Not directly from GitHub Releases.</strong> GitHub&apos;s REST and GraphQL APIs only
          expose a single cumulative <code className="rounded bg-[#e7e0d2] px-1.5 py-0.5 text-xs">download_count</code>{' '}
          integer per release asset. GitHub serves release downloads via its CDN and does not expose
          downloader IP addresses, HTTP access logs, referrers, or country breakdowns to repository
          owners.
        </p>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="rounded-xl border border-[#d5cdb8] bg-[#f7f3ea] p-4">
            <h3 className="text-base font-medium text-[#1e4636]">Signals Already Available Today</h3>
            <ul className="mt-2 space-y-1.5 text-xs text-[#4a4338] list-disc pl-4">
              <li>
                <strong>Language demand proxy:</strong> German (<code className="font-mono">DE</code>)
                vs English (<code className="font-mono">EN</code>) workbook and textbook downloads.
              </li>
              <li>
                <strong>Timezone activity curve:</strong> The 24-hour distribution chart reveals which
                parts of the day (and indirectly which regions) are most active.
              </li>
              <li>
                <strong>Form factor split:</strong> Tablet/Desktop vs Phone workbook downloads in the
                Professor Euler Curriculum.
              </li>
            </ul>
          </div>

          <div className="rounded-xl border border-[#d5cdb8] bg-[#f7f3ea] p-4">
            <h3 className="text-base font-medium text-[#1e4636]">
              Ways to Add Real Country Stats Later
            </h3>
            <ul className="mt-2 space-y-1.5 text-xs text-[#4a4338] list-disc pl-4">
              <li>
                <strong>Google Play Console:</strong> Import official Android install, active device,
                and uninstall metrics broken down by country directly from Play Console reports.
              </li>
              <li>
                <strong>Privacy-safe GeoIP redirector:</strong> Serve library downloads through a
                lightweight redirect on <code className="font-mono">euler.dawei7.com</code> that looks
                up country ISO code in memory (e.g. MaxMind GeoLite2) without storing IP addresses,
                then forwards to GitHub Releases.
              </li>
              <li>
                <strong>Desktop update checks:</strong> Aggregate country counts from{' '}
                <code className="font-mono">euler.dawei7.com/desktop/latest.json</code> requests.
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[#d5cdb8] bg-[#fffcf6]/85 p-6 shadow-xs">
        <div className="text-xs uppercase tracking-widest text-[#6e6558] font-semibold">
          Professor Euler Statistics Hub
        </div>
        <h2 className="mt-1 text-xl font-medium text-[#1c1914]">Planned Data Modules</h2>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="rounded-xl border border-[#1e4636]/30 bg-[#1e4636]/5 p-4">
            <div className="flex items-center justify-between">
              <strong className="text-sm text-[#1e4636]">1. GitHub Releases</strong>
              <span className="rounded-full bg-[#1e4636] text-[#faf7f1] px-2 py-0.5 text-[10px]">
                Live
              </span>
            </div>
            <p className="mt-2 text-[#4a4338] leading-relaxed">
              Hourly polling of curriculum workbooks, open textbooks, and the Calculate m6 model with
              1h, 6h, daily, weekly, and monthly granularities.
            </p>
          </div>

          <div className="rounded-xl border border-[#d5cdb8] bg-[#f7f3ea] p-4">
            <div className="flex items-center justify-between">
              <strong className="text-sm text-[#1c1914]">2. Google Play Console</strong>
              <span className="rounded-full bg-[#e7e0d2] text-[#4a4338] px-2 py-0.5 text-[10px]">
                Next
              </span>
            </div>
            <p className="mt-2 text-[#6e6558] leading-relaxed">
              Android installs, active devices, country breakdown, OS versions, and ratings synced via
              Google Cloud Storage Play reports or CSV import.
            </p>
          </div>

          <div className="rounded-xl border border-[#d5cdb8] bg-[#f7f3ea] p-4">
            <div className="flex items-center justify-between">
              <strong className="text-sm text-[#1c1914]">3. Windows &amp; Website</strong>
              <span className="rounded-full bg-[#e7e0d2] text-[#4a4338] px-2 py-0.5 text-[10px]">
                Planned
              </span>
            </div>
            <p className="mt-2 text-[#6e6558] leading-relaxed">
              Desktop installer downloads from <code className="font-mono">dawei7/dawei7</code>{' '}
              releases and privacy-respecting <code className="font-mono">euler.dawei7.com</code>{' '}
              traffic summaries.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
