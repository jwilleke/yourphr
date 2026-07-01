import {ComponentFixture, TestBed} from '@angular/core/testing';
import {of} from 'rxjs';
import {RouterTestingModule} from '@angular/router/testing';

import {CurrentMedicationsComponent} from './current-medications.component';
import {FastenApiService} from '../../services/fasten-api.service';
import {ReconciledMedication} from '../../models/fasten/reconciled-medication';

function med(partial: Partial<ReconciledMedication>): ReconciledMedication {
  return {key: partial.title || 'k', title: 'Drug', state: 'Unknown', ...partial} as ReconciledMedication;
}

describe('CurrentMedicationsComponent', () => {
  let component: CurrentMedicationsComponent;
  let fixture: ComponentFixture<CurrentMedicationsComponent>;
  let api: jasmine.SpyObj<FastenApiService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj('FastenApiService', ['getReconciledMedications']);
    api.getReconciledMedications.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [CurrentMedicationsComponent, RouterTestingModule],
      providers: [{provide: FastenApiService, useValue: api}],
    }).compileComponents();

    fixture = TestBed.createComponent(CurrentMedicationsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates and loads medications on init', () => {
    expect(component).toBeTruthy();
    expect(api.getReconciledMedications).toHaveBeenCalled();
    expect(component.loading).toBeFalse();
  });

  it('filters to Active only when toggled', () => {
    component.medications = [med({title: 'A', state: 'Active'}), med({title: 'B', state: 'Past'})];
    component.toggleActiveOnly();
    expect(component.filtered.length).toBe(1);
    expect(component.filtered[0].title).toBe('A');
  });

  it('sorts undated rows to the bottom under the default newest-first order', () => {
    component.medications = [
      med({title: 'Undated'}),
      med({title: 'Newer', lastActivity: '2026-05-01'}),
      med({title: 'Older', lastActivity: '2025-01-01'}),
    ];
    (component as any).applyView();
    expect(component.filtered.map((m) => m.title)).toEqual(['Newer', 'Older', 'Undated']);
  });

  it('toggling a sort column flips direction', () => {
    component.sortBy('title');
    expect(component.sortColumn).toBe('title');
    expect(component.sortDirection).toBe('asc');
    component.sortBy('title');
    expect(component.sortDirection).toBe('desc');
  });

  it('builds a MedlinePlus link only when an RxNorm code is present', () => {
    expect(component.medlinePlusUrl(med({title: 'X'}))).toBeNull();
    const url = component.medlinePlusUrl(med({title: 'Lisinopril', rxNormCode: '314076'}));
    expect(url).toContain('connect.medlineplus.gov/application');
    expect(url).toContain('2.16.840.1.113883.6.88');
    expect(url).toContain('314076');
  });

  it('builds a DailyMed link from the simplified ingredient name (strips dose/form)', () => {
    // Full RxNorm strings do not match DailyMed search; the simplified ingredient name does.
    expect(component.dailyMedUrl(med({title: 'Omeprazole 20 MG Delayed Release Oral Capsule'}))).toBe(
      'https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=Omeprazole'
    );
    expect(component.dailyMedUrl(med({title: 'Amoxicillin 250 MG / Clavulanate 125 MG Oral Tablet'}))).toBe(
      'https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=' + encodeURIComponent('Amoxicillin / Clavulanate')
    );
  });

  it('falls back to the raw title if simplification empties it', () => {
    expect(component.simplifyDrugName('Amoxicillin 250 MG / Clavulanate 125 MG Oral Tablet'))
      .toBe('Amoxicillin / Clavulanate');
    expect(component.dailyMedUrl(med({title: '500 MG'}))).toContain('query=500%20MG');
  });

  it('flags self-reported provenance with a badge and a "Reported by" line', () => {
    component.medications = [
      med({key: 'a', title: 'Zyrtec', state: 'Active', provenance: {kind: 'self-reported', display: 'Self-reported', level: 1}}),
    ];
    (component as any).applyView();
    component.toggleExpanded('a');
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.med-row .badge-info')?.textContent).toContain('Self-reported');
    expect(el.textContent).toContain('Reported by');
  });

  it('renders the resolved attribution for a clinician-sourced row (no self-reported badge)', () => {
    component.medications = [
      med({key: 'b', title: 'Lisinopril', state: 'Active', provenance: {kind: 'practitioner', display: 'Dr. McKinley', level: 1}}),
    ];
    (component as any).applyView();
    component.toggleExpanded('b');
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.med-row .badge-info')).toBeNull();
    expect(el.textContent).toContain('Dr. McKinley');
  });
});
