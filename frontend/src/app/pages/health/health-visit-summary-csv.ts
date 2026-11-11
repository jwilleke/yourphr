import {HealthSample} from '../../models/fasten/health-sample';

export const CSV_COLUMNS = [
  'start_time',
  'end_time',
  'code',
  'code_system',
  'category',
  'metric_type',
  'vendor_type',
  'value_num',
  'unit',
  'value_text',
  'components',
  'source_name',
  'device_name',
] as const;

export function buildVisitSummaryCsv(samples: HealthSample[]): string {
  const sorted = [...samples].sort((a, b) => {
    const byTime = Date.parse(a.start_time) - Date.parse(b.start_time);
    if (byTime !== 0) return byTime;
    return (a.code || a.metric_type || '').localeCompare(b.code || b.metric_type || '');
  });
  const lines = [CSV_COLUMNS.join(',')];
  for (const sample of sorted) {
    lines.push(CSV_COLUMNS.map((col) => csvCell(csvValue(sample, col))).join(','));
  }
  return lines.join('\n') + '\n';
}

function csvValue(sample: HealthSample, col: typeof CSV_COLUMNS[number]): string {
  switch (col) {
    case 'start_time': return sample.start_time || '';
    case 'end_time': return sample.end_time || '';
    case 'code': return sample.code || '';
    case 'code_system': return sample.code_system || '';
    case 'category': return sample.category || '';
    case 'metric_type': return sample.metric_type || '';
    case 'vendor_type': return sample.vendor_type || '';
    case 'value_num': return sample.value_num == null ? '' : String(sample.value_num);
    case 'unit': return sample.unit || '';
    case 'value_text': return sample.value_text || '';
    case 'components': return sample.components?.length
      ? sample.components.map((c) => `${c.code}:${c.value}`).join('|')
      : '';
    case 'source_name': return sample.source_name || '';
    case 'device_name': return sample.device_name || '';
  }
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
