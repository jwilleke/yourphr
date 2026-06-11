import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NgbCollapseModule } from '@ng-bootstrap/ng-bootstrap';
import { RouterTestingModule } from '@angular/router/testing';

import { PractitionerRoleComponent } from './practitioner-role.component';

describe('PractitionerRoleComponent', () => {
  let component: PractitionerRoleComponent;
  let fixture: ComponentFixture<PractitionerRoleComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PractitionerRoleComponent, NgbCollapseModule, RouterTestingModule]
    }).compileComponents();
    fixture = TestBed.createComponent(PractitionerRoleComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
