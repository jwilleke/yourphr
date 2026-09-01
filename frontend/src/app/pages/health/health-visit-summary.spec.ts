import {CatalogEntry} from './health-metrics';
import {HealthSample, HealthSeries} from '../../models/fasten/health-sample';
import {bandChartSvg, lineChartSvg, sparklineSvg} from './health-visit-summary-charts';
import {buildVisitSummaryCsv} from './health-visit-summary-csv';
import {
  assembleVisitSummary,
  buildVisitSummaryHtml,
  defaultSummarySelection,
  escapeHtml,
  hasSummarySelection,
  namedGaps,
  sampleQueriesFor,
  seriesQueryFor,
  summaryKind,
  visitSummaryCsvFilename,
  visitSummaryFilename,
  visitSummaryWindow,
} from './health-visit-summary';

describe('health visit summary', () => {
  const generatedAt = new Date(2026, 7, 28, 14, 30, 0);

  const hrEntry: CatalogEntry = {
    id: 'heart_rate',
    def: {id: 'heart_rate', label: 'Heart Rate', codes: ['8867-4'], viz: 'line', unit: 'bpm'},
    summaries: [{
      code: '8867-4',
      metric_type: 'heart_rate',
      vendor_type: 'HKQuantityTypeIdentifierHeartRate',
      latest_at: '2026-08-26T12:00:00Z',
      earliest_at: '2026-08-01T00:00:00Z',
      sample_count: 3,
      device_name: 'Apple Watch',
    }],
    latestLabel: '90 bpm',
  };

  const bpEntry: CatalogEntry = {
    id: 'blood_pressure',
    def: {
      id: 'blood_pressure',
      label: 'Blood Pressure',
      codes: ['85354-9'],
      viz: 'dual-line',
      unit: 'mmHg',
    },
    summaries: [{
      code: '85354-9',
      metric_type: 'blood_pressure',
      vendor_type: 'HKCorrelationTypeIdentifierBloodPressure',
      latest_at: '2026-08-26T08:00:00Z',
      earliest_at: '2026-08-01T00:00:00Z',
      sample_count: 2,
      source_name: 'Health',
      components: [
        {code: '8480-6', value: 128, unit: 'mm[Hg]'},
        {code: '8462-4', value: 82, unit: 'mm[Hg]'},
      ],
    }],
    latestLabel: '128/82 mmHg',
  };

  it('names the HTML and CSV files for the local calendar day, without a patient name', () => {
    expect(visitSummaryFilename(generatedAt)).toBe('yourphr-health-20260828.html');
    expect(visitSummaryCsvFilename(generatedAt)).toBe('yourphr-health-20260828.csv');
  });

  it('defaults every catalog metric to selected', () => {
    const selected = defaultSummarySelection([
      {id: 'heart_rate'} as CatalogEntry,
      {id: 'blood_pressure'} as CatalogEntry,
    ]);
    expect(selected).toEqual({heart_rate: true, blood_pressure: true});
    expect(hasSummarySelection(selected)).toBeTrue();
    expect(hasSummarySelection({heart_rate: false, blood_pressure: false})).toBeFalse();
  });

  it('labels a 30-day window from now', () => {
    const now = new Date('2026-08-28T16:00:00.000Z');
    const window = visitSummaryWindow('30d', now);
    expect(window.startAfter).toBe(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString());
    expect(window.startBefore).toBe(now.toISOString());
    expect(window.label).toContain('2026');
    expect(visitSummaryWindow('all', now)).toEqual({start: null, end: now, label: 'All time'});
  });

  it('classifies heart rate as a band chart and blood pressure as a reading table', () => {
    expect(summaryKind(hrEntry.def)).toBe('band');
    expect(summaryKind(bpEntry.def)).toBe('readings');
    expect(seriesQueryFor(hrEntry)).toEqual({codes: ['8867-4'], vendorType: undefined, mode: 'daily-stats'});
    expect(seriesQueryFor(bpEntry)).toBeNull();
    expect(sampleQueriesFor([hrEntry, bpEntry])).toEqual([{
      codes: ['8867-4', '85354-9'],
    }]);
  });

  it('names contiguous missing days', () => {
    expect(namedGaps(['2026-08-14', '2026-08-15', '2026-08-16'])).toContain('3-day gap');
    expect(namedGaps(['2026-08-14', '2026-08-15', '2026-08-16'])).toContain('Aug');
    expect(namedGaps([])).toBeUndefined();
  });

  it('assembles a glance row, HR band SVG, and BP reading table without typical-range flags', () => {
    const window = visitSummaryWindow('5d', new Date('2026-08-27T00:00:00Z'));
    const hrSeries: HealthSeries = {
      total: 3,
      downsampled: false,
      stats: {min: 70, max: 90, avg: 80},
      daily: [
        {date: '2026-08-24', value: 75, min: 70, max: 80, n: 2},
        {date: '2026-08-26', value: 90, min: 90, max: 90, n: 1},
      ],
    };
    const samples: HealthSample[] = [
      bpSample('bp-1', 128, 82, '2026-08-26T08:00:00Z'),
    ];
    const model = assembleVisitSummary({
      generatedAt,
      window,
      lastSyncedAt: '2026-08-26T12:10:00Z',
      patient: {name: 'Ada <script>', birthDate: '1935-12-10'},
      selected: [hrEntry, bpEntry],
      seriesById: {heart_rate: hrSeries},
      samples,
      weightUnit: 'kg',
      csvFilename: 'yourphr-health-20260828.csv',
    });
    expect(model.patientAge).toBe(90);
    expect(model.glance.map((row) => row.id)).toEqual(['heart_rate', 'blood_pressure']);
    expect(model.glance[0].latest).toContain('70');
    expect(model.glance[0].latest).toContain('90');
    expect(model.glance[1].latest).toBe('128/82');
    expect(model.sections[0].chartSvg).toContain('<svg');
    expect(model.sections[1].readingHeaders).toEqual(['Date & time', 'Systolic', 'Diastolic']);
    expect(model.sections[1].readings?.length).toBe(1);
    expect(model.provenance.devices).toContain('Apple Watch');

    const html = buildVisitSummaryHtml(model);
    expect(html).toContain('Health summary');
    expect(html).toContain('At a glance');
    expect(html).toContain('Ada &lt;script&gt;');
    expect(html).not.toContain('Ada <script>');
    expect(html).toContain('Born');
    expect(html).toContain('1935-12-10');
    expect(html).toContain('Wearable devices');
    expect(html).toContain('yourphr-health-20260828.csv');
    expect(html).toContain('page-break-inside: avoid');
    expect(html).toContain('Systolic');
    expect(html).toContain('128');
    expect(html).toContain('Sampling');
    expect(html).not.toContain('Above typical');
    expect(html).not.toContain('Typical range');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('<img');
  });

  it('renders an empty series as a note rather than a broken image', () => {
    const html = buildVisitSummaryHtml({
      generatedAt,
      windowLabel: 'All time',
      provenance: emptyProvenance(),
      glance: [],
      sections: [{
        id: 'heart_rate',
        label: 'Heart Rate',
        spec: 'bpm',
        latestLabel: '',
        stats: [],
        sampleCount: 0,
        quality: '',
        empty: true,
      }],
      csvFilename: 'yourphr-health-20260828.csv',
    });
    expect(html).toContain('No samples in this time range.');
    expect(html).not.toContain('<img');
  });

  it('renders a failed series as a note rather than a broken image', () => {
    const html = buildVisitSummaryHtml({
      generatedAt,
      windowLabel: 'All time',
      provenance: emptyProvenance(),
      glance: [],
      sections: [{
        id: 'heart_rate',
        label: 'Heart Rate',
        spec: '',
        latestLabel: '',
        stats: [],
        sampleCount: 0,
        quality: '',
        error: true,
      }],
      csvFilename: 'yourphr-health-20260828.csv',
    });
    expect(html).toContain('This metric could not be loaded.');
  });

  it('escapes names in titles', () => {
    expect(escapeHtml('a <b> & "c"')).toBe('a &lt;b&gt; &amp; &quot;c&quot;');
  });

  it('writes a timestamped CSV of every sample, sorted ascending', () => {
    const csv = buildVisitSummaryCsv([
      {
        id: '2',
        external_uuid: 'b',
        vendor_type: 'HKQuantityTypeIdentifierHeartRate',
        metric_type: 'heart_rate',
        start_time: '2026-08-26T11:00:00Z',
        end_time: '2026-08-26T11:00:00Z',
        value_num: 90,
        unit: 'count/min',
        source_name: 'Apple Watch, "S9"',
      },
      {
        id: '1',
        external_uuid: 'a',
        vendor_type: 'HKQuantityTypeIdentifierHeartRate',
        metric_type: 'heart_rate',
        start_time: '2026-08-24T10:00:00Z',
        end_time: '2026-08-24T10:00:00Z',
        value_num: 70,
        unit: 'count/min',
        source_name: 'Apple Watch',
      },
    ]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('start_time,end_time,code,code_system,category,metric_type,vendor_type,value_num,unit,value_text,components,source_name,device_name');
    expect(lines[1]).toContain('2026-08-24T10:00:00Z');
    expect(lines[1]).toContain('70');
    expect(lines[2]).toContain('2026-08-26T11:00:00Z');
    expect(lines[2]).toContain('"Apple Watch, ""S9"""');
  });

  it('draws a sparkline and a band chart from daily values', () => {
    expect(sparklineSvg([65, null, 63])).toContain('<path');
    expect(sparklineSvg([null, null])).toBe('');
    expect(lineChartSvg([65, 66, 63])).toContain('viewBox');
    const band = bandChartSvg([50, 52], [140, 141], [95, 96]);
    expect(band).toContain('<path');
    expect(band).toContain('var(--data-fill)');
  });
});

function bpSample(
  id: string,
  sys: number,
  dia: number,
  start: string,
): HealthSample {
  return {
    id,
    external_uuid: id,
    vendor_type: 'HKCorrelationTypeIdentifierBloodPressure',
    metric_type: 'blood_pressure',
    code: '85354-9',
    start_time: start,
    end_time: start,
    unit: 'mm[Hg]',
    components: [
      {code: '8480-6', value: sys, unit: 'mm[Hg]'},
      {code: '8462-4', value: dia, unit: 'mm[Hg]'},
    ],
  };
}

function emptyProvenance() {
  return {
    devices: 'not recorded',
    deviceNote: 'consumer-grade',
    daysRecorded: 0,
    daysInWindow: 0,
    lastSyncedLabel: 'not recorded',
    lastSyncedNote: 'companion has not synced',
  };
}
