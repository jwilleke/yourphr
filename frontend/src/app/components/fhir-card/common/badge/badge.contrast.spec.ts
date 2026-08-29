import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BadgeComponent } from './badge.component';

// Contrast regression guard for yourphr#486.
//
// Five of the theme's seven badge variants shipped below WCAG AA against Bootstrap's default white
// badge text — `light` at 1.09:1 was effectively invisible — and nothing in the toolchain noticed.
// Type checkers, linters, unit tests and code review are all blind to colour, so the bug survived
// until somebody looked at the right screen in the right mode.
//
// This measures COMPUTED styles on real elements rather than parsing CSS text: Karma loads
// src/styles.scss, so the full cascade is in play, including the theme's overrides and whatever a
// future palette change does. It also runs the whole thing again under body.dark-theme.
//
// AA for normal text is 4.5:1. Badges render at 9–10px here, which is well below the 18.66px that
// would let the 3:1 large-text allowance apply, so 4.5 is the correct bar and not a strict reading.
const WCAG_AA_NORMAL_TEXT = 4.5;

/** Parses "rgb(r, g, b)" / "rgba(r, g, b, a)" as returned by getComputedStyle. */
function parseRgb(value: string): { r: number; g: number; b: number; a: number } | null {
  const m = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
}

/** WCAG 2.1 relative luminance. */
function luminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(fg: { r: number; g: number; b: number }, bg: { r: number; g: number; b: number }): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * The effective background behind an element. A transparent background is not "no background" —
 * it means the parent's shows through, which is exactly how a badge with no background-color ends
 * up sitting on a white card. Walking up finds what the eye actually sees.
 */
function effectiveBackground(el: HTMLElement): { r: number; g: number; b: number } {
  let node: HTMLElement | null = el;
  while (node) {
    const parsed = parseRgb(getComputedStyle(node).backgroundColor);
    if (parsed && parsed.a > 0) return parsed;
    node = node.parentElement;
  }
  return { r: 255, g: 255, b: 255 }; // the page default
}

describe('BadgeComponent contrast (yourphr#486)', () => {
  let fixture: ComponentFixture<BadgeComponent>;
  let component: BadgeComponent;

  // Every status the component maps explicitly, plus an unmapped one for the fallback.
  const statuses = [
    'active', 'inactive', 'resolved', 'relapse', 'remission',
    'in-progress', 'on-hold', 'completed', 'entered-in-error', 'stopped', 'not-done',
    'preparation', 'unknown', 'a-status-nobody-has-mapped', '',
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [BadgeComponent] }).compileComponents();
    fixture = TestBed.createComponent(BadgeComponent);
    component = fixture.componentInstance;
    // Computed styles only resolve for an element in the document.
    document.body.appendChild(fixture.nativeElement);
  });

  afterEach(() => {
    document.body.classList.remove('dark-theme', 'light-theme');
    fixture.nativeElement.remove();
  });

  // The theme is applied by ThemeService as an explicit body class, and the dark rules are written
  // as `body:not(.light-theme)` — so an element with NO class on body is already in dark mode.
  // Setting the class explicitly is not ceremony: without it this test measures dark colours and
  // calls them light.
  function useTheme(mode: 'light' | 'dark'): void {
    document.body.classList.toggle('light-theme', mode === 'light');
    document.body.classList.toggle('dark-theme', mode === 'dark');
  }

  function measure(status: string): { ratio: number; fg: string; bg: string; cls: string } {
    // setInput, not `component.status = ...`. Assigning to an @Input on an already-rendered
    // fixture and calling detectChanges() moves the binding after Angular has checked it, which
    // Angular 22 reports as NG0100 (ExpressionChangedAfterItHasBeenCheckedError). setInput is the
    // supported way to change an input on a fixture: it marks the component dirty first, so the
    // new value is what gets checked rather than a second value discovered mid-cycle.
    fixture.componentRef.setInput('status', status);
    fixture.detectChanges();
    const span: HTMLElement = fixture.nativeElement.querySelector('span');
    const fg = parseRgb(getComputedStyle(span).color);
    const bg = effectiveBackground(span);
    if (!fg) throw new Error(`could not read a colour for status "${status}"`);
    return {
      ratio: contrastRatio(fg, bg),
      fg: `rgb(${fg.r},${fg.g},${fg.b})`,
      bg: `rgb(${bg.r},${bg.g},${bg.b})`,
      cls: span.className,
    };
  }

  it('every status is readable in light mode', () => {
    useTheme('light');
    const failures: string[] = [];
    for (const status of statuses) {
      const { ratio, fg, bg, cls } = measure(status);
      if (ratio < WCAG_AA_NORMAL_TEXT) {
        failures.push(`"${status}" [${cls}] ${fg} on ${bg} = ${ratio.toFixed(2)}:1`);
      }
    }
    expect(failures)
      .withContext(
        `these badges fall below WCAG AA (${WCAG_AA_NORMAL_TEXT}:1) in light mode:\n  ` +
        failures.join('\n  ') +
        '\n\nUse a text-bg-* utility, which pairs a background with a contrast-checked foreground. ' +
        'A bare bg-* sets only the background and leaves Bootstrap\'s white badge text on top of it.'
      )
      .toEqual([]);
  });

  it('every status is readable in dark mode', () => {
    useTheme('dark');
    const failures: string[] = [];
    for (const status of statuses) {
      const { ratio, fg, bg, cls } = measure(status);
      if (ratio < WCAG_AA_NORMAL_TEXT) {
        failures.push(`"${status}" [${cls}] ${fg} on ${bg} = ${ratio.toFixed(2)}:1`);
      }
    }
    expect(failures)
      .withContext(
        `these badges fall below WCAG AA (${WCAG_AA_NORMAL_TEXT}:1) under body.dark-theme:\n  ` +
        failures.join('\n  ')
      )
      .toEqual([]);
  });

  // The theme owns the palette, so a designer retuning $secondary or $light can reintroduce this
  // without touching a single line of TypeScript. This checks the utilities themselves, so the
  // failure lands on whoever changed the colour rather than on the next person to read a badge.
  // Both themes, not just light. The page lists use these utilities directly rather than through
  // the component — `text-bg-light` is what "Unknown" and "RuledOut" resolve to on Allergies,
  // Medical Concerns, Medications and Procedures after the #486 follow-up — and the entire failure
  // mode of that bug was a colour that reads fine in one theme and not the other. Checking one
  // theme is how it shipped twice.
  it('every text-bg-* utility in the theme meets AA, in both themes', () => {
    const variants = ['primary', 'secondary', 'success', 'danger', 'warning', 'info', 'light', 'dark'];
    const probe = document.createElement('span');
    probe.className = 'badge';
    probe.textContent = 'probe';
    document.body.appendChild(probe);

    const failures: string[] = [];
    for (const mode of ['light', 'dark'] as const) {
      useTheme(mode);
      for (const variant of variants) {
        probe.className = `badge text-bg-${variant}`;
        const fg = parseRgb(getComputedStyle(probe).color);
        const bg = effectiveBackground(probe);
        if (!fg) continue;
        const ratio = contrastRatio(fg, bg);
        if (ratio < WCAG_AA_NORMAL_TEXT) {
          failures.push(`${mode}: text-bg-${variant}: rgb(${fg.r},${fg.g},${fg.b}) on rgb(${bg.r},${bg.g},${bg.b}) = ${ratio.toFixed(2)}:1`);
        }
      }
    }
    probe.remove();

    expect(failures)
      .withContext(
        'a theme colour was changed to something its paired foreground can no longer sit on:\n  ' +
        failures.join('\n  ')
      )
      .toEqual([]);
  });
});
