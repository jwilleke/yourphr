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

  it('always builds a DailyMed name-search link', () => {
    expect(component.dailyMedUrl(med({title: 'Omeprazole 20 MG'}))).toBe(
      'https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=Omeprazole%2020%20MG'
    );
  });
});
