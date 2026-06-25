import {ComponentFixture, TestBed} from '@angular/core/testing';
import {of} from 'rxjs';

import {MedicalConcernsComponent} from './medical-concerns.component';
import {FastenApiService} from '../../services/fasten-api.service';
import {ClassifiedCondition} from '../../models/fasten/classified-condition';

function concern(p: Partial<ClassifiedCondition>): ClassifiedCondition {
  return {
    sourceResourceType: 'Condition',
    sourceResourceId: p.title || 'r',
    sourceId: 's',
    title: 'Condition',
    category: 'problem-list-item',
    tier: 'clinician',
    state: 'Active',
    selfReported: false,
    ...p,
  } as ClassifiedCondition;
}

describe('MedicalConcernsComponent', () => {
  let component: MedicalConcernsComponent;
  let fixture: ComponentFixture<MedicalConcernsComponent>;
  let api: jasmine.SpyObj<FastenApiService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj('FastenApiService', ['getReconciledConditions']);
    api.getReconciledConditions.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [MedicalConcernsComponent],
      providers: [{provide: FastenApiService, useValue: api}],
    }).compileComponents();

    fixture = TestBed.createComponent(MedicalConcernsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates and loads concerns on init', () => {
    expect(component).toBeTruthy();
    expect(api.getReconciledConditions).toHaveBeenCalled();
    expect(component.loading).toBeFalse();
  });

  it('keeps only active problem-list-items, excluding Patient Profile and refuted', () => {
    api.getReconciledConditions.and.returnValue(of([
      concern({title: 'Diabetes', category: 'problem-list-item', state: 'Active'}),
      concern({title: 'Employment', category: 'sdoh', state: 'Active'}),
      concern({title: 'Refuted', category: 'problem-list-item', state: 'RuledOut'}),
      concern({title: 'PastProblem', category: 'problem-list-item', state: 'Resolved'}),
    ]));
    component.ngOnInit();
    expect(component.filtered.map((c) => c.title)).toEqual(['Diabetes']);

    component.toggleActiveOnly(); // All → include the resolved past problem (still excludes profile + refuted)
    expect(component.filtered.map((c) => c.title).sort()).toEqual(['Diabetes', 'PastProblem']);
  });

  it('flags self-reported concerns with a badge and a "Reported by" line', () => {
    api.getReconciledConditions.and.returnValue(of([
      concern({title: 'Anxiety', selfReported: true, provenance: {kind: 'self-reported', display: 'Self-reported', level: 1}}),
    ]));
    component.ngOnInit();
    component.toggleExpanded(component.rowKey(component.filtered[0]));
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.concern-row .badge-info')?.textContent).toContain('Self-reported');
    expect(el.textContent).toContain('Reported by');
  });

  it('builds a MedlinePlus Connect link from an ICD-10-CM code, preferring it over SNOMED', () => {
    const url = component.medlinePlusUrl(concern({
      title: 'Type 2 diabetes',
      standardCodings: [
        {system: 'http://snomed.info/sct', code: '44054006', display: 'DM2'},
        {system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'E11.9', display: 'Type 2 diabetes'},
      ],
    }))!;
    expect(url).toContain('connect.medlineplus.gov/application');
    expect(url).toContain('2.16.840.1.113883.6.90'); // ICD-10-CM OID
    expect(url).toContain('E11.9');
  });

  it('returns null for a Connect link when no supported code is present', () => {
    expect(component.medlinePlusUrl(concern({title: 'X', standardCodings: []}))).toBeNull();
  });

  it('always builds a MedlinePlus name-search link', () => {
    expect(component.medlinePlusSearchUrl(concern({title: 'Asthma'}))).toBe(
      'https://medlineplus.gov/search/?query=Asthma'
    );
  });
});
