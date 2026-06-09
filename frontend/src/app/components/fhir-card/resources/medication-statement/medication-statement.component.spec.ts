import {ComponentFixture, TestBed} from '@angular/core/testing';

import {MedicationStatementComponent} from './medication-statement.component';
import {NgbCollapseModule} from '@ng-bootstrap/ng-bootstrap';
import {RouterTestingModule} from '@angular/router/testing';

describe('MedicationStatementComponent', () => {
  let component: MedicationStatementComponent;
  let fixture: ComponentFixture<MedicationStatementComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MedicationStatementComponent, NgbCollapseModule, RouterTestingModule]
    })
      .compileComponents();

    fixture = TestBed.createComponent(MedicationStatementComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
