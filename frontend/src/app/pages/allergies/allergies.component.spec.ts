import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { RouterTestingModule } from '@angular/router/testing';
import { AllergiesComponent } from './allergies.component';
import { FastenApiService } from '../../services/fasten-api.service';

describe('AllergiesComponent', () => {
  let component: AllergiesComponent;
  let fixture: ComponentFixture<AllergiesComponent>;
  let mockApi: any;

  beforeEach(async () => {
    mockApi = jasmine.createSpyObj('FastenApiService', ['getClassifiedAllergies']);
    mockApi.getClassifiedAllergies.and.returnValue(of([
      { sourceResourceType: 'AllergyIntolerance', sourceResourceId: 'a1', sourceId: 's', title: 'Penicillin', state: 'Active', verification: 'Confirmed', selfReported: false, occurrences: 2, start: '2015-01-01', end: '2022-06-15', lastActivity: '2022-06-15' },
      { sourceResourceType: 'AllergyIntolerance', sourceResourceId: 'a2', sourceId: 's', title: 'No Known Food Allergies', state: 'Unknown', verification: 'Unknown', selfReported: false, noKnown: true },
    ]));
    await TestBed.configureTestingModule({
      imports: [AllergiesComponent, RouterTestingModule],
      providers: [{ provide: FastenApiService, useValue: mockApi }],
    }).compileComponents();
    fixture = TestBed.createComponent(AllergiesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and render the list', () => {
    expect(component).toBeTruthy();
    expect(component.filtered.length).toBe(2);
  });

  it('active-only filter hides no-known and non-active', () => {
    component.toggleActiveOnly();
    expect(component.filtered.length).toBe(1);
    expect(component.filtered[0].title).toBe('Penicillin');
  });
});
