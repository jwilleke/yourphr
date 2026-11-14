import {ChangeDetectionStrategy, Component, HostListener, NgZone, OnDestroy, OnInit, TemplateRef, ViewChild} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {forkJoin, Observable, of} from 'rxjs';
import {catchError, map, switchMap} from 'rxjs/operators';
import {ChartConfiguration, ChartData} from 'chart.js';
import {BaseChartDirective} from 'ng2-charts';
import {NgbModal, NgbModalRef, NgbModule} from '@ng-bootstrap/ng-bootstrap';
import {FastenApiService} from '../../services/fasten-api.service';
import {HealthSample, HealthSampleQuery, HealthSeries, HealthSeriesPoint} from '../../models/fasten/health-sample';
import {ResourceFhir} from '../../models/fasten/resource_fhir';
import {PatientModel} from '../../../lib/models/resources/patient-model';
import {LoadingSpinnerComponent} from '../../components/loading-spinner/loading-spinner.component';
import {
  assembleVisitSummary,
  buildVisitSummaryHtml,
  defaultSummarySelection,
  emptySeries,
  hasSummarySelection,
  SAMPLE_PAGE_LIMIT,
  sampleQueriesFor,
  seriesQueryFor,
  SUMMARY_RANGE_DEFAULT,
  triggerDownloads,
  VisitSummaryPatient,
  VisitSummaryWindow,
  visitSummaryCsvFilename,
  visitSummaryFilename,
  visitSummaryWindow,
} from './health-visit-summary';
import {buildVisitSummaryCsv} from './health-visit-summary-csv';
import {
  asPercent,
  CatalogEntry,
  displayUnit,
  formatLatest,
  formatStoneFromDecimal,
  formatWeight,
  groupSummaries,
  isAsleepStageLabel,
  kgToWeightUnit,
  LOINC_BP_DIA,
  LOINC_BP_SYS,
  MetricDef,
  parseStoredWeightUnit,
  seriesMode,
  SLEEP_AWAKE,
  SLEEP_DEEP,
  SLEEP_LIGHT,
  SLEEP_REM,
  SLEEP_STAGE_LABELS,
  SLEEP_STAGE_ORDER,
  WEIGHT_UNIT_STORAGE_KEY,
  WEIGHT_UNITS,
  WeightUnit,
  weightUnitLabel,
} from './health-metrics';

export type RangePreset = '24h' | '5d' | '30d' | '90d' | 'all';
export type ViewMode = 'chart' | 'table';

/** Phone portrait and other narrow windows. Wider viewports keep the side-by-side catalog. */
export const NARROW_HEALTH_QUERY = '(max-width: 768px)';

export const RANGE_MS: Record<Exclude<RangePreset, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '5d': 5 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

const TABLE_PAGE = 50;

const INDIGO = 'rgb(102, 16, 242)';
const INDIGO_FILL = 'rgba(102, 16, 242, 0.12)';
const TEAL = 'rgb(13, 202, 240)';
const SLEEP_COLORS: Record<string, string> = {
  [SLEEP_AWAKE]: 'rgba(253, 126, 20, 0.85)',
  [SLEEP_LIGHT]: 'rgba(13, 110, 253, 0.85)',
  [SLEEP_DEEP]: 'rgba(102, 16, 242, 0.85)',
  [SLEEP_REM]: 'rgba(111, 66, 193, 0.65)',
};

export interface TableRow {
  time: string
  value: string
  unit: string
  source: string
}

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, NgbModule, BaseChartDirective, LoadingSpinnerComponent],
  selector: 'app-health',
  templateUrl: './health.component.html',
  styleUrls: ['./health.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class HealthComponent implements OnInit, OnDestroy {
  loading = true;
  errored = false;
  detailLoading = false;

  entries: CatalogEntry[] = [];
  selectedId = '';
  /** True when the viewport is at or below the side-by-side breakpoint. */
  narrow = false;
  /** True when the narrow menu has slid to a metric. Ignored while the viewport is wide. */
  detailOpen = false;
  /** Set only by a tap on the narrow menu, so a later return to portrait restores that metric. */
  private drilledIn = false;
  private detailHistory = false;
  private closingDetail = false;
  private narrowQuery: MediaQueryList | null = null;
  private readonly onNarrowMedia = (event: MediaQueryListEvent) => {
    this.zone.run(() => this.applyNarrow(event.matches));
  };
  lastSyncedAt: string | null = null;

  view: ViewMode = 'chart';
  range: RangePreset = '5d';
  rangePresets: {id: RangePreset, label: string}[] = [
    {id: '24h', label: '24h'},
    {id: '5d', label: '5 days'},
    {id: '30d', label: '30 days'},
    {id: '90d', label: '90 days'},
    {id: 'all', label: 'All'},
  ];
  windowEnd = new Date();
  /** Latest moment the time slider may reach. Kept stable during a render so the max binding does not change mid-check. */
  private sliderNow = this.windowEnd.getTime();

  chartType: 'line' | 'bar' = 'line';
  chartData: ChartData = {labels: [], datasets: []};
  chartOptions: ChartConfiguration['options'] = defaultChartOptions('line', '', {
    range: '5d',
    windowStart: null,
    windowEnd: new Date(),
  });
  hasChartData = false;
  seriesTotal = 0;
  seriesStats: {min?: number, max?: number, avg?: number} | null = null;
  downsampled = false;
  seriesUnit = '';

  tableRows: TableRow[] = [];
  tableTotal = 0;
  tableOffset = 0;
  tablePageSize = TABLE_PAGE;

  weightUnit: WeightUnit = 'kg';
  weightUnits = WEIGHT_UNITS;
  private rawSeries: HealthSeries | null = null;
  private rawSamples: HealthSample[] = [];

  @ViewChild('visitSummaryDialog') visitSummaryDialog: TemplateRef<any>;
  summaryRange: RangePreset = SUMMARY_RANGE_DEFAULT;
  summaryChecks: Record<string, boolean> = {};
  summaryBuilding = false;
  summaryError = '';
  private summaryModal: NgbModalRef | null = null;

  constructor(private fastenApi: FastenApiService, private modalService: NgbModal, private zone: NgZone) {}

  ngOnDestroy(): void {
    this.narrowQuery?.removeEventListener('change', this.onNarrowMedia);
  }

  ngOnInit(): void {
    this.narrowQuery = window.matchMedia(NARROW_HEALTH_QUERY);
    this.narrow = this.narrowQuery.matches;
    this.narrowQuery.addEventListener('change', this.onNarrowMedia);
    this.weightUnit = parseStoredWeightUnit(safeLocalStorageGet(WEIGHT_UNIT_STORAGE_KEY));
    this.fastenApi.getHealthMetrics().subscribe({
      next: (catalog) => {
        this.entries = groupSummaries(catalog.metrics || []);
        this.applyWeightLabels();
        this.lastSyncedAt = catalog.last_synced_at || null;
        this.loading = false;
        if (this.narrow) return;
        this.selectedId = this.entries[0]?.id || '';
        if (this.selectedId) this.loadDetail();
      },
      error: () => {
        this.errored = true;
        this.loading = false;
      },
    });
  }

  get selected(): CatalogEntry | undefined {
    return this.entries.find((e) => e.id === this.selectedId);
  }

  get windowStart(): Date | null {
    if (this.range === 'all') return null;
    return new Date(this.windowEnd.getTime() - RANGE_MS[this.range]);
  }

  get windowLabel(): string {
    if (this.range === 'all') return 'All time';
    const start = this.windowStart;
    if (!start) return '';
    return `${formatDay(start)} – ${formatDay(new Date(this.windowEnd.getTime() - 1))}`;
  }

  get canPageBack(): boolean {
    if (this.range === 'all' || !this.selected) return false;
    const earliest = earliestOf(this.selected);
    const start = this.windowStart;
    return !!(earliest && start && start.getTime() > earliest.getTime());
  }

  get canPageForward(): boolean {
    if (this.range === 'all') return false;
    return this.windowEnd.getTime() < Date.now() - 1000;
  }

  get sliderMin(): number {
    const earliest = this.selected ? earliestOf(this.selected) : null;
    return earliest ? earliest.getTime() : 0;
  }

  get sliderMax(): number {
    if (this.range === 'all') return 0;
    const duration = RANGE_MS[this.range];
    const earliest = this.selected ? earliestOf(this.selected) : null;
    const latestStart = this.sliderNow - duration;
    if (earliest && earliest.getTime() > latestStart) return earliest.getTime();
    return latestStart;
  }

  get sliderValue(): number {
    return this.windowStart?.getTime() ?? this.sliderMin;
  }

  get tableFrom(): number {
    if (this.tableTotal === 0) return 0;
    return this.tableOffset + 1;
  }

  get tableTo(): number {
    return Math.min(this.tableOffset + this.tableRows.length, this.tableTotal);
  }

  get sourceLabel(): string {
    const summary = this.selected?.summaries[0];
    return summary?.device_name || summary?.source_name || 'device';
  }

  selectMetric(id: string): void {
    const same = id === this.selectedId;
    if (!same) {
      this.selectedId = id;
      this.tableOffset = 0;
      const entry = this.entries.find((e) => e.id === id);
      if (entry?.def.viz === 'table') this.view = 'table';
      this.loadDetail();
    } else if (!this.narrow || this.detailOpen) {
      return;
    }
    if (!this.narrow) return;
    this.openNarrowDetail();
  }

  closeDetail(): void {
    if (this.closingDetail || !this.detailOpen) return;
    if (this.detailHistory) {
      this.closingDetail = true;
      history.back();
      return;
    }
    this.finishCloseDetail();
  }

  @HostListener('window:popstate')
  onPopState(): void {
    if (!this.detailHistory && !this.closingDetail) return;
    this.detailHistory = false;
    this.closingDetail = false;
    this.finishCloseDetail();
  }

  private openNarrowDetail(): void {
    this.drilledIn = true;
    this.detailOpen = true;
    if (this.detailHistory) return;
    // Same URL, so the companion WebView edge swipe returns to the menu instead of leaving Health.
    history.pushState({healthDetail: true}, '');
    this.detailHistory = true;
  }

  private finishCloseDetail(): void {
    this.detailOpen = false;
    this.drilledIn = false;
  }

  private applyNarrow(matches: boolean): void {
    const wasNarrow = this.narrow;
    this.narrow = matches;
    if (!matches) {
      if (!this.selectedId && this.entries.length && !this.loading) {
        this.selectedId = this.entries[0].id;
        this.loadDetail();
      }
      return;
    }
    if (wasNarrow) return;
    this.detailOpen = this.drilledIn;
  }

  setView(view: ViewMode): void {
    if (view === this.view) return;
    this.view = view;
    this.tableOffset = 0;
    this.loadDetail();
  }

  setRange(range: RangePreset): void {
    this.range = range;
    this.windowEnd = new Date();
    this.sliderNow = this.windowEnd.getTime();
    this.tableOffset = 0;
    this.loadDetail();
  }

  pageWindow(direction: -1 | 1): void {
    if (this.range === 'all') return;
    const duration = RANGE_MS[this.range];
    const next = new Date(this.windowEnd.getTime() + direction * duration);
    const now = new Date();
    this.sliderNow = now.getTime();
    if (direction > 0 && next.getTime() > now.getTime()) {
      this.windowEnd = now;
    } else {
      this.windowEnd = next;
    }
    this.tableOffset = 0;
    this.loadDetail();
  }

  onSliderInput(raw: string): void {
    if (this.range === 'all') return;
    const start = Number(raw);
    if (!Number.isFinite(start)) return;
    this.sliderNow = Date.now();
    this.windowEnd = new Date(start + RANGE_MS[this.range]);
    this.tableOffset = 0;
    this.loadDetail();
  }

  pageTable(direction: -1 | 1): void {
    const next = this.tableOffset + direction * TABLE_PAGE;
    if (next < 0 || next >= this.tableTotal) return;
    this.tableOffset = next;
    this.loadDetail();
  }

  setWeightUnit(unit: WeightUnit): void {
    if (unit === this.weightUnit) return;
    this.weightUnit = unit;
    safeLocalStorageSet(WEIGHT_UNIT_STORAGE_KEY, unit);
    this.applyWeightLabels();
    const entry = this.selected;
    if (entry?.id !== 'body_mass') return;
    if (this.view === 'table') {
      this.tableRows = toTableRows(entry.def, this.rawSamples, this.weightUnit);
      return;
    }
    if (this.rawSeries) this.applySeries(entry.def, this.rawSeries);
  }

  get showWeightUnits(): boolean {
    return this.selected?.id === 'body_mass';
  }

  get summaryHasSelection(): boolean {
    return hasSummarySelection(this.summaryChecks);
  }

  openVisitSummary(): void {
    if (!this.entries.length) return;
    this.summaryChecks = defaultSummarySelection(this.entries);
    this.summaryRange = SUMMARY_RANGE_DEFAULT;
    this.summaryBuilding = false;
    this.summaryError = '';
    this.summaryModal = this.modalService.open(this.visitSummaryDialog, {ariaLabelledBy: 'visit-summary-title'});
  }

  confirmVisitSummary(): void {
    if (!this.summaryHasSelection || this.summaryBuilding) return;
    this.summaryBuilding = true;
    this.summaryError = '';
    const now = new Date();
    const window = visitSummaryWindow(this.summaryRange, now);
    const selected = this.entries.filter((entry) => this.summaryChecks[entry.id]);
    const chartEntries = selected.filter((entry) => seriesQueryFor(entry));
    forkJoin({
      patient: this.fastenApi.getResources('Patient').pipe(catchError(() => of([] as ResourceFhir[]))),
      series: chartEntries.length
        ? forkJoin(chartEntries.map((entry) => this.loadSummarySeries(entry, window).pipe(
          map((series) => [entry.id, series] as const),
        )))
        : of([] as readonly [string, HealthSeries | null][]),
      samples: this.listAllSummarySamples(selected, window),
    }).subscribe({
      next: ({patient, series, samples}) => {
        const seriesById: Record<string, HealthSeries | null> = {};
        for (const [id, value] of series) seriesById[id] = value;
        const csvFilename = visitSummaryCsvFilename(now);
        const html = buildVisitSummaryHtml(assembleVisitSummary({
          generatedAt: now,
          window,
          lastSyncedAt: this.lastSyncedAt,
          patient: patientFromResources(patient),
          selected,
          seriesById,
          samples,
          weightUnit: this.weightUnit,
          csvFilename,
        }));
        triggerDownloads([
          {content: html, filename: visitSummaryFilename(now), mime: 'text/html;charset=utf-8'},
          {content: buildVisitSummaryCsv(samples), filename: csvFilename, mime: 'text/csv;charset=utf-8'},
        ]);
        this.summaryBuilding = false;
        this.summaryModal?.close();
        this.summaryModal = null;
      },
      error: () => {
        this.summaryBuilding = false;
        this.summaryError = 'The summary could not be built. Please try again.';
      },
    });
  }

  private loadSummarySeries(entry: CatalogEntry, window: VisitSummaryWindow): Observable<HealthSeries | null> {
    const query = seriesQueryFor(entry);
    if (!query) return of(null);
    const bounds: {startAfter?: string, startBefore?: string} = {};
    if (window.startAfter) bounds.startAfter = window.startAfter;
    if (window.startBefore) bounds.startBefore = window.startBefore;
    return this.fastenApi.getHealthSeries({
      codes: query.codes,
      vendorType: query.vendorType,
      mode: query.mode,
      ...bounds,
    }).pipe(catchError(() => of(null)));
  }

  private listAllSummarySamples(entries: CatalogEntry[], window: VisitSummaryWindow): Observable<HealthSample[]> {
    const queries = sampleQueriesFor(entries);
    if (!queries.length) return of([]);
    const bounds: {startAfter?: string, startBefore?: string} = {};
    if (window.startAfter) bounds.startAfter = window.startAfter;
    if (window.startBefore) bounds.startBefore = window.startBefore;
    return forkJoin(queries.map((query) => this.listAllSamplePages({...query, ...bounds}))).pipe(
      map((pages) => pages.reduce((acc, rows) => acc.concat(rows), [] as HealthSample[])),
    );
  }

  private listAllSamplePages(query: {codes?: string[], metricTypes?: string[], vendorType?: string, startAfter?: string, startBefore?: string}): Observable<HealthSample[]> {
    const go = (offset: number, acc: HealthSample[]): Observable<HealthSample[]> => {
      const pageQuery: HealthSampleQuery = {
        ...query,
        limit: SAMPLE_PAGE_LIMIT,
        offset,
        sort: 'asc',
      };
      return this.fastenApi.listHealthSamples(pageQuery).pipe(
        switchMap((page) => {
          const next = acc.concat(page.samples);
          if (page.count === 0 || page.offset + page.count >= page.total) return of(next);
          return go(offset + page.count, next);
        }),
        catchError(() => of(acc)),
      );
    };
    return go(0, []);
  }

  formatChartStat(value: number | undefined | null): string {
    if (value == null || Number.isNaN(value)) return '';
    if (this.showWeightUnits && this.weightUnit === 'st') {
      return formatStoneFromDecimal(value);
    }
    return value.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 1});
  }

  private applyWeightLabels(): void {
    for (const entry of this.entries) {
      if (entry.id === 'body_mass') {
        entry.latestLabel = formatLatest(entry.def, entry.summaries, this.weightUnit);
      }
    }
  }

  private loadDetail(): void {
    const entry = this.selected;
    if (!entry) return;
    this.detailLoading = true;
    if (this.view === 'table' || entry.def.viz === 'table') {
      this.loadTable(entry);
      return;
    }
    this.loadChart(entry);
  }

  private queryWindow(): {startAfter?: string, startBefore?: string} {
    const bounds: {startAfter?: string, startBefore?: string} = {};
    if (this.windowStart) bounds.startAfter = this.windowStart.toISOString();
    if (this.range !== 'all') bounds.startBefore = this.windowEnd.toISOString();
    return bounds;
  }

  private loadChart(entry: CatalogEntry): void {
    const bounds = this.queryWindow();
    const mode = seriesMode(entry.def.viz);
    if (entry.def.viz === 'dual-line') {
      this.fastenApi.getHealthSeries({codes: entry.def.codes, mode, ...bounds}).pipe(
        catchError(() => of(emptySeries())),
      ).subscribe({
        next: (series) => {
          this.applyDualSeries(
            {...series, points: series.components?.[LOINC_BP_SYS] || []},
            {...series, points: series.components?.[LOINC_BP_DIA] || []},
          );
          this.detailLoading = false;
        },
        error: () => { this.detailLoading = false; },
      });
      return;
    }
    this.fastenApi.getHealthSeries({
      codes: entry.def.codes.length ? entry.def.codes : undefined,
      vendorType: entry.def.vendorType,
      mode,
      ...bounds,
    }).subscribe({
      next: (series) => {
        this.applySeries(entry.def, series);
        this.detailLoading = false;
      },
      error: () => { this.detailLoading = false; },
    });
  }

  private loadTable(entry: CatalogEntry): void {
    const bounds = this.queryWindow();
    this.fastenApi.listHealthSamples({
      codes: entry.def.codes.length ? entry.def.codes : undefined,
      vendorType: entry.def.vendorType,
      startAfter: bounds.startAfter,
      startBefore: bounds.startBefore,
      limit: TABLE_PAGE,
      offset: this.tableOffset,
      sort: 'desc',
    }).subscribe({
      next: (page) => {
        this.tableTotal = page.total;
        this.rawSamples = page.samples;
        this.tableRows = toTableRows(entry.def, page.samples, this.weightUnit);
        this.view = 'table';
        this.detailLoading = false;
      },
      error: () => { this.detailLoading = false; },
    });
  }

  private applySeries(def: MetricDef, series: HealthSeries): void {
    this.rawSeries = series;
    this.seriesTotal = series.total || 0;
    this.seriesStats = convertStats(series.stats, def, this.weightUnit);
    this.downsampled = !!series.downsampled;
    this.seriesUnit = displayUnit(def, series.unit, this.weightUnit);
    const convert = (v: number) => {
      if (def.id === 'body_mass') return kgToWeightUnit(v, this.weightUnit);
      if (def.id === 'oxygen_saturation') return asPercent(v);
      return v;
    };
    if (def.viz === 'bar-daily') {
      this.chartType = 'bar';
      const data = toDayPoints(series.daily || [], convert);
      this.hasChartData = data.length > 0;
      this.chartData = {
        datasets: [{
          label: def.label,
          data,
          backgroundColor: INDIGO,
          maxBarThickness: 40,
        }],
      };
      this.chartOptions = this.chartOptionsFor('bar', this.seriesUnit || def.unit || '');
      return;
    }
    if (def.viz === 'sleep-stages') {
      this.chartType = 'bar';
      const nights = series.nights || [];
      this.hasChartData = nights.length > 0;
      this.chartData = {
        datasets: SLEEP_STAGE_ORDER.filter((stage) => nights.some((n) => (n.stages?.[stage] || 0) > 0)).map((stage) => ({
          label: SLEEP_STAGE_LABELS[stage] || stage,
          data: toDayPoints(nights.map((n) => ({date: n.date, value: n.stages?.[stage] || 0}))),
          backgroundColor: SLEEP_COLORS[stage],
          stack: 'sleep',
          maxBarThickness: 40,
        })),
      };
      this.chartOptions = this.chartOptionsFor('bar', 'hours', true);
      return;
    }
    this.chartType = 'line';
    const daily = series.daily || [];
    if (daily.length > 0) {
      const points = toDayPoints(daily, convert);
      this.hasChartData = points.length > 0;
      const datasets: ChartConfiguration['data']['datasets'] = [{
        label: def.label,
        data: points,
        borderColor: INDIGO,
        backgroundColor: INDIGO_FILL,
        pointRadius: points.length > 80 ? 0 : 2,
        fill: false,
        tension: 0.2,
      }];
      if (daily.some((bucket) => bucket.min != null && bucket.max != null)) {
        datasets.push({
          label: 'Low',
          data: toDayPoints(daily.map((bucket) => ({date: bucket.date, value: bucket.min ?? bucket.value})), convert),
          borderColor: 'rgba(13, 110, 253, 0.35)',
          pointRadius: 0,
          borderDash: [4, 4],
          fill: false,
        });
        datasets.push({
          label: 'High',
          data: toDayPoints(daily.map((bucket) => ({date: bucket.date, value: bucket.max ?? bucket.value})), convert),
          borderColor: 'rgba(13, 110, 253, 0.35)',
          pointRadius: 0,
          borderDash: [4, 4],
          fill: '-1',
        });
      }
      this.chartData = {datasets};
      this.chartOptions = this.chartOptionsFor('line', this.seriesUnit);
      return;
    }
    const points = toTimePoints(series.points || [], convert);
    this.hasChartData = points.length > 0;
    this.chartData = {
      datasets: [{
        label: def.label,
        data: points,
        borderColor: INDIGO,
        backgroundColor: INDIGO_FILL,
        pointRadius: points.length > 80 ? 0 : 2,
        fill: true,
        tension: 0.2,
      }],
    };
    this.chartOptions = this.chartOptionsFor('line', this.seriesUnit);
  }

  private applyDualSeries(sys: HealthSeries, dia: HealthSeries): void {
    const sysPoints = toTimePoints(sys.points || []);
    const diaPoints = toTimePoints(dia.points || []);
    this.chartType = 'line';
    this.seriesTotal = (sys.total || 0) + (dia.total || 0);
    this.downsampled = !!(sys.downsampled || dia.downsampled);
    this.seriesUnit = 'mmHg';
    this.seriesStats = sys.stats || dia.stats || null;
    this.hasChartData = sysPoints.length > 0 || diaPoints.length > 0;
    this.chartData = {
      datasets: [
        {label: 'Systolic', data: sysPoints, borderColor: INDIGO, pointRadius: 3, tension: 0.1},
        {label: 'Diastolic', data: diaPoints, borderColor: TEAL, pointRadius: 3, tension: 0.1},
      ],
    };
    this.chartOptions = this.chartOptionsFor('line', 'mmHg');
  }

  private chartOptionsFor(kind: 'line' | 'bar', unit: string, stacked = false): ChartConfiguration['options'] {
    return defaultChartOptions(kind, unit, {
      stacked,
      range: this.range,
      windowStart: this.windowStart,
      windowEnd: this.windowEnd,
    });
  }
}

function patientFromResources(results: ResourceFhir[] | unknown): VisitSummaryPatient | undefined {
  const list = Array.isArray(results) ? results : [];
  const raw = list[0]?.resource_raw;
  if (!raw) return undefined;
  const model = new PatientModel(raw);
  const name = (model.patient_name || '').trim();
  const birthDate = (model.patient_birthdate || '').trim();
  if (!name && !birthDate) return undefined;
  return {
    name: name || undefined,
    birthDate: birthDate || undefined,
  };
}

function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // display preference only
  }
}

function earliestOf(entry: CatalogEntry): Date | null {
  const times = entry.summaries.map((s) => Date.parse(s.earliest_at)).filter((n) => Number.isFinite(n));
  if (!times.length) return null;
  return new Date(Math.min(...times));
}

function formatDay(d: Date): string {
  return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

export interface HealthChartPoint {
  x: number
  y: number
}

export function toTimePoints(points: HealthSeriesPoint[], convert: (v: number) => number = (v) => v): HealthChartPoint[] {
  return points
    .map((p) => ({x: Date.parse(p.t), y: convert(p.v)}))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

export function toDayPoints(days: {date: string, value: number}[], convert: (v: number) => number = (v) => v): HealthChartPoint[] {
  return days
    .map((d) => ({x: utcDayMs(d.date), y: convert(d.value)}))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

// Daily buckets are UTC calendar dates (YYYY-MM-DD). Plot at local noon so the bar sits on that
// calendar date on a local time axis, rather than shifting when UTC midnight falls on the prior day.
export function utcDayMs(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return Date.parse(date);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0).getTime();
}

export function timeAxisBounds(
  range: RangePreset,
  windowStart: Date | null,
  windowEnd: Date,
): {min?: number, max?: number} {
  if (range === 'all' || !windowStart) return {};
  return {min: windowStart.getTime(), max: windowEnd.getTime()};
}

export function buildTimeTicks(min: number, max: number, range: RangePreset): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const ticks: number[] = [];
  const cursor = new Date(min);
  if (range === '24h') {
    const hour = cursor.getHours();
    cursor.setHours(hour - (hour % 4), 0, 0, 0);
    if (cursor.getTime() < min) cursor.setHours(cursor.getHours() + 4);
    while (cursor.getTime() <= max && ticks.length < 12) {
      ticks.push(cursor.getTime());
      cursor.setHours(cursor.getHours() + 4);
    }
    return ticks;
  }
  cursor.setHours(0, 0, 0, 0);
  if (cursor.getTime() < min) cursor.setDate(cursor.getDate() + 1);
  const stepDays = tickStepDays(range, max - min);
  while (cursor.getTime() <= max && ticks.length < 12) {
    ticks.push(cursor.getTime());
    cursor.setDate(cursor.getDate() + stepDays);
  }
  return ticks;
}

function tickStepDays(range: RangePreset, spanMs: number): number {
  if (range === '5d') return 1;
  if (range === '30d') return 5;
  if (range === '90d') return 14;
  const day = 24 * 60 * 60 * 1000;
  if (spanMs <= 16 * day) return 1;
  if (spanMs <= 90 * day) return 7;
  if (spanMs <= 400 * day) return 30;
  return 90;
}

function formatTickMs(ms: number, range: RangePreset): string {
  const d = new Date(ms);
  if (range === '24h') {
    return d.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'});
  }
  if (range === '5d') {
    return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
  }
  return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

function formatTooltipTime(ms: number, kind: 'line' | 'bar'): string {
  const d = new Date(ms);
  if (kind === 'bar') {
    return d.toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric'});
  }
  return d.toLocaleString(undefined, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
}

export interface SleepTooltipItem {
  parsed: {x?: number, y?: number | null}
  dataset: {label?: string, data?: unknown}
  chart?: {data?: {datasets?: {label?: string, data?: unknown}[]}}
}

export function sleepAsleepTotal(items: SleepTooltipItem[]): number {
  if (!items.length) return 0;
  const x = items[0].parsed.x;
  const datasets = items[0].chart?.data?.datasets;
  if (datasets?.length && x != null) {
    let total = 0;
    for (const dataset of datasets) {
      if (!isAsleepStageLabel(dataset.label)) continue;
      const points = (dataset.data || []) as {x?: number, y?: number}[];
      const match = points.find((point) => point && point.x === x);
      if (match?.y != null) total += match.y;
    }
    return total;
  }
  return items.reduce((sum, item) => {
    if (!isAsleepStageLabel(item.dataset.label) || item.parsed.y == null) return sum;
    return sum + item.parsed.y;
  }, 0);
}

function defaultChartOptions(
  kind: 'line' | 'bar',
  unit: string,
  args: {stacked?: boolean, range: RangePreset, windowStart: Date | null, windowEnd: Date},
): ChartConfiguration['options'] {
  const stacked = !!args.stacked;
  const bounds = timeAxisBounds(args.range, args.windowStart, args.windowEnd);
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: stacked
      ? {mode: 'index', intersect: false}
      : {mode: 'nearest', axis: 'x', intersect: false},
    plugins: {
      legend: {display: kind === 'bar' ? stacked : true, position: 'bottom'},
      tooltip: {
        callbacks: {
          title: (items) => {
            const x = items[0]?.parsed?.x;
            if (x == null || Number.isNaN(x)) return '';
            return formatTooltipTime(x, kind);
          },
          label: (ctx) => {
            const value = ctx.parsed.y;
            if (value == null || Number.isNaN(value)) return ctx.dataset.label || '';
            const suffix = unit ? ` ${unit}` : '';
            if (unit === 'st') {
              return `${ctx.dataset.label}: ${formatStoneFromDecimal(value)}`;
            }
            const formatted = (unit === 'hours' || unit === 'kg' || unit === 'lbs')
              ? value.toFixed(1)
              : String(value);
            return `${ctx.dataset.label}: ${formatted}${suffix}`;
          },
          footer: (items) => {
            if (!stacked || unit !== 'hours' || !items.length) return '';
            const total = sleepAsleepTotal(items);
            if (total <= 0) return '';
            return `Total asleep: ${total.toFixed(1)} hours`;
          },
        },
      },
    },
    scales: {
      x: {
        type: 'linear',
        ...(bounds.min != null ? {min: bounds.min} : {}),
        ...(bounds.max != null ? {max: bounds.max} : {}),
        grid: {display: false},
        ticks: {
          maxRotation: 0,
          autoSkip: false,
          callback: (value) => formatTickMs(Number(value), args.range),
        },
        afterBuildTicks: (axis) => {
          const ticks = buildTimeTicks(axis.min, axis.max, args.range);
          if (ticks.length) axis.ticks = ticks.map((value) => ({value}));
        },
      },
      y: {
        beginAtZero: kind === 'bar',
        stacked,
        title: {display: !!unit, text: unit},
        grid: {color: 'rgba(0,0,0,0.06)'},
      },
    },
    elements: {line: {borderWidth: 2}, point: {hitRadius: 8}},
  };
}

function convertStats(
  stats: HealthSeries['stats'],
  def: MetricDef,
  weightUnit: WeightUnit,
): {min?: number, max?: number, avg?: number} | null {
  if (!stats) return null;
  const convert = (v: number) => {
    if (def.id === 'body_mass') return kgToWeightUnit(v, weightUnit);
    if (def.id === 'oxygen_saturation') return asPercent(v);
    return v;
  };
  if (def.id !== 'body_mass' && def.id !== 'oxygen_saturation') return stats;
  return {
    min: stats.min != null ? convert(stats.min) : undefined,
    max: stats.max != null ? convert(stats.max) : undefined,
    avg: stats.avg != null ? convert(stats.avg) : undefined,
  };
}

function toTableRows(def: MetricDef, samples: HealthSample[], weightUnit: WeightUnit = 'kg'): TableRow[] {
  if (def.viz === 'dual-line') {
    return samples.map((sample) => {
      const sys = sample.components?.find((c) => c.code === LOINC_BP_SYS)?.value
        ?? (sample.metric_type === 'blood_pressure_systolic' ? sample.value_num : undefined);
      const dia = sample.components?.find((c) => c.code === LOINC_BP_DIA)?.value
        ?? (sample.metric_type === 'blood_pressure_diastolic' ? sample.value_num : undefined);
      return {
        time: sample.start_time,
        value: `${sys != null ? Math.round(sys) : '—'} / ${dia != null ? Math.round(dia) : '—'}`,
        unit: 'mmHg',
        source: sample.device_name || sample.source_name || '',
      };
    }).sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  }
  return samples.map((sample) => {
    if (def.id === 'body_mass' && sample.value_num != null) {
      if (weightUnit === 'st') {
        return {
          time: sample.start_time,
          value: formatWeight(sample.value_num, 'st'),
          unit: '',
          source: sample.device_name || sample.source_name || '',
        };
      }
      return {
        time: sample.start_time,
        value: kgToWeightUnit(sample.value_num, weightUnit).toFixed(1),
        unit: weightUnitLabel(weightUnit),
        source: sample.device_name || sample.source_name || '',
      };
    }
    const displayValue = def.id === 'oxygen_saturation' && sample.value_num != null
      ? asPercent(sample.value_num)
      : sample.value_num;
    return {
      time: sample.start_time,
      value: displayValue != null
        ? (Number.isInteger(displayValue) ? String(displayValue) : displayValue.toFixed(1))
        : (SLEEP_STAGE_LABELS[sample.value_text] || sample.value_text || ''),
      unit: displayUnit(def, sample.unit, weightUnit),
      source: sample.device_name || sample.source_name || '',
    };
  });
}
