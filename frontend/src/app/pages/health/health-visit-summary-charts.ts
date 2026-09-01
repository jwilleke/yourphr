/** Inline SVG charts for the clinician visit summary. No libraries; print-safe. */

const CHART_W = 760;
const CHART_H = 130;
const CHART_PAD = 14;
const SPARK_W = 120;
const SPARK_H = 26;
const SPARK_PAD = 3;

const SLEEP_FILL: Record<string, string> = {
  awake: 'rgba(253, 126, 20, 0.85)',
  asleepCore: 'rgba(47, 111, 143, 0.85)',
  asleepDeep: 'rgba(47, 111, 143, 1)',
  asleepREM: 'rgba(47, 111, 143, 0.55)',
  asleepUnspecified: 'rgba(108, 117, 125, 0.7)',
  inBed: 'rgba(173, 181, 189, 0.55)',
};

export function sparklineSvg(values: (number | null)[]): string {
  const pts = plotPoints(values, SPARK_W, SPARK_H, SPARK_PAD);
  if (pts.length === 0) return '';
  const d = polyline(pts);
  const last = pts[pts.length - 1];
  return `<svg class="spark" width="${SPARK_W}" height="${SPARK_H}" viewBox="0 0 ${SPARK_W} ${SPARK_H}" aria-hidden="true">` +
    `<path d="${d}" fill="none" stroke="var(--data)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="2.2" fill="var(--data)"/>` +
    `</svg>`;
}

export function lineChartSvg(values: (number | null)[]): string {
  const pts = plotPoints(values, CHART_W, CHART_H, CHART_PAD);
  if (pts.length === 0) return '';
  const d = polyline(pts);
  const first = pts[0];
  const last = pts[pts.length - 1];
  const baseline = (CHART_H - CHART_PAD).toFixed(1);
  const area = `M${first.x.toFixed(1)} ${baseline} ` +
    pts.map((p) => `L${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') +
    ` L${last.x.toFixed(1)} ${baseline} Z`;
  return chartWrap(
    `<line x1="0" y1="${baseline}" x2="${CHART_W}" y2="${baseline}" stroke="var(--rule)" stroke-width="1"/>` +
    `<path d="${area}" fill="var(--data-fill)" stroke="none"/>` +
    `<path d="${d}" fill="none" stroke="var(--data)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`,
  );
}

export function bandChartSvg(
  low: (number | null)[],
  high: (number | null)[],
  avg: (number | null)[],
): string {
  const n = Math.max(low.length, high.length, avg.length);
  if (n === 0) return '';
  const all: number[] = [];
  for (let i = 0; i < n; i++) {
    if (low[i] != null) all.push(low[i] as number);
    if (high[i] != null) all.push(high[i] as number);
  }
  if (all.length === 0) return '';
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = (max - min) || 1;
  const xy = (v: number, i: number): {x: number, y: number} => ({
    x: CHART_PAD + (n === 1 ? (CHART_W - 2 * CHART_PAD) / 2 : (i / (n - 1)) * (CHART_W - 2 * CHART_PAD)),
    y: CHART_PAD + (1 - (v - min) / span) * (CHART_H - 2 * CHART_PAD),
  });
  const hp: {x: number, y: number}[] = [];
  const lp: {x: number, y: number}[] = [];
  const ap: {x: number, y: number}[] = [];
  for (let i = 0; i < n; i++) {
    if (high[i] != null) hp.push(xy(high[i] as number, i));
    if (low[i] != null) lp.push(xy(low[i] as number, i));
    if (avg[i] != null) ap.push(xy(avg[i] as number, i));
  }
  if (hp.length === 0 || lp.length === 0) return lineChartSvg(avg);
  const band = polyline(hp) + ' ' + lp.slice().reverse().map((p) => `L${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ' Z';
  const avgLine = ap.length ? polyline(ap) : '';
  return chartWrap(
    `<path d="${band}" fill="var(--data-fill)" stroke="none"/>` +
    (avgLine ? `<path d="${avgLine}" fill="none" stroke="var(--data)" stroke-width="2" stroke-linejoin="round"/>` : ''),
  );
}

export function barChartSvg(values: (number | null)[]): string {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length === 0) return '';
  const max = Math.max(...nums, 0);
  const span = max || 1;
  const n = values.length;
  const inner = CHART_W - 2 * CHART_PAD;
  const slot = n > 0 ? inner / n : inner;
  const barW = Math.max(2, Math.min(40, slot * 0.7));
  const baseline = CHART_H - CHART_PAD;
  const bars: string[] = [
    `<line x1="0" y1="${baseline.toFixed(1)}" x2="${CHART_W}" y2="${baseline.toFixed(1)}" stroke="var(--rule)" stroke-width="1"/>`,
  ];
  values.forEach((v, i) => {
    if (v == null) return;
    const x = CHART_PAD + slot * i + (slot - barW) / 2;
    const h = (v / span) * (CHART_H - 2 * CHART_PAD);
    const y = baseline - h;
    bars.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h, 0.5).toFixed(1)}" fill="var(--data)"/>`);
  });
  return chartWrap(bars.join(''));
}

export function sleepChartSvg(
  nights: (Record<string, number> | null)[],
  stageOrder: readonly string[],
): string {
  const totals = nights.map((stages) => {
    if (!stages) return 0;
    return stageOrder.reduce((sum, stage) => sum + (stages[stage] || 0), 0);
  });
  const max = Math.max(...totals, 0);
  if (max <= 0) return '';
  const n = nights.length;
  const inner = CHART_W - 2 * CHART_PAD;
  const slot = n > 0 ? inner / n : inner;
  const barW = Math.max(2, Math.min(40, slot * 0.7));
  const baseline = CHART_H - CHART_PAD;
  const parts: string[] = [
    `<line x1="0" y1="${baseline.toFixed(1)}" x2="${CHART_W}" y2="${baseline.toFixed(1)}" stroke="var(--rule)" stroke-width="1"/>`,
  ];
  nights.forEach((stages, i) => {
    if (!stages) return;
    const x = CHART_PAD + slot * i + (slot - barW) / 2;
    let y = baseline;
    for (const stage of stageOrder) {
      const hours = stages[stage] || 0;
      if (hours <= 0) continue;
      const h = (hours / max) * (CHART_H - 2 * CHART_PAD);
      y -= h;
      const fill = SLEEP_FILL[stage] || 'var(--data)';
      parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}"/>`);
    }
  });
  return chartWrap(parts.join(''));
}

function chartWrap(inner: string): string {
  return `<svg viewBox="0 0 ${CHART_W} ${CHART_H}" preserveAspectRatio="none" role="img">${inner}</svg>`;
}

function plotPoints(values: (number | null)[], w: number, h: number, pad: number): {x: number, y: number}[] {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length === 0) return [];
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = (max - min) || 1;
  const n = values.length;
  const out: {x: number, y: number}[] = [];
  values.forEach((v, i) => {
    if (v == null) return;
    const x = n === 1 ? w / 2 : pad + (i / (n - 1)) * (w - 2 * pad);
    const y = pad + (1 - (v - min) / span) * (h - 2 * pad);
    out.push({x, y});
  });
  return out;
}

function polyline(pts: {x: number, y: number}[]): string {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}
