import {ComponentFixture, TestBed} from '@angular/core/testing';

import {MedicationDispenseComponent} from './medication-dispense.component';
import {NgbCollapseModule} from '@ng-bootstrap/ng-bootstrap';
import {RouterTestingModule} from '@angular/router/testing';

describe('MedicationDispenseComponent', () => {
  let component: MedicationDispenseComponent;
  let fixture: ComponentFixture<MedicationDispenseComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MedicationDispenseComponent, NgbCollapseModule, RouterTestingModule]
    })
      .compileComponents();

    fixture = TestBed.createComponent(MedicationDispenseComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
