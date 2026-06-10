import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NgbCollapseModule } from '@ng-bootstrap/ng-bootstrap';
import { RouterTestingModule } from '@angular/router/testing';

import { FamilyMemberHistoryComponent } from './family-member-history.component';

describe('FamilyMemberHistoryComponent', () => {
  let component: FamilyMemberHistoryComponent;
  let fixture: ComponentFixture<FamilyMemberHistoryComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FamilyMemberHistoryComponent, NgbCollapseModule, RouterTestingModule]
    }).compileComponents();
    fixture = TestBed.createComponent(FamilyMemberHistoryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
