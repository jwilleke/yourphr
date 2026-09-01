import {ComponentFixture, fakeAsync, TestBed, tick} from '@angular/core/testing';
import {provideZoneChangeDetection} from '@angular/core';
import {of, throwError} from 'rxjs';
import {NgbModal} from '@ng-bootstrap/ng-bootstrap';
import {buildTimeTicks, HealthComponent, RANGE_MS, sleepAsleepTotal, timeAxisBounds, toDayPoints, toTimePoints, utcDayMs} from './health.component';
import {FastenApiService} from '../../services/fasten-api.service';
import {HealthMetricSummary} from '../../models/fasten/health-sample';

describe('HealthComponent', () => {
  let component: HealthComponent;
  let fixture: ComponentFixture<HealthComponent>;
  let mockApi: jasmine.SpyObj<FastenApiService>;
  let viewport: HealthViewport;

  const hr: HealthMetricSummary = {
    code: '8867-4',
    metric_type: 'heart_rate',
    vendor_type: 'HKQuantityTypeIdentifierHeartRate',
    unit: '/min',
    value_num: 72,
    latest_at: '2026-08-24T12:00:00Z',
    earliest_at: '2026-08-01T00:00:00Z',
    sample_count: 40,
    source_name: 'Apple Watch',
  };
  const bp: HealthMetricSummary = {
    code: '85354-9',
    metric_type: 'blood_pressure',
    vendor_type: 'HKCorrelationTypeIdentifierBloodPressure',
    unit: 'mm[Hg]',
    latest_at: '2026-08-24T08:00:00Z',
    earliest_at: '2026-08-01T00:00:00Z',
    sample_count: 4,
    components: [
      {code: '8480-6', value: 118, unit: 'mm[Hg]'},
      {code: '8462-4', value: 76, unit: 'mm[Hg]'},
    ],
  };

  beforeEach(async () => {
    localStorage.removeItem('yourphr.health.weightUnit');
    viewport = installHealthViewport(false);
    mockApi = jasmine.createSpyObj('FastenApiService', ['getHealthMetrics', 'getHealthSeries', 'listHealthSamples', 'getResources']);
    mockApi.getHealthMetrics.and.returnValue(of({
      last_synced_at: '2026-08-24T12:10:00Z',
      metrics: [hr, bp],
    }));
    mockApi.getResources.and.returnValue(of([]));
    mockApi.getHealthSeries.and.returnValue(of({
      metric_type: 'heart_rate',
      unit: 'count/min',
      total: 2,
      downsampled: false,
      points: [
        {t: '2026-08-24T10:00:00Z', v: 70},
        {t: '2026-08-24T11:00:00Z', v: 80},
      ],
      stats: {min: 70, max: 80, avg: 75},
    }));
    mockApi.listHealthSamples.and.returnValue(of({
      total: 1,
      count: 1,
      offset: 0,
      samples: [{
        id: '1',
        external_uuid: 'hr-1',
        vendor_type: 'HKQuantityTypeIdentifierHeartRate',
        metric_type: 'heart_rate',
        start_time: '2026-08-24T11:00:00Z',
        end_time: '2026-08-24T11:00:00Z',
        value_num: 80,
        unit: 'count/min',
        source_name: 'Apple Watch',
      }],
    }));

    await TestBed.configureTestingModule({
      imports: [HealthComponent],
      providers: [
        provideZoneChangeDetection(),
        {provide: FastenApiService, useValue: mockApi},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HealthComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('lists grouped metrics and defaults to a 5-day chart of the first metric', () => {
    expect(component.entries.map((e) => e.id)).toEqual(['heart_rate', 'blood_pressure']);
    expect(component.selectedId).toBe('heart_rate');
    expect(component.range).toBe('5d');
    expect(component.view).toBe('chart');
    expect(component.hasChartData).toBeTrue();
    expect(component.narrow).toBeFalse();
    expect(component.detailOpen).toBeFalse();
    expect(mockApi.getHealthSeries).toHaveBeenCalled();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Heart Rate');
    expect(el.textContent).toContain('Blood Pressure');
    expect(el.textContent).toContain('118/76 mmHg');
  });

  it('keeps wide selection in place without a history entry', () => {
    spyOn(history, 'pushState');
    component.selectMetric('blood_pressure');
    expect(component.selectedId).toBe('blood_pressure');
    expect(component.detailOpen).toBeFalse();
    expect(history.pushState).not.toHaveBeenCalled();
    expect(layoutOf(fixture).classList.contains('show-detail')).toBeFalse();
  });

  it('shows only the metric menu on a narrow screen until a row is tapped', () => {
    remountNarrow();
    expect(component.narrow).toBeTrue();
    expect(component.selectedId).toBe('');
    expect(component.detailOpen).toBeFalse();
    expect(mockApi.getHealthSeries).not.toHaveBeenCalled();
    expect(layoutOf(fixture).classList.contains('show-detail')).toBeFalse();
    expect(fixture.nativeElement.querySelector('.health-metric-chevron')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Heart Rate');
    expect(fixture.nativeElement.querySelector('.health-detail')).toBeNull();
  });

  it('slides to a metric and returns to the menu on back, including the same metric', () => {
    remountNarrow();
    spyOn(history, 'pushState').and.stub();
    spyOn(history, 'back').and.callFake(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    component.selectMetric('heart_rate');
    fixture.detectChanges();
    expect(component.detailOpen).toBeTrue();
    expect(component.selectedId).toBe('heart_rate');
    expect(history.pushState).toHaveBeenCalledTimes(1);
    expect(mockApi.getHealthSeries).toHaveBeenCalled();
    expect(layoutOf(fixture).classList.contains('show-detail')).toBeTrue();
    expect(fixture.nativeElement.querySelector('.health-back')).toBeTruthy();

    const seriesCalls = mockApi.getHealthSeries.calls.count();
    component.closeDetail();
    fixture.detectChanges();
    expect(history.back).toHaveBeenCalled();
    expect(component.detailOpen).toBeFalse();
    expect(layoutOf(fixture).classList.contains('show-detail')).toBeFalse();

    component.selectMetric('heart_rate');
    fixture.detectChanges();
    expect(component.detailOpen).toBeTrue();
    expect(history.pushState).toHaveBeenCalledTimes(2);
    expect(mockApi.getHealthSeries.calls.count()).toBe(seriesCalls);
  });

  it('returns to the menu when a wide layout becomes narrow, and restores a drilled-in metric', () => {
    viewport.emit(true);
    fixture.detectChanges();
    expect(component.narrow).toBeTrue();
    expect(component.detailOpen).toBeFalse();
    expect(component.selectedId).toBe('heart_rate');

    viewport.emit(false);
    fixture.detectChanges();
    expect(component.narrow).toBeFalse();
    expect(layoutOf(fixture).classList.contains('show-detail')).toBeFalse();

    remountNarrow();
    spyOn(history, 'pushState').and.stub();
    component.selectMetric('blood_pressure');
    viewport.emit(false);
    fixture.detectChanges();
    expect(component.narrow).toBeFalse();
    expect(component.selectedId).toBe('blood_pressure');
    expect(layoutOf(fixture).classList.contains('show-detail')).toBeFalse();

    viewport.emit(true);
    fixture.detectChanges();
    expect(component.narrow).toBeTrue();
    expect(component.detailOpen).toBeTrue();
    expect(component.selectedId).toBe('blood_pressure');
    expect(layoutOf(fixture).classList.contains('show-detail')).toBeTrue();
  });

  it('charts the first metric when a narrow menu is widened before a row is tapped', () => {
    remountNarrow();
    expect(mockApi.getHealthSeries).not.toHaveBeenCalled();
    viewport.emit(false);
    fixture.detectChanges();
    expect(component.narrow).toBeFalse();
    expect(component.selectedId).toBe('heart_rate');
    expect(mockApi.getHealthSeries).toHaveBeenCalled();
    expect(component.detailOpen).toBeFalse();
  });

  it('enables Prepare visit summary when metrics exist', () => {
    const button = prepareButton(fixture);
    expect(button).toBeTruthy();
    expect(button.disabled).toBeFalse();
  });

  it('disables Prepare visit summary when the catalog is empty', () => {
    mockApi.getHealthMetrics.and.returnValue(of({metrics: []}));
    fixture = TestBed.createComponent(HealthComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    expect(component.entries.length).toBe(0);
    expect(prepareButton(fixture).disabled).toBeTrue();
  });

  it('opens the visit summary with all metrics checked and a 30-day range', () => {
    const modal = fixture.componentRef.injector.get(NgbModal);
    spyOn(modal, 'open');
    component.openVisitSummary();
    expect(modal.open).toHaveBeenCalled();
    expect(component.summaryRange).toBe('30d');
    expect(component.summaryChecks).toEqual({heart_rate: true, blood_pressure: true});
  });

  it('downloads a visit summary for the selected metrics', fakeAsync(() => {
    spyOn(URL, 'createObjectURL').and.returnValue('blob:test');
    spyOn(URL, 'revokeObjectURL');
    const clickSpy = spyOn(HTMLAnchorElement.prototype, 'click');
    mockApi.getHealthSeries.calls.reset();
    mockApi.listHealthSamples.calls.reset();
    mockApi.getHealthSeries.and.returnValue(of({
      metric_type: 'heart_rate',
      unit: 'count/min',
      total: 2,
      downsampled: false,
      daily: [{date: '2026-08-24', value: 75, min: 70, max: 80, n: 2}],
      stats: {min: 70, max: 80, avg: 75},
    }));
    component.summaryChecks = {heart_rate: true, blood_pressure: false};
    component.summaryRange = '30d';
    component.confirmVisitSummary();
    expect(mockApi.getResources).toHaveBeenCalledWith('Patient');
    expect(mockApi.getHealthSeries).toHaveBeenCalled();
    const queries = mockApi.getHealthSeries.calls.allArgs().map((args) => args[0]);
    expect(queries.some((query) => query?.codes?.includes('8867-4') && query?.mode === 'daily-stats')).toBeTrue();
    expect(queries.some((query) => query?.codes?.includes('85354-9'))).toBeFalse();
    expect(mockApi.listHealthSamples).toHaveBeenCalled();
    const sampleQuery = mockApi.listHealthSamples.calls.mostRecent().args[0];
    expect(sampleQuery.codes).toContain('8867-4');
    expect(sampleQuery.sort).toBe('asc');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    tick(300);
    expect(clickSpy).toHaveBeenCalledTimes(2);
    expect(component.summaryBuilding).toBeFalse();
  }));

  it('loads blood pressure for the summary as samples, not a series chart', fakeAsync(() => {
    spyOn(URL, 'createObjectURL').and.returnValue('blob:test');
    spyOn(HTMLAnchorElement.prototype, 'click');
    mockApi.getHealthSeries.calls.reset();
    mockApi.listHealthSamples.calls.reset();
    component.summaryChecks = {heart_rate: false, blood_pressure: true};
    component.summaryRange = '30d';
    component.confirmVisitSummary();
    expect(mockApi.getHealthSeries).not.toHaveBeenCalled();
    expect(mockApi.listHealthSamples).toHaveBeenCalled();
    const codes = mockApi.listHealthSamples.calls.mostRecent().args[0]?.codes || [];
    expect(codes).toContain('85354-9');
    tick(300);
    expect(component.summaryBuilding).toBeFalse();
  }));

  it('loads the table for the same window on request', () => {
    component.setView('table');
    fixture.detectChanges();
    expect(mockApi.listHealthSamples).toHaveBeenCalled();
    expect(component.tableRows.length).toBe(1);
    expect(component.tableRows[0].value).toBe('80');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Apple Watch');
  });

  it('shows an empty state when nothing has been synced', async () => {
    mockApi.getHealthMetrics.and.returnValue(of({metrics: []}));
    fixture = TestBed.createComponent(HealthComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    expect(component.entries.length).toBe(0);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No health data yet');
    expect(prepareButton(fixture).disabled).toBeTrue();
  });

  it('shows an error when the catalog cannot be loaded', () => {
    mockApi.getHealthMetrics.and.returnValue(throwError(() => new Error('boom')));
    fixture = TestBed.createComponent(HealthComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    expect(component.errored).toBeTrue();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Could not load your health data');
  });

  it('converts weight between kg, lbs, and stone without refetching', () => {
    const mass: HealthMetricSummary = {
      code: '29463-7',
      metric_type: 'body_mass',
      vendor_type: 'HKQuantityTypeIdentifierBodyMass',
      unit: 'kg',
      value_num: 81.2,
      latest_at: '2026-08-24T12:00:00Z',
      earliest_at: '2026-08-01T00:00:00Z',
      sample_count: 3,
      source_name: 'iPhone',
    };
    mockApi.getHealthMetrics.and.returnValue(of({
      last_synced_at: '2026-08-24T12:10:00Z',
      metrics: [mass],
    }));
    mockApi.getHealthSeries.and.returnValue(of({
      metric_type: 'body_mass',
      unit: 'kg',
      total: 1,
      downsampled: false,
      points: [{t: '2026-08-24T10:00:00Z', v: 81.2}],
      stats: {min: 81.2, max: 81.2, avg: 81.2},
    }));
    mockApi.listHealthSamples.and.returnValue(of({
      total: 1,
      count: 1,
      offset: 0,
      samples: [{
        id: '1',
        external_uuid: 'wt-1',
        vendor_type: 'HKQuantityTypeIdentifierBodyMass',
        metric_type: 'body_mass',
        start_time: '2026-08-24T10:00:00Z',
        end_time: '2026-08-24T10:00:00Z',
        value_num: 81.2,
        unit: 'kg',
        source_name: 'iPhone',
      }],
    }));

    fixture = TestBed.createComponent(HealthComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(component.selectedId).toBe('body_mass');
    expect(component.selected.latestLabel).toBe('81.2 kg');
    expect(el.textContent).toContain('kg');
    expect(el.textContent).toContain('lbs');
    expect(el.textContent).toContain('stone');

    const seriesCalls = mockApi.getHealthSeries.calls.count();
    component.setWeightUnit('lbs');
    fixture.detectChanges();
    expect(component.selected.latestLabel).toBe('179.0 lbs');
    expect(mockApi.getHealthSeries.calls.count()).toBe(seriesCalls);
    expect((component.chartData.datasets[0].data[0] as {x: number, y: number}).y).toBeCloseTo(179.0, 1);
    expect(localStorage.getItem('yourphr.health.weightUnit')).toBe('lbs');

    component.setWeightUnit('st');
    fixture.detectChanges();
    expect(component.selected.latestLabel).toBe('12 st 11 lb');
    expect(el.textContent).toContain('12 st 11 lb');

    component.setView('table');
    fixture.detectChanges();
    expect(component.tableRows[0].value).toBe('12 st 11 lb');
  });

  it('restores the stored weight unit on load', () => {
    localStorage.setItem('yourphr.health.weightUnit', 'lbs');
    const mass: HealthMetricSummary = {
      code: '29463-7',
      metric_type: 'body_mass',
      vendor_type: 'HKQuantityTypeIdentifierBodyMass',
      unit: 'kg',
      value_num: 81.2,
      latest_at: '2026-08-24T12:00:00Z',
      earliest_at: '2026-08-01T00:00:00Z',
      sample_count: 1,
    };
    mockApi.getHealthMetrics.and.returnValue(of({metrics: [mass]}));
    mockApi.getHealthSeries.and.returnValue(of({
      metric_type: 'body_mass',
      unit: 'kg',
      total: 1,
      downsampled: false,
      points: [{t: '2026-08-24T10:00:00Z', v: 81.2}],
    }));
    fixture = TestBed.createComponent(HealthComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    expect(component.weightUnit).toBe('lbs');
    expect(component.selected.latestLabel).toBe('179.0 lbs');
  });

  it('plots oxygen saturation as a percentage rather than a HealthKit fraction', () => {
    const oxygen: HealthMetricSummary = {
      code: '2708-6',
      metric_type: 'oxygen_saturation',
      vendor_type: 'HKQuantityTypeIdentifierOxygenSaturation',
      unit: '%',
      value_num: 0.97,
      latest_at: '2026-08-24T12:00:00Z',
      earliest_at: '2026-08-01T00:00:00Z',
      sample_count: 2,
    };
    mockApi.getHealthMetrics.and.returnValue(of({metrics: [oxygen]}));
    mockApi.getHealthSeries.and.returnValue(of({
      metric_type: 'oxygen_saturation',
      unit: '%',
      total: 2,
      downsampled: false,
      points: [
        {t: '2026-08-24T10:00:00Z', v: 0.97},
        {t: '2026-08-24T11:00:00Z', v: 0.985},
      ],
      stats: {min: 0.97, max: 0.985, avg: 0.9775},
    }));
    fixture = TestBed.createComponent(HealthComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    expect(component.selected.latestLabel).toBe('97 %');
    const data = component.chartData.datasets[0].data as {x: number, y: number}[];
    expect(data[0].y).toBe(97);
    expect(data[1].y).toBe(98.5);
    expect(component.seriesStats?.min).toBe(97);
    expect(component.seriesStats?.max).toBe(98.5);
  });

  it('spaces sparse samples across the selected time window', () => {
    mockApi.getHealthSeries.and.returnValue(of({
      metric_type: 'heart_rate',
      unit: 'count/min',
      total: 2,
      downsampled: false,
      points: [
        {t: '2026-08-21T12:00:00Z', v: 60},
        {t: '2026-08-25T12:00:00Z', v: 80},
      ],
    }));
    const windowStart = Date.parse('2026-08-21T00:00:00Z');
    component.onSliderInput(String(windowStart));

    const data = component.chartData.datasets[0].data as {x: number, y: number}[];
    expect(data.map((p) => p.x)).toEqual([
      Date.parse('2026-08-21T12:00:00Z'),
      Date.parse('2026-08-25T12:00:00Z'),
    ]);
    expect(data[1].x - data[0].x).toBe(4 * 24 * 60 * 60 * 1000);
    const xScale = component.chartOptions?.scales?.['x'] as {type?: string, min?: number, max?: number};
    expect(xScale.type).toBe('linear');
    expect(xScale.min).toBe(windowStart);
    expect(xScale.max).toBe(windowStart + RANGE_MS['5d']);
  });

  it('places daily bars on the same linear time axis so missing days leave a gap', () => {
    const steps: HealthMetricSummary = {
      code: '55423-8',
      metric_type: 'step_count',
      vendor_type: 'HKQuantityTypeIdentifierStepCount',
      unit: 'count',
      value_num: 4000,
      latest_at: '2026-08-25T12:00:00Z',
      earliest_at: '2026-08-01T00:00:00Z',
      sample_count: 2,
    };
    mockApi.getHealthMetrics.and.returnValue(of({metrics: [steps]}));
    mockApi.getHealthSeries.and.returnValue(of({
      metric_type: 'step_count',
      unit: 'count',
      total: 2,
      downsampled: false,
      daily: [
        {date: '2026-08-21', value: 1000},
        {date: '2026-08-25', value: 4000},
      ],
    }));
    fixture = TestBed.createComponent(HealthComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    const windowStart = Date.parse('2026-08-21T00:00:00Z');
    component.onSliderInput(String(windowStart));

    const data = component.chartData.datasets[0].data as {x: number, y: number}[];
    expect(component.chartType).toBe('bar');
    expect(data[0].x).toBe(utcDayMs('2026-08-21'));
    expect(data[1].x).toBe(utcDayMs('2026-08-25'));
    expect(data[1].x - data[0].x).toBe(4 * 24 * 60 * 60 * 1000);
  });

  function remountNarrow(): void {
    fixture.destroy();
    viewport.setMatches(true);
    mockApi.getHealthSeries.calls.reset();
    fixture = TestBed.createComponent(HealthComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }
});

describe('health chart time helpers', () => {
  it('converts series points to timestamps rather than category indexes', () => {
    const points = toTimePoints([
      {t: '2026-08-21T12:00:00Z', v: 60},
      {t: '2026-08-25T12:00:00Z', v: 80},
    ]);
    expect(points[1].x - points[0].x).toBe(4 * 24 * 60 * 60 * 1000);
    expect(points.map((p) => p.y)).toEqual([60, 80]);
  });

  it('pins the axis to the selected window so empty days still occupy space', () => {
    const start = new Date('2026-08-21T00:00:00Z');
    const end = new Date('2026-08-26T00:00:00Z');
    expect(timeAxisBounds('5d', start, end)).toEqual({min: start.getTime(), max: end.getTime()});
    expect(timeAxisBounds('all', start, end)).toEqual({});
  });

  it('emits one tick per local day in a 5-day window', () => {
    const min = new Date(2026, 7, 21).getTime();
    const max = new Date(2026, 7, 26).getTime();
    const ticks = buildTimeTicks(min, max, '5d');
    expect(ticks).toEqual([
      new Date(2026, 7, 21).getTime(),
      new Date(2026, 7, 22).getTime(),
      new Date(2026, 7, 23).getTime(),
      new Date(2026, 7, 24).getTime(),
      new Date(2026, 7, 25).getTime(),
      new Date(2026, 7, 26).getTime(),
    ]);
  });

  it('places a daily bar at local noon so it sits on that calendar date', () => {
    expect(toDayPoints([{date: '2026-08-21', value: 1000}])).toEqual([
      {x: new Date(2026, 7, 21, 12, 0, 0, 0).getTime(), y: 1000},
    ]);
  });

  it('totals only asleep stages in the sleep tooltip, excluding awake and in-bed', () => {
    const x = utcDayMs('2026-08-21');
    const datasets = [
      {label: 'Awake', data: [{x, y: 0.4}]},
      {label: 'Core', data: [{x, y: 4.2}]},
      {label: 'Deep', data: [{x, y: 1.5}]},
      {label: 'REM', data: [{x, y: 1.8}]},
      {label: 'In bed', data: [{x, y: 8.5}]},
    ];
    expect(sleepAsleepTotal([{
      parsed: {x, y: 4.2},
      dataset: datasets[1],
      chart: {data: {datasets}},
    }])).toBeCloseTo(7.5, 5);
  });
});

interface HealthViewport {
  setMatches(matches: boolean): void
  emit(matches: boolean): void
}

function installHealthViewport(matches: boolean): HealthViewport {
  let current = matches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    get matches() { return current; },
    set matches(value: boolean) { current = value; },
    media: '(max-width: 768px)',
    addEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) => { listeners.add(cb); },
    removeEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) => { listeners.delete(cb); },
    dispatchEvent: () => true,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
  };
  spyOn(window, 'matchMedia').and.returnValue(query as unknown as MediaQueryList);
  return {
    setMatches(next: boolean) { current = next; },
    emit(next: boolean) {
      current = next;
      for (const cb of listeners) cb({matches: next, media: query.media} as MediaQueryListEvent);
    },
  };
}

function layoutOf(fixture: ComponentFixture<HealthComponent>): HTMLElement {
  const layout = (fixture.nativeElement as HTMLElement).querySelector('.health-layout');
  if (!layout) throw new Error('missing health layout');
  return layout as HTMLElement;
}

function prepareButton(fixture: ComponentFixture<HealthComponent>): HTMLButtonElement {
  const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')) as HTMLButtonElement[];
  return buttons.find((button) => (button.textContent || '').includes('Prepare visit summary'));
}
