import {ComponentFixture, TestBed} from '@angular/core/testing';
import {ClipboardModule} from '@angular/cdk/clipboard';
import {Clipboard} from '@angular/cdk/clipboard';
import {CommonModule} from '@angular/common';

import {RawResourceComponent} from './raw-resource.component';

describe('RawResourceComponent', () => {
  let component: RawResourceComponent;
  let fixture: ComponentFixture<RawResourceComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [RawResourceComponent],
      imports: [CommonModule, ClipboardModule],
    }).compileComponents();

    fixture = TestBed.createComponent(RawResourceComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('raw', {resourceType: 'Condition', id: 'abc'});
    fixture.detectChanges();
  });

  const text = () => (fixture.nativeElement as HTMLElement).textContent;

  // The formatted record is what a patient came for; raw JSON is opt-in.
  it('should start collapsed', () => {
    expect(component.expanded).toBeFalse();
    expect(text()).toContain('Show raw data');
    expect(text()).not.toContain('Copy to clipboard');
  });

  // The wording is the point of #526 — two screens had invented two vocabularies for one feature.
  it('should say "raw data" rather than "debug mode"', () => {
    expect(text()).toContain('Show raw data');
    expect(text().toLowerCase()).not.toContain('debug');
  });

  it('should reveal the resource and the copy button when expanded', () => {
    component.toggle();
    // markForCheck() before detectChanges(): Angular 22's fixture.detectChanges() no longer marks
    // the fixture dirty implicitly, so state mutated directly on the instance (rather than through
    // an input or a DOM event) renders STALE on the first pass and the verification pass then sees
    // it change — reported as NG0100 (yourphr#482).
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();

    expect(text()).toContain('Hide raw data');
    expect(text()).toContain('Copy to clipboard');
    expect(text()).toContain('Condition');
  });

  // Deliberately CDK's Clipboard rather than navigator.clipboard: the async Clipboard API exists
  // only in a secure context, so on a plain-HTTP LAN deployment the button would fail silently.
  it('should copy the resource as formatted JSON through the CDK clipboard', () => {
    const clipboard = TestBed.inject(Clipboard);
    const copy = spyOn(clipboard, 'copy').and.returnValue(true);

    component.copy();

    expect(copy).toHaveBeenCalledWith(JSON.stringify({resourceType: 'Condition', id: 'abc'}, null, 2));
    expect(component.copied).toBeTrue();
  });

  it('should not report success when the copy fails', () => {
    const clipboard = TestBed.inject(Clipboard);
    spyOn(clipboard, 'copy').and.returnValue(false);

    component.copy();

    expect(component.copied).toBeFalse();
  });

  // A record with nothing stored should not offer an empty panel.
  it('should render nothing without a resource', () => {
    fixture.componentRef.setInput('raw', null);
    fixture.detectChanges();

    expect(text()).not.toContain('Show raw data');
  });
});
