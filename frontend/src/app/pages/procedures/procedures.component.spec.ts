import {ComponentFixture, TestBed} from '@angular/core/testing';
import {CommonModule} from '@angular/common';
import {of} from 'rxjs';
import {RouterTestingModule} from '@angular/router/testing';

import {ProceduresComponent} from './procedures.component';
import {FastenApiService} from '../../services/fasten-api.service';
import {ProcedureModel} from '../../../lib/models/resources/procedure-model';

// Build a ProcedureModel from a minimal raw Procedure resource.
function proc(raw: any): ProcedureModel {
  const m = new ProcedureModel(raw);
  m.source_id = 's';
  m.source_resource_id = raw.id || raw.code?.text || 'p';
  return m;
}

describe('ProceduresComponent', () => {
  let component: ProceduresComponent;
  let fixture: ComponentFixture<ProceduresComponent>;
  let api: jasmine.SpyObj<FastenApiService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj('FastenApiService', ['getResources']);
    api.getResources.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      declarations: [ProceduresComponent],
      imports: [CommonModule, RouterTestingModule],
      providers: [{provide: FastenApiService, useValue: api}],
    }).compileComponents();

    fixture = TestBed.createComponent(ProceduresComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates and loads procedures on init', () => {
    expect(component).toBeTruthy();
    expect(api.getResources).toHaveBeenCalledWith('Procedure');
    expect(component.loading).toBeFalse();
  });

  it('builds models from the served Procedure resources', () => {
    api.getResources.and.returnValue(of([
      {source_resource_type: 'Procedure', source_id: 's', source_resource_id: 'p1', resource_raw: {resourceType: 'Procedure', code: {text: 'Appendectomy'}}},
    ] as any));
    component.ngOnInit();
    expect(component.filtered.length).toBe(1);
    expect(component.name(component.filtered[0])).toBe('Appendectomy');
  });

  it('groups by the SNOMED category code when present', () => {
    const surgical = proc({code: {text: 'Appendectomy'}, category: {coding: [{code: '387713003', display: 'Surgical procedure'}]}});
    const diagnostic = proc({code: {text: 'Biopsy'}, category: {coding: [{code: '103693007', display: 'Diagnostic procedure'}]}});
    expect(component.categoryLabel(surgical)).toBe('Surgical');
    expect(component.categoryLabel(diagnostic)).toBe('Test / diagnostic');
  });

  it('shows the record-stated category display when the code is not one we group', () => {
    const other = proc({code: {text: 'X'}, category: {coding: [{code: '999999', display: 'Imaging procedure'}]}});
    expect(component.categoryLabel(other)).toBe('Imaging procedure');
  });

  it('shows "Not specified" when there is no category (no guessing)', () => {
    expect(component.categoryLabel(proc({code: {text: 'X'}}))).toBe('Not specified');
  });

  it('sorts newest-first by date, undated rows last', () => {
    component.procedures = [
      proc({id: 'u', code: {text: 'Undated'}}),
      proc({id: 'new', code: {text: 'Newer'}, performedDateTime: '2026-05-01'}),
      proc({id: 'old', code: {text: 'Older'}, performedDateTime: '2024-01-01'}),
    ];
    (component as any).applyView();
    expect(component.filtered.map((p) => component.name(p))).toEqual(['Newer', 'Older', 'Undated']);
  });
});
