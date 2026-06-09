import {ComponentFixture, TestBed} from '@angular/core/testing';
import {of, throwError} from 'rxjs';
import {RouterTestingModule} from '@angular/router/testing';
import {HttpClient} from '@angular/common/http';

import {MedicationsWidgetComponent} from './medications-widget.component';
import {FastenApiService} from '../../services/fasten-api.service';
import {HTTP_CLIENT_TOKEN} from '../../dependency-injection';
import {ReconciledMedication} from '../../models/fasten/reconciled-medication';

function med(partial: Partial<ReconciledMedication>): ReconciledMedication {
  return {key: partial.title || 'k', title: 'Drug', state: 'Unknown', ...partial} as ReconciledMedication;
}

describe('MedicationsWidgetComponent', () => {
  let component: MedicationsWidgetComponent;
  let fixture: ComponentFixture<MedicationsWidgetComponent>;
  let api: jasmine.SpyObj<FastenApiService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj('FastenApiService', ['getReconciledMedications']);
    api.getReconciledMedications.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [MedicationsWidgetComponent, RouterTestingModule],
      providers: [
        {provide: FastenApiService, useValue: api},
        {provide: HTTP_CLIENT_TOKEN, useClass: HttpClient},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MedicationsWidgetComponent);
    component = fixture.componentInstance;
  });

  it('creates and loads on init', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
    expect(api.getReconciledMedications).toHaveBeenCalled();
    expect(component.loading).toBeFalse();
  });

  it('shows only Active meds, capped, and is empty when none are active', () => {
    api.getReconciledMedications.and.returnValue(of([
      med({title: 'A', state: 'Active'}),
      med({title: 'B', state: 'Past'}),
    ]));
    fixture.detectChanges();
    expect(component.totalCount).toBe(2);
    expect(component.activeMeds.length).toBe(1);
    expect(component.activeMeds[0].title).toBe('A');
    expect(component.isEmpty).toBeFalse();
  });

  it('is empty when the API errors', () => {
    api.getReconciledMedications.and.returnValue(throwError(() => new Error('boom')));
    fixture.detectChanges();
    expect(component.isEmpty).toBeTrue();
    expect(component.loading).toBeFalse();
  });
});
