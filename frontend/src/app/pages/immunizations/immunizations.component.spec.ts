import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { RouterTestingModule } from '@angular/router/testing';
import { ImmunizationsComponent } from './immunizations.component';
import { FastenApiService } from '../../services/fasten-api.service';

describe('ImmunizationsComponent', () => {
  let component: ImmunizationsComponent;
  let fixture: ComponentFixture<ImmunizationsComponent>;
  let mockApi: any;

  beforeEach(async () => {
    mockApi = jasmine.createSpyObj('FastenApiService', ['getClassifiedImmunizations']);
    mockApi.getClassifiedImmunizations.and.returnValue(of([
      { sourceResourceType: 'Immunization', sourceResourceId: 'i1', sourceId: 's', title: 'Influenza', state: 'Completed', source: 'Recorded by provider', doses: 3, occurrence: '2024-10-01', lastActivity: '2024-10-01' },
    ]));
    await TestBed.configureTestingModule({
      imports: [ImmunizationsComponent, RouterTestingModule],
      providers: [{ provide: FastenApiService, useValue: mockApi }],
    }).compileComponents();
    fixture = TestBed.createComponent(ImmunizationsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and render the deduped list with dose count', () => {
    expect(component).toBeTruthy();
    expect(component.filtered.length).toBe(1);
    expect(component.filtered[0].doses).toBe(3);
  });
});
