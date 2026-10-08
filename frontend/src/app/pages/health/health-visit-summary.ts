import {HealthSample, HealthSeries} from '../../models/fasten/health-sample';
import {
  asPercent,
  asleepHours,
  CatalogEntry,
  displayUnit,
  formatStoneFromDecimal,
  kgToWeightUnit,
  LOINC_BP_DIA,
  LOINC_BP_SYS,
  MetricDef,
  SLEEP_STAGE_LABELS,
  SLEEP_STAGE_ORDER,
  WeightUnit,
  weightUnitLabel,
} from './health-metrics';
import {bandChartSvg, barChartSvg, lineChartSvg, sleepChartSvg, sparklineSvg} from './health-visit-summary-charts';
import type {RangePreset} from './health.component';

const RANGE_MS: Record<Exclude<RangePreset, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '5d': 5 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

const READING_IDS = new Set(['blood_pressure', 'body_mass', 'body_temperature', 'oxygen_saturation']);

export const SUMMARY_RANGE_DEFAULT: RangePreset = '30d';
export const SAMPLE_PAGE_LIMIT = 5000;

export type SummaryKind = 'band' | 'line' | 'bar' | 'sleep' | 'readings' | 'table';
export type SummarySeriesMode = 'daily-stats' | 'day' | 'stages';

export interface VisitSummaryPatient {
  name?: string
  birthDate?: string
}

export interface VisitSummaryWindow {
  start: Date | null
  end: Date
  label: string
  startAfter?: string
  startBefore?: string
}

export interface GlanceRow {
  id: string
  label: string
  unit: string
  latest: string
  periodAvg: string
  sparkSvg: string
  sampling: string
}

export interface VisitSummaryStat {
  key: string
  value: string
  extra?: string
}

export interface VisitSummaryReading {
  cells: string[]
}

export interface VisitSummarySection {
  id: string
  label: string
  spec: string
  latestLabel: string
  stats: VisitSummaryStat[]
  sampleCount: number
  quality: string
  empty?: boolean
  error?: boolean
  chartSvg?: string
  readingHeaders?: string[]
  readings?: VisitSummaryReading[]
}

export interface VisitSummaryProvenance {
  devices: string
  deviceNote: string
  daysRecorded: number
  daysInWindow: number
  gapLabel?: string
  lastSyncedLabel: string
  lastSyncedNote: string
}

export interface VisitSummaryModel {
  generatedAt: Date
  windowLabel: string
  patient?: VisitSummaryPatient
  patientAge?: number
  provenance: VisitSummaryProvenance
  glance: GlanceRow[]
  sections: VisitSummarySection[]
  csvFilename: string
}

export interface VisitSummaryInput {
  generatedAt: Date
  window: VisitSummaryWindow
  lastSyncedAt?: string | null
  patient?: VisitSummaryPatient
  selected: CatalogEntry[]
  seriesById: Record<string, HealthSeries | null>
  samples: HealthSample[]
  weightUnit: WeightUnit
  csvFilename: string
}

export function summaryKind(def: MetricDef): SummaryKind {
  if (def.id === 'heart_rate') return 'band';
  if (READING_IDS.has(def.id)) return 'readings';
  if (def.viz === 'bar-daily') return 'bar';
  if (def.viz === 'sleep-stages') return 'sleep';
  if (def.viz === 'table') return 'table';
  return 'line';
}

export function summarySeriesMode(def: MetricDef): SummarySeriesMode | null {
  const kind = summaryKind(def);
  if (kind === 'band' || kind === 'line') return 'daily-stats';
  if (kind === 'bar') return 'day';
  if (kind === 'sleep') return 'stages';
  return null;
}

export function seriesQueryFor(entry: CatalogEntry): {codes?: string[], vendorType?: string, mode: SummarySeriesMode} | null {
  const mode = summarySeriesMode(entry.def);
  if (!mode) return null;
  return {
    codes: entry.def.codes.length ? entry.def.codes : undefined,
    vendorType: entry.def.vendorType,
    mode,
  };
}

export function visitSummaryBasename(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `yourphr-health-${y}${m}${day}`;
}

export function visitSummaryFilename(date: Date): string {
  return `${visitSummaryBasename(date)}.html`;
}

export function visitSummaryCsvFilename(date: Date): string {
  return `${visitSummaryBasename(date)}.csv`;
}

export function defaultSummarySelection(entries: CatalogEntry[]): Record<string, boolean> {
  const selected: Record<string, boolean> = {};
  for (const entry of entries) selected[entry.id] = true;
  return selected;
}

export function hasSummarySelection(selected: Record<string, boolean>): boolean {
  return Object.values(selected).some(Boolean);
}

export function visitSummaryWindow(range: RangePreset, now: Date): VisitSummaryWindow {
  if (range === 'all') {
    return {start: null, end: now, label: 'All time'};
  }
  const start = new Date(now.getTime() - RANGE_MS[range]);
  return {
    start,
    end: now,
    label: `${formatWindowDay(start)} – ${formatWindowDay(new Date(now.getTime() - 1))}`,
    startAfter: start.toISOString(),
    startBefore: now.toISOString(),
  };
}

export function emptySeries(): HealthSeries {
  return {total: 0, downsampled: false, points: []};
}

export function convertDisplayValue(value: number, def: MetricDef, weightUnit: WeightUnit): number {
  if (def.id === 'body_mass') return kgToWeightUnit(value, weightUnit);
  if (def.id === 'oxygen_saturation') return asPercent(value);
  return value;
}

export function convertSeriesStats(
  stats: HealthSeries['stats'],
  def: MetricDef,
  weightUnit: WeightUnit,
): {min?: number, max?: number, avg?: number} | null {
  if (!stats) return null;
  if (def.id !== 'body_mass' && def.id !== 'oxygen_saturation') return stats;
  return {
    min: stats.min != null ? convertDisplayValue(stats.min, def, weightUnit) : undefined,
    max: stats.max != null ? convertDisplayValue(stats.max, def, weightUnit) : undefined,
    avg: stats.avg != null ? convertDisplayValue(stats.avg, def, weightUnit) : undefined,
  };
}

export function sampleQueriesFor(entries: CatalogEntry[]): {codes?: string[], vendorType?: string}[] {
  const codes = [...new Set(entries.flatMap((entry) => entry.def.codes))];
  const queries: {codes?: string[], vendorType?: string}[] = [];
  if (codes.length) queries.push({codes});
  for (const entry of entries) {
    if (entry.def.vendorType && !entry.def.codes.length) {
      queries.push({vendorType: entry.def.vendorType});
    }
  }
  return queries;
}

export function utcDaysInWindow(start: Date | null, end: Date, fallbackStart?: string): string[] {
  let from: Date | null = start;
  if (!from && fallbackStart) from = new Date(`${fallbackStart}T00:00:00Z`);
  if (!from) return [];
  return utcDateStrings(from, end);
}

export function namedGaps(missing: string[]): string | undefined {
  if (!missing.length) return undefined;
  const runs: {start: string, end: string, n: number}[] = [];
  let runStart = missing[0];
  let prev = missing[0];
  for (let i = 1; i <= missing.length; i++) {
    const cur = missing[i];
    if (cur && cur === nextUtcDay(prev)) {
      prev = cur;
      continue;
    }
    runs.push({start: runStart, end: prev, n: utcDaySpan(runStart, prev)});
    if (cur) {
      runStart = cur;
      prev = cur;
    }
  }
  const longest = [...runs].sort((a, b) => b.n - a.n)[0];
  const label = (run: {start: string, end: string, n: number}): string => {
    if (run.n === 1) return formatShortDay(run.start);
    return `${run.n}-day gap ${formatShortDay(run.start)}–${formatShortDay(run.end)}`;
  };
  if (runs.length === 1) return label(longest);
  return `gaps totaling ${missing.length} days (longest ${label(longest)})`;
}

export function assembleVisitSummary(input: VisitSummaryInput): VisitSummaryModel {
  const recorded = collectRecordedDates(input.selected, input.seriesById, input.samples);
  const fallback = recorded.length ? recorded.reduce((a, b) => (a < b ? a : b)) : undefined;
  const days = utcDaysInWindow(input.window.start, input.window.end, fallback);
  const recordedInWindow = days.filter((day) => recorded.includes(day));
  const missing = days.filter((day) => !recorded.includes(day));
  const devices = uniqueDevices(input.selected, input.samples);
  const glance: GlanceRow[] = [];
  const sections: VisitSummarySection[] = [];
  for (const entry of input.selected) {
    const built = buildMetric(entry, days, input.seriesById[entry.id], samplesFor(entry, input.samples), input.weightUnit);
    glance.push(built.glance);
    sections.push(built.section);
  }
  return {
    generatedAt: input.generatedAt,
    windowLabel: input.window.label,
    patient: input.patient,
    patientAge: input.patient?.birthDate ? ageAt(input.patient.birthDate, input.generatedAt) : undefined,
    provenance: {
      devices: devices.length ? devices.join(', ') : 'not recorded',
      deviceNote: 'consumer-grade',
      daysRecorded: recordedInWindow.length,
      daysInWindow: days.length,
      gapLabel: namedGaps(missing),
      lastSyncedLabel: input.lastSyncedAt
        ? new Date(input.lastSyncedAt).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'})
        : 'not recorded',
      lastSyncedNote: input.lastSyncedAt
        ? syncRecency(new Date(input.lastSyncedAt), input.generatedAt)
        : 'companion has not synced',
    },
    glance,
    sections,
    csvFilename: input.csvFilename,
  };
}

export function buildVisitSummaryHtml(model: VisitSummaryModel): string {
  const generated = model.generatedAt.toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'});
  const patientBits: string[] = [];
  if (model.patient?.birthDate) {
    const age = model.patientAge != null ? ` · ${model.patientAge} y` : '';
    patientBits.push(`Born <b>${escapeHtml(model.patient.birthDate)}</b>${age}`);
  }
  const patientName = model.patient?.name
    ? `<h1>${escapeHtml(model.patient.name)}</h1>`
    : '<h1>Health summary</h1>';
  const coverage = model.provenance.daysInWindow
    ? `${model.provenance.daysRecorded} of ${model.provenance.daysInWindow} days`
    : `${model.provenance.daysRecorded} days`;
  const gap = model.provenance.gapLabel
    ? `<br><span class="q">${escapeHtml(model.provenance.gapLabel)}</span>`
    : '';

  const glanceRows = model.glance.map((row) => {
    const spark = row.sparkSvg || '';
    return `<tr>
        <td class="name-cell"><span class="metric-name">${escapeHtml(row.label)}${row.unit ? ` <span class="unit">${escapeHtml(row.unit)}</span>` : ''}</span></td>
        <td class="num val">${escapeHtml(row.latest)}</td>
        <td class="num">${escapeHtml(row.periodAvg)}</td>
        <td>${spark}</td>
        <td class="conf">${escapeHtml(row.sampling)}</td>
      </tr>`;
  }).join('\n      ');

  const sections = model.sections.map((section) => renderSectionHtml(section)).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Health summary</title>
<style>
  :root{
    --paper:#ffffff;
    --ink:#1b2127;
    --muted:#616b76;
    --faint:#8b95a0;
    --rule:#dce2e8;
    --rule-strong:#c3ccd4;
    --data:#2f6f8f;
    --data-fill:rgba(47,111,143,.10);
  }
  *{box-sizing:border-box;}
  html{-webkit-text-size-adjust:100%;}
  body{
    margin:0;
    background:#f0f2f4;
    color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
    font-size:15px;
    line-height:1.5;
    font-feature-settings:"tnum" 1, "lnum" 1;
  }
  .sheet{
    max-width:860px;
    margin:28px auto;
    background:var(--paper);
    padding:44px 52px 40px;
  }
  .masthead{
    display:flex;
    justify-content:space-between;
    align-items:flex-start;
    gap:32px;
    border-bottom:2px solid var(--ink);
    padding-bottom:16px;
  }
  .patient h1{
    font-family:Georgia,"Times New Roman",serif;
    font-weight:600;
    font-size:26px;
    line-height:1.15;
    margin:0 0 4px;
  }
  .patient .sub{color:var(--muted);font-size:14px;}
  .patient .sub b{color:var(--ink);font-weight:500;}
  .doc-kind{
    text-align:right;
    font-size:13px;
    color:var(--muted);
    line-height:1.55;
    min-width:200px;
  }
  .doc-kind .title{
    font-family:Georgia,"Times New Roman",serif;
    color:var(--ink);
    font-size:15px;
    font-weight:600;
    display:block;
    margin-bottom:3px;
  }
  .provenance{
    display:grid;
    grid-template-columns:repeat(4,1fr);
    gap:1px;
    background:var(--rule);
    border:1px solid var(--rule);
    margin-top:18px;
  }
  .provenance div{background:var(--paper);padding:9px 12px;}
  .provenance dt{color:var(--faint);font-size:11.5px;letter-spacing:.02em;margin-bottom:2px;}
  .provenance dd{margin:0;font-size:13.5px;font-weight:500;}
  .provenance dd .q{font-weight:400;color:var(--muted);font-size:12.5px;}
  h2{
    font-family:Georgia,"Times New Roman",serif;
    font-size:16px;
    font-weight:600;
    margin:36px 0 2px;
  }
  .section-note{color:var(--muted);font-size:13px;margin:0 0 14px;}
  table.glance{width:100%;border-collapse:collapse;font-size:14px;}
  table.glance th{
    text-align:left;font-weight:500;color:var(--faint);font-size:12px;
    padding:0 10px 7px 0;border-bottom:1px solid var(--rule-strong);white-space:nowrap;
  }
  table.glance th.num,table.glance td.num{text-align:right;padding-right:16px;}
  table.glance td{padding:11px 10px 11px 0;border-bottom:1px solid var(--rule);vertical-align:middle;}
  table.glance tr:last-child td{border-bottom:none;}
  .metric-name{font-weight:500;}
  .metric-name .unit{color:var(--faint);font-weight:400;font-size:12.5px;}
  .val{font-weight:600;font-size:15px;white-space:nowrap;}
  .spark{display:block;}
  .conf{font-size:12.5px;color:var(--muted);white-space:nowrap;}
  .metric-block{padding:22px 0 20px;border-bottom:1px solid var(--rule);}
  .metric-block:last-of-type{border-bottom:none;}
  .metric-head{display:flex;justify-content:space-between;align-items:baseline;gap:20px;margin-bottom:4px;}
  .metric-head h3{font-size:15px;font-weight:600;margin:0;}
  .metric-head h3 .spec{color:var(--faint);font-weight:400;font-size:12.5px;margin-left:6px;}
  .metric-latest{font-size:14px;color:var(--muted);white-space:nowrap;}
  .metric-latest b{color:var(--ink);font-weight:600;font-size:16px;}
  .chartwrap{margin:12px 0 10px;}
  .chartwrap svg{display:block;width:100%;height:auto;}
  .statrow{display:flex;flex-wrap:wrap;gap:0;border:1px solid var(--rule);border-radius:2px;overflow:hidden;}
  .statrow .stat{flex:1 1 0;min-width:88px;padding:8px 12px;border-right:1px solid var(--rule);}
  .statrow .stat:last-child{border-right:none;}
  .statrow .stat .k{color:var(--faint);font-size:11.5px;margin-bottom:1px;}
  .statrow .stat .v{font-weight:600;font-size:15px;}
  .statrow .stat .v small{font-weight:400;color:var(--muted);font-size:12px;}
  .quality{margin-top:9px;font-size:12.5px;color:var(--muted);padding-left:14px;position:relative;}
  .quality::before{content:"";position:absolute;left:0;top:6px;width:7px;height:7px;border-radius:50%;background:var(--data);}
  .quality b{color:var(--ink);font-weight:500;}
  table.readings{width:100%;border-collapse:collapse;font-size:13.5px;margin-top:10px;}
  table.readings th{
    text-align:left;font-weight:500;color:var(--faint);font-size:11.5px;
    padding:0 12px 6px 0;border-bottom:1px solid var(--rule-strong);
  }
  table.readings th.num,table.readings td.num{text-align:right;padding-right:20px;}
  table.readings td{padding:7px 12px 7px 0;border-bottom:1px solid var(--rule);}
  table.readings tr:last-child td{border-bottom:none;}
  table.readings td.num{font-weight:500;}
  .note{color:var(--muted);font-style:italic;}
  .raw{
    margin-top:14px;border:1px solid var(--rule);border-radius:2px;
    padding:14px 16px;background:#fafbfc;font-size:13.5px;
  }
  .raw b{font-weight:600;}
  .raw .files{color:var(--muted);margin-top:4px;}
  .raw .files span{color:var(--ink);font-weight:500;}
  footer{
    margin-top:34px;padding-top:16px;border-top:1px solid var(--rule);
    color:var(--muted);font-size:12px;line-height:1.6;
  }
  footer b{color:var(--ink);font-weight:600;}
  @media (max-width:680px){
    .sheet{padding:28px 20px;margin:0;}
    .masthead{flex-direction:column;gap:14px;}
    .doc-kind{text-align:left;}
    .provenance{grid-template-columns:1fr 1fr;}
    .statrow .stat{flex-basis:33%;}
  }
  @media print{
    body{background:#fff;}
    .sheet{box-shadow:none;margin:0;max-width:none;padding:0;}
    .metric-block,table.glance tr,.raw{page-break-inside:avoid;}
    h2{page-break-after:avoid;}
  }
</style>
</head>
<body>
<div class="sheet">
  <header class="masthead">
    <div class="patient">
      ${patientName}
      ${patientBits.length ? `<div class="sub">${patientBits.join(' · ')}</div>` : ''}
    </div>
    <div class="doc-kind">
      <span class="title">Health summary</span>
      Patient-generated data<br>
      Reviewed period ${escapeHtml(model.windowLabel)}<br>
      Generated ${escapeHtml(generated)}
    </div>
  </header>
  <dl class="provenance">
    <div>
      <dt>Source</dt>
      <dd>Wearable devices<br><span class="q">export via YourPHR</span></dd>
    </div>
    <div>
      <dt>Recording devices</dt>
      <dd>${escapeHtml(model.provenance.devices)}<br><span class="q">${escapeHtml(model.provenance.deviceNote)}</span></dd>
    </div>
    <div>
      <dt>Coverage in period</dt>
      <dd>${escapeHtml(coverage)}${gap}</dd>
    </div>
    <div>
      <dt>Device last synced</dt>
      <dd>${escapeHtml(model.provenance.lastSyncedLabel)}<br><span class="q">${escapeHtml(model.provenance.lastSyncedNote)}</span></dd>
    </div>
  </dl>
  <h2>At a glance</h2>
  <p class="section-note">Everything captured this period. Sampling describes how often a measure was recorded, not whether a value is typical.</p>
  <table class="glance">
    <thead>
      <tr>
        <th>Measure</th>
        <th class="num">Latest</th>
        <th class="num">Period avg</th>
        <th>Trend</th>
        <th>Sampling</th>
      </tr>
    </thead>
    <tbody>
      ${glanceRows}
    </tbody>
  </table>
  <h2>Detail</h2>
  <p class="section-note">Daily values across the period. Sparse measures are shown as individual readings because each one carries meaning and there are few of them.</p>
  ${sections}
  <h2>Full data</h2>
  <div class="raw">
    <b>Every reading is available as a separate file</b> — not printed here to keep this summary scannable.
    <div class="files">
      Downloaded with this summary: <span>${escapeHtml(model.csvFilename)}</span> (all samples, timestamped)
    </div>
  </div>
  <footer>
    <b>About this data.</b> These readings were recorded by the patient's own consumer devices during daily life, not by clinical equipment. They can support a conversation or flag a trend to look into, but they don't replace an in-clinic measurement. Accuracy varies by device and by how consistently it was worn or used.<br><br>
    <b>Handling.</b> This file contains health information and is not password protected. Store it as you would a paper copy of a medical record.
  </footer>
</div>
</body>
</html>
`;
}

export function triggerBlobDownload(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], {type: mime});
  const fileURL = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = fileURL;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(fileURL);
}

export function triggerHtmlDownload(html: string, filename: string): void {
  triggerBlobDownload(html, filename, 'text/html;charset=utf-8');
}

export function triggerDownloads(files: {content: string, filename: string, mime: string}[]): void {
  if (!files.length) return;
  triggerBlobDownload(files[0].content, files[0].filename, files[0].mime);
  files.slice(1).forEach((file, index) => {
    window.setTimeout(() => triggerBlobDownload(file.content, file.filename, file.mime), (index + 1) * 300);
  });
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderSectionHtml(section: VisitSummarySection): string {
  const title = escapeHtml(section.label);
  const spec = section.spec ? ` <span class="spec">${escapeHtml(section.spec)}</span>` : '';
  if (section.error) {
    return `<div class="metric-block"><div class="metric-head"><h3>${title}${spec}</h3></div><p class="note">This metric could not be loaded.</p></div>`;
  }
  if (section.empty) {
    return `<div class="metric-block"><div class="metric-head"><h3>${title}${spec}</h3></div><p class="note">No samples in this time range.</p></div>`;
  }
  const latest = section.latestLabel
    ? `<div class="metric-latest">${section.latestLabel}</div>`
    : '';
  const stats = section.stats.length
    ? `<div class="statrow">${section.stats.map((stat) =>
      `<div class="stat"><div class="k">${escapeHtml(stat.key)}</div><div class="v">${escapeHtml(stat.value)}${stat.extra ? ` <small>${escapeHtml(stat.extra)}</small>` : ''}</div></div>`).join('')}</div>`
    : '';
  let body = '';
  if (section.readings?.length && section.readingHeaders) {
    const head = section.readingHeaders.map((h, i) =>
      `<th${i > 0 ? ' class="num"' : ''}>${escapeHtml(h)}</th>`).join('');
    const rows = section.readings.map((row) =>
      `<tr>${row.cells.map((cell, i) => `<td${i > 0 ? ' class="num"' : ''}>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
    body = `<table class="readings"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  } else if (section.chartSvg) {
    body = `<div class="chartwrap">${section.chartSvg}</div>`;
  }
  const quality = section.quality
    ? `<p class="quality">${section.quality}</p>`
    : '';
  return `<div class="metric-block"><div class="metric-head"><h3>${title}${spec}</h3>${latest}</div>${body}${stats}${quality}</div>`;
}

function buildMetric(
  entry: CatalogEntry,
  days: string[],
  series: HealthSeries | null | undefined,
  samples: HealthSample[],
  weightUnit: WeightUnit,
): {glance: GlanceRow, section: VisitSummarySection} {
  const kind = summaryKind(entry.def);
  const unit = displayUnit(entry.def, series?.unit || samples[0]?.unit, weightUnit);
  if (kind === 'readings') return buildReadings(entry, days, samples, unit, weightUnit);
  if (kind === 'table') return buildFallbackTable(entry, samples, unit);
  if (series === null) return failedMetric(entry, unit);
  const data = series || emptySeries();
  if (kind === 'sleep') return buildSleep(entry, days, data, unit);
  if (kind === 'bar') return buildBar(entry, days, data, unit);
  if (kind === 'band') return buildBand(entry, days, data, unit);
  return buildLine(entry, days, data, unit, weightUnit);
}

function failedMetric(entry: CatalogEntry, unit: string): {glance: GlanceRow, section: VisitSummarySection} {
  return {
    glance: {
      id: entry.id,
      label: entry.def.label,
      unit,
      latest: '—',
      periodAvg: '—',
      sparkSvg: '',
      sampling: 'Could not load',
    },
    section: {
      id: entry.id,
      label: entry.def.label,
      spec: specFor(entry.def, unit),
      latestLabel: '',
      stats: [],
      sampleCount: 0,
      quality: '',
      error: true,
    },
  };
}

function emptyMetric(entry: CatalogEntry, unit: string): {glance: GlanceRow, section: VisitSummarySection} {
  return {
    glance: {
      id: entry.id,
      label: entry.def.label,
      unit,
      latest: '—',
      periodAvg: '—',
      sparkSvg: '',
      sampling: 'No samples',
    },
    section: {
      id: entry.id,
      label: entry.def.label,
      spec: specFor(entry.def, unit),
      latestLabel: '',
      stats: [],
      sampleCount: 0,
      quality: qualityNote(entry, []),
      empty: true,
    },
  };
}

function buildBand(entry: CatalogEntry, days: string[], series: HealthSeries, unit: string): {glance: GlanceRow, section: VisitSummarySection} {
  const daily = series.daily || [];
  if (!daily.length) return emptyMetric(entry, unit);
  const avg = alignField(days, daily, 'value');
  const low = alignField(days, daily, 'min');
  const high = alignField(days, daily, 'max');
  const nums = avg.filter((v): v is number => v != null);
  const lastAvg = lastNumber(avg);
  const lastLow = lastNumber(low);
  const lastHigh = lastNumber(high);
  const periodLow = series.stats?.min;
  const periodHigh = series.stats?.max;
  const periodAvg = series.stats?.avg;
  const daysRecorded = nums.length;
  const latest = periodLow != null && periodHigh != null
    ? `${formatPlain(periodLow)}–${formatPlain(periodHigh)}`
    : lastAvg != null ? formatPlain(lastAvg) : '—';
  const lastRange = lastLow != null && lastHigh != null
    ? `${formatPlain(lastLow)}–${formatPlain(lastHigh)}`
    : latest;
  const lastDay = lastPresentDay(days, avg);
  return {
    glance: {
      id: entry.id,
      label: entry.def.label,
      unit,
      latest,
      periodAvg: periodAvg != null ? formatPlain(periodAvg) : '—',
      sparkSvg: sparklineSvg(avg),
      sampling: samplingLabel(entry.id, series.total || 0, daysRecorded, days.length),
    },
    section: {
      id: entry.id,
      label: entry.def.label,
      spec: specFor(entry.def, unit),
      latestLabel: lastDay ? `${escapeHtml(formatShortDay(lastDay))} range <b>${escapeHtml(lastRange)}</b>` : '',
      stats: [
        stat('Period low', periodLow),
        stat('Avg', periodAvg),
        stat('Period high', periodHigh),
        {key: 'Samples', value: (series.total || 0).toLocaleString()},
      ],
      sampleCount: series.total || 0,
      quality: qualityNote(entry, missingDays(days, avg)),
      chartSvg: bandChartSvg(low, high, avg),
    },
  };
}

function buildLine(
  entry: CatalogEntry,
  days: string[],
  series: HealthSeries,
  unit: string,
  weightUnit: WeightUnit,
): {glance: GlanceRow, section: VisitSummarySection} {
  const daily = (series.daily || []).map((bucket) => ({
    ...bucket,
    value: convertDisplayValue(bucket.value, entry.def, weightUnit),
    min: bucket.min != null ? convertDisplayValue(bucket.min, entry.def, weightUnit) : bucket.min,
    max: bucket.max != null ? convertDisplayValue(bucket.max, entry.def, weightUnit) : bucket.max,
  }));
  if (!daily.length) return emptyMetric(entry, unit);
  const values = alignField(days, daily, 'value');
  const nums = values.filter((v): v is number => v != null);
  const last = lastNumber(values);
  const stats = convertSeriesStats(series.stats, entry.def, weightUnit);
  const med = median(nums);
  const lastDay = lastPresentDay(days, values);
  const daysRecorded = nums.length;
  const latest = last != null ? formatValue(last, entry.def, weightUnit) : '—';
  return {
    glance: {
      id: entry.id,
      label: entry.def.label,
      unit,
      latest,
      periodAvg: stats?.avg != null ? formatValue(stats.avg, entry.def, weightUnit) : '—',
      sparkSvg: sparklineSvg(values),
      sampling: samplingLabel(entry.id, series.total || 0, daysRecorded, days.length),
    },
    section: {
      id: entry.id,
      label: entry.def.label,
      spec: specFor(entry.def, unit),
      latestLabel: last != null
        ? `Latest <b>${escapeHtml(formatValue(last, entry.def, weightUnit))}</b>${lastDay ? ` · ${escapeHtml(formatShortDay(lastDay))}` : ''}`
        : '',
      stats: [
        stat('Min', stats?.min, entry.def, weightUnit),
        {key: 'Median', value: med != null ? formatValue(med, entry.def, weightUnit) : '—'},
        stat('Max', stats?.max, entry.def, weightUnit),
        entry.id === 'heart_rate_variability_sdnn'
          ? {key: 'Readings', value: (series.total || 0).toLocaleString()}
          : {key: 'Days recorded', value: String(daysRecorded), extra: days.length ? `/ ${days.length}` : undefined},
      ],
      sampleCount: series.total || 0,
      quality: qualityNote(entry, missingDays(days, values)),
      chartSvg: lineChartSvg(values),
    },
  };
}

function buildBar(entry: CatalogEntry, days: string[], series: HealthSeries, unit: string): {glance: GlanceRow, section: VisitSummarySection} {
  const daily = series.daily || [];
  if (!daily.length) return emptyMetric(entry, unit);
  const values = alignField(days, daily, 'value');
  const nums = values.filter((v): v is number => v != null && v > 0);
  const last = lastNumber(values);
  const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : undefined;
  const lastDay = lastPresentDay(days, values);
  return {
    glance: {
      id: entry.id,
      label: entry.def.label,
      unit,
      latest: last != null ? Math.round(last).toLocaleString() : '—',
      periodAvg: avg != null ? Math.round(avg).toLocaleString() : '—',
      sparkSvg: sparklineSvg(values),
      sampling: samplingLabel(entry.id, series.total || 0, nums.length, days.length),
    },
    section: {
      id: entry.id,
      label: entry.def.label,
      spec: specFor(entry.def, unit),
      latestLabel: last != null
        ? `Latest <b>${escapeHtml(Math.round(last).toLocaleString())}</b>${lastDay ? ` · ${escapeHtml(formatShortDay(lastDay))}` : ''}`
        : '',
      stats: [
        {key: 'Min day', value: nums.length ? Math.round(Math.min(...nums)).toLocaleString() : '—'},
        {key: 'Daily avg', value: avg != null ? Math.round(avg).toLocaleString() : '—'},
        {key: 'Max day', value: nums.length ? Math.round(Math.max(...nums)).toLocaleString() : '—'},
        {key: 'Active days', value: String(nums.length), extra: days.length ? `/ ${days.length}` : undefined},
      ],
      sampleCount: series.total || 0,
      quality: qualityNote(entry, missingDays(days, values.map((v) => (v != null && v > 0 ? v : null)))),
      chartSvg: barChartSvg(values),
    },
  };
}

function buildSleep(entry: CatalogEntry, days: string[], series: HealthSeries, unit: string): {glance: GlanceRow, section: VisitSummarySection} {
  const byDate = new Map((series.nights || []).map((night) => [night.date, night.stages]));
  const nights = days.map((day) => byDate.get(day) || null);
  const hours = nights.map((stages) => {
    const n = asleepHours(stages || undefined);
    return n > 0 ? n : null;
  });
  const nums = hours.filter((v): v is number => v != null);
  if (!nums.length) return emptyMetric(entry, unit);
  const last = lastNumber(hours);
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  const lastDay = lastPresentDay(days, hours);
  return {
    glance: {
      id: entry.id,
      label: entry.def.label,
      unit: 'hours',
      latest: last != null ? `${last.toFixed(1)} h` : '—',
      periodAvg: `${avg.toFixed(1)} h`,
      sparkSvg: sparklineSvg(hours),
      sampling: samplingLabel(entry.id, series.total || 0, nums.length, days.length),
    },
    section: {
      id: entry.id,
      label: entry.def.label,
      spec: specFor(entry.def, unit || 'hours'),
      latestLabel: last != null
        ? `Latest <b>${escapeHtml(last.toFixed(1))} h</b>${lastDay ? ` · ${escapeHtml(formatShortDay(lastDay))}` : ''}`
        : '',
      stats: [
        {key: 'Min night', value: `${Math.min(...nums).toFixed(1)} h`},
        {key: 'Median', value: `${median(nums)?.toFixed(1)} h`},
        {key: 'Max night', value: `${Math.max(...nums).toFixed(1)} h`},
        {key: 'Nights recorded', value: String(nums.length), extra: days.length ? `/ ${days.length}` : undefined},
      ],
      sampleCount: series.total || 0,
      quality: qualityNote(entry, missingDays(days, hours)),
      chartSvg: sleepChartSvg(nights, SLEEP_STAGE_ORDER),
    },
  };
}

function buildReadings(
  entry: CatalogEntry,
  days: string[],
  samples: HealthSample[],
  unit: string,
  weightUnit: WeightUnit,
): {glance: GlanceRow, section: VisitSummarySection} {
  if (entry.id === 'blood_pressure') return buildBloodPressure(entry, days, samples, unit);
  const sorted = [...samples].sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
  if (!sorted.length) return emptyMetric(entry, unit);
  const values = sorted
    .map((sample) => sample.value_num)
    .filter((v): v is number => v != null)
    .map((v) => convertDisplayValue(v, entry.def, weightUnit));
  const daily = dailyFromSamples(days, samples, (sample) =>
    sample.value_num != null ? convertDisplayValue(sample.value_num, entry.def, weightUnit) : null,
  );
  const latestSample = sorted[0];
  const latest = latestSample.value_num != null
    ? formatValue(convertDisplayValue(latestSample.value_num, entry.def, weightUnit), entry.def, weightUnit)
    : (latestSample.value_text || '—');
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
  const readings = sorted.map((sample) => ({
    cells: [
      formatReadingTime(sample.start_time),
      sample.value_num != null
        ? formatValue(convertDisplayValue(sample.value_num, entry.def, weightUnit), entry.def, weightUnit)
        : (sample.value_text || '—'),
    ],
  }));
  return {
    glance: {
      id: entry.id,
      label: entry.def.label,
      unit,
      latest,
      periodAvg: avg != null ? formatValue(avg, entry.def, weightUnit) : '—',
      sparkSvg: sparklineSvg(daily),
      sampling: samplingLabel(entry.id, samples.length, countPresent(daily), days.length),
    },
    section: {
      id: entry.id,
      label: entry.def.label,
      spec: specFor(entry.def, unit),
      latestLabel: `${samples.length} reading${samples.length === 1 ? '' : 's'} this period`,
      stats: [],
      sampleCount: samples.length,
      quality: qualityNote(entry, missingDays(days, daily), samples),
      readingHeaders: ['Date & time', 'Value'],
      readings,
    },
  };
}

function buildBloodPressure(
  entry: CatalogEntry,
  days: string[],
  samples: HealthSample[],
  unit: string,
): {glance: GlanceRow, section: VisitSummarySection} {
  const rows = pairBloodPressure(samples);
  if (!rows.length) return emptyMetric(entry, unit);
  const daily = dailyFromSamples(days, samples, (sample) =>
    sample.components?.find((c) => c.code === LOINC_BP_SYS)?.value
      ?? (sample.metric_type === 'blood_pressure_systolic' ? sample.value_num ?? null : null),
  );
  const sys = rows.map((row) => row.sys).filter((v): v is number => v != null);
  const dia = rows.map((row) => row.dia).filter((v): v is number => v != null);
  const latest = rows[0];
  const avgSys = sys.length ? sys.reduce((a, b) => a + b, 0) / sys.length : undefined;
  const avgDia = dia.length ? dia.reduce((a, b) => a + b, 0) / dia.length : undefined;
  return {
    glance: {
      id: entry.id,
      label: entry.def.label,
      unit,
      latest: bpLabel(latest.sys, latest.dia),
      periodAvg: bpLabel(avgSys, avgDia),
      sparkSvg: sparklineSvg(daily),
      sampling: samplingLabel(entry.id, rows.length, countPresent(daily), days.length),
    },
    section: {
      id: entry.id,
      label: entry.def.label,
      spec: specFor(entry.def, unit),
      latestLabel: `${rows.length} reading${rows.length === 1 ? '' : 's'} this period`,
      stats: [],
      sampleCount: rows.length,
      quality: qualityNote(entry, missingDays(days, daily), samples),
      readingHeaders: ['Date & time', 'Systolic', 'Diastolic'],
      readings: rows.map((row) => ({
        cells: [
          formatReadingTime(row.at),
          row.sys != null ? String(Math.round(row.sys)) : '—',
          row.dia != null ? String(Math.round(row.dia)) : '—',
        ],
      })),
    },
  };
}

function buildFallbackTable(entry: CatalogEntry, samples: HealthSample[], unit: string): {glance: GlanceRow, section: VisitSummarySection} {
  const count = samples.length || entry.summaries.reduce((sum, s) => sum + (s.sample_count || 0), 0);
  if (!count && !samples.length) return emptyMetric(entry, unit);
  const sorted = [...samples].sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
  const latest = sorted[0]
    ? (sorted[0].value_text || (sorted[0].value_num != null ? String(sorted[0].value_num) : entry.latestLabel))
    : (entry.latestLabel || '—');
  return {
    glance: {
      id: entry.id,
      label: entry.def.label,
      unit,
      latest: latest || '—',
      periodAvg: '—',
      sparkSvg: '',
      sampling: samplingLabel(entry.id, count, 0, 0),
    },
    section: {
      id: entry.id,
      label: entry.def.label,
      spec: specFor(entry.def, unit),
      latestLabel: latest ? `Latest <b>${escapeHtml(latest)}</b>` : '',
      stats: [{key: 'Samples', value: count.toLocaleString()}],
      sampleCount: count,
      quality: qualityNote(entry, []),
      readingHeaders: sorted.length ? ['Date & time', 'Value'] : undefined,
      readings: sorted.length
        ? sorted.map((sample) => ({
          cells: [
            formatReadingTime(sample.start_time),
            sample.value_text || SLEEP_STAGE_LABELS[sample.value_text || ''] || (sample.value_num != null ? String(sample.value_num) : '—'),
          ],
        }))
        : undefined,
    },
  };
}

function pairBloodPressure(samples: HealthSample[]): {at: string, sys?: number, dia?: number}[] {
  const rows: {at: string, sys?: number, dia?: number}[] = [];
  for (const sample of samples) {
    const sys = sample.components?.find((c) => c.code === LOINC_BP_SYS)?.value
      ?? (sample.metric_type === 'blood_pressure_systolic' ? sample.value_num : undefined);
    const dia = sample.components?.find((c) => c.code === LOINC_BP_DIA)?.value
      ?? (sample.metric_type === 'blood_pressure_diastolic' ? sample.value_num : undefined);
    if (sys != null || dia != null) {
      rows.push({at: sample.start_time, sys, dia});
    }
  }
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

function samplesFor(entry: CatalogEntry, samples: HealthSample[]): HealthSample[] {
  if (entry.def.codes.length) {
    const codes = new Set(entry.def.codes);
    return samples.filter((sample) => codes.has(sample.code || '') || (entry.id === sample.metric_type));
  }
  if (entry.def.vendorType) return samples.filter((sample) => sample.vendor_type === entry.def.vendorType);
  return [];
}

function collectRecordedDates(
  selected: CatalogEntry[],
  seriesById: Record<string, HealthSeries | null>,
  samples: HealthSample[],
): string[] {
  const dates = new Set<string>();
  for (const entry of selected) {
    const series = seriesById[entry.id];
    for (const bucket of series?.daily || []) dates.add(bucket.date);
    for (const night of series?.nights || []) dates.add(night.date);
  }
  for (const sample of samples) {
    const day = sample.start_time.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) dates.add(day);
  }
  return [...dates].sort();
}

function uniqueDevices(selected: CatalogEntry[], samples: HealthSample[]): string[] {
  const names = new Set<string>();
  for (const entry of selected) {
    for (const summary of entry.summaries) {
      const name = summary.device_name || summary.source_name;
      if (name) names.add(name);
    }
  }
  for (const sample of samples) {
    const name = sample.device_name || sample.source_name;
    if (name) names.add(name);
  }
  return [...names];
}

function alignField(days: string[], buckets: {date: string, value: number, min?: number, max?: number}[], field: 'value' | 'min' | 'max'): (number | null)[] {
  const map = new Map<string, number>();
  for (const bucket of buckets) {
    const raw = field === 'value' ? bucket.value : bucket[field];
    if (raw != null) map.set(bucket.date, raw);
  }
  return days.map((day) => (map.has(day) ? map.get(day)! : null));
}

function dailyFromSamples(days: string[], samples: HealthSample[], valueOf: (sample: HealthSample) => number | null): (number | null)[] {
  const last = new Map<string, {t: number, v: number}>();
  for (const sample of samples) {
    const day = sample.start_time.slice(0, 10);
    const value = valueOf(sample);
    if (value == null) continue;
    const t = Date.parse(sample.start_time);
    const prev = last.get(day);
    if (!prev || t >= prev.t) last.set(day, {t, v: value});
  }
  return days.map((day) => last.get(day)?.v ?? null);
}

function samplingLabel(id: string, sampleCount: number, daysRecorded: number, daysInWindow: number): string {
  if (sampleCount <= 0) return 'No samples';
  if (id === 'heart_rate' || id === 'step_count') {
    if (daysInWindow && sampleCount >= daysInWindow * 10) return 'High · continuous';
    return `High · ${sampleCount.toLocaleString()} samples`;
  }
  if (id === 'resting_heart_rate' || id === 'sleep_stage') {
    return daysRecorded ? `High · daily` : `Med · ${sampleCount} readings`;
  }
  if (sampleCount < 15) return `Low · ${sampleCount} reading${sampleCount === 1 ? '' : 's'}`;
  return `Med · ${sampleCount} readings`;
}

function specFor(def: MetricDef, unit: string): string {
  switch (def.id) {
    case 'heart_rate': return `${unit} · daily range`;
    case 'resting_heart_rate': return `${unit} · one value per day`;
    case 'heart_rate_variability_sdnn': return 'ms · SDNN';
    case 'step_count': return 'count · per day';
    case 'sleep_stage': return 'hours · by night';
    case 'blood_pressure': return 'mmHg · individual readings';
    case 'body_mass':
    case 'body_temperature':
    case 'oxygen_saturation':
      return `${unit} · individual readings`;
    default:
      return unit ? `${unit}` : '';
  }
}

function qualityNote(entry: CatalogEntry, missing: string[], samples: HealthSample[] = []): string {
  const gaps = namedGaps(missing);
  const device = samples.map((s) => s.device_name || s.source_name).find(Boolean)
    || entry.summaries.map((s) => s.device_name || s.source_name).find(Boolean);
  const watch = !!device && /watch/i.test(device);
  const notes: Record<string, string> = {
    heart_rate: '<b>Band shows each day’s low-to-high range; line is the daily average.</b> Averages hide spikes, so the daily high and low are kept rather than smoothed away.'
      + (watch ? ' Continuous optical sensor.' : ''),
    resting_heart_rate: watch
      ? '<b>Measured overnight by the watch.</b> Consumer-grade, generally tracks a clinical resting HR within a few bpm.'
      : '<b>A daily resting rate from a consumer device.</b> Generally tracks a clinical resting HR within a few bpm.',
    heart_rate_variability_sdnn: (watch
      ? '<b>SDNN, sampled irregularly by the watch — not RMSSD.</b> '
      : '<b>SDNN, not RMSSD.</b> ')
      + 'Absolute values aren’t comparable to a clinical ECG-derived HRV; the trend over time is the usable signal, not any single number.',
    step_count: '<b>Activity context, not a clinical measure.</b> Useful as a backdrop for the cardiac trends above rather than on its own.',
    blood_pressure: device
      ? `<b>Recorded as blood pressure samples from ${escapeHtml(device)}.</b> Consumer-grade. Confirm with an in-clinic measurement before acting.`
      : '<b>Spot readings from a consumer device — device model not recorded.</b> Not a validated clinical feed. Confirm with an in-clinic measurement before acting.',
    oxygen_saturation: watch
      ? '<b>Optical sensor on a consumer device, not a clinical pulse oximeter.</b>'
      : '<b>Pulse oximetry from a consumer device, not a clinical pulse oximeter.</b>',
    body_mass: '<b>Spot checks from a home scale or health app.</b> Not a clinical weigh-in.',
    body_temperature: '<b>Spot checks from a consumer thermometer.</b> Not a clinical measurement.',
    sleep_stage: watch
      ? '<b>Watch-estimated sleep stages, not a clinical sleep study.</b>'
      : '<b>Device-estimated sleep stages, not a clinical sleep study.</b>',
  };
  const base = notes[entry.id] || '<b>Recorded on a consumer device.</b>';
  const gapBit = gaps ? ` No readings ${escapeHtml(gaps)}.` : '';
  return base + gapBit;
}

function stat(key: string, value: number | undefined, def?: MetricDef, weightUnit?: WeightUnit): VisitSummaryStat {
  if (value == null) return {key, value: '—'};
  if (def && weightUnit) return {key, value: formatValue(value, def, weightUnit)};
  return {key, value: formatPlain(value)};
}

function formatValue(value: number, def: MetricDef, weightUnit: WeightUnit): string {
  if (def.id === 'body_mass' && weightUnit === 'st') return formatStoneFromDecimal(value);
  if (def.id === 'body_mass') {
    return `${value.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 1})} ${weightUnitLabel(weightUnit)}`;
  }
  if (def.id === 'step_count') return Math.round(value).toLocaleString();
  return formatPlain(value);
}

function formatPlain(value: number): string {
  return value.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 1});
}

function bpLabel(sys?: number, dia?: number): string {
  const s = sys != null ? String(Math.round(sys)) : '—';
  const d = dia != null ? String(Math.round(dia)) : '—';
  return `${s}/${d}`;
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function lastNumber(values: (number | null)[]): number | undefined {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] != null) return values[i] as number;
  }
  return undefined;
}

function lastPresentDay(days: string[], values: (number | null)[]): string | undefined {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] != null) return days[i];
  }
  return undefined;
}

function missingDays(days: string[], values: (number | null)[]): string[] {
  return days.filter((_, i) => values[i] == null);
}

function countPresent(values: (number | null)[]): number {
  return values.filter((v) => v != null).length;
}

function formatWindowDay(d: Date): string {
  return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'});
}

function formatShortDay(ymd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return ymd;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatReadingTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
}

function ageAt(birthDate: string, at: Date): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  let age = at.getFullYear() - year;
  if (at.getMonth() < month || (at.getMonth() === month && at.getDate() < day)) age -= 1;
  return age >= 0 && age < 130 ? age : undefined;
}

function syncRecency(synced: Date, generated: Date): string {
  const ms = generated.getTime() - synced.getTime();
  if (!Number.isFinite(ms)) return '';
  if (ms < 0) return 'timestamp after this export';
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just before export';
  if (min < 60) return `${min} min before export`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} before export`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} before export`;
}

function utcDateStrings(start: Date, end: Date): string[] {
  const out: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(end.getTime() - 1);
  const lastUtc = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate());
  while (cursor.getTime() <= lastUtc && out.length < 4000) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function nextUtcDay(ymd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return ymd;
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
  return next.toISOString().slice(0, 10);
}

function utcDaySpan(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  return Math.round((b - a) / 86400000) + 1;
}
