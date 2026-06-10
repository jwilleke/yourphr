import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NgbCollapseModule } from '@ng-bootstrap/ng-bootstrap';
import { RouterTestingModule } from '@angular/router/testing';

import { SpecimenComponent } from './specimen.component';

describe('SpecimenComponent', () => {
  let component: SpecimenComponent;
  let fixture: ComponentFixture<SpecimenComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SpecimenComponent, NgbCollapseModule, RouterTestingModule]
    }).compileComponents();
    fixture = TestBed.createComponent(SpecimenComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
