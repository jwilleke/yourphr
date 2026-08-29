import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BadgeComponent } from './badge.component';

describe('BadgeComponent', () => {
  let component: BadgeComponent;
  let fixture: ComponentFixture<BadgeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ BadgeComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(BadgeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // yourphr#486: status text was unreadable in both light and dark mode.
  //
  // This theme replaces Bootstrap's .badge rule with one that sets geometry and typography and NO
  // color, so a bg-* class left the text colour inherited from the surrounding row — white in dark
  // mode, and white again on a highlighted row in light mode. text-bg-* carries a contrast colour
  // Bootstrap computes per variant.
  //
  // Asserted as "never a bare bg-*" rather than "equals text-bg-secondary", so this keeps holding
  // if the palette for a given status is retuned later.
  it('never emits a bare bg-* class, which carries no text colour', () => {
    const statuses = [
      'active', 'inactive', 'resolved', 'completed', 'entered-in-error', 'stopped',
      'in-progress', 'not-done', 'unknown', 'preparation', 'on-hold', 'relapse', 'remission',
      '', null, undefined, 'a-status-nobody-has-mapped',
    ];

    for (const status of statuses) {
      const cls = component.getBadgeStatusColor(status);
      expect(cls).withContext(`status "${status}" must resolve to a class`).toBeTruthy();
      expect(cls)
        .withContext(`status "${status}" must not use a bare bg-* (it carries no text colour)`)
        .not.toMatch(/(^|\s)bg-/);
      expect(cls)
        .withContext(`status "${status}" should use a contrast-paired utility`)
        .toMatch(/^text-bg-/);
    }
  });

  it('renders the contrast class alongside the static badge classes', () => {
    // setInput, not `component.status = ...` — beforeEach has already rendered this fixture, so
    // assigning to an @Input and re-running detectChanges moves the binding after Angular checked
    // it, which Angular 22 reports as NG0100 (yourphr#482).
    fixture.componentRef.setInput('status', 'unknown');
    fixture.detectChanges();

    const span: HTMLElement = fixture.nativeElement.querySelector('span');
    expect(span.className).toContain('badge');
    expect(span.className).toContain('text-bg-');
    expect(span.className).not.toMatch(/(^|\s)bg-/);
  });
});
