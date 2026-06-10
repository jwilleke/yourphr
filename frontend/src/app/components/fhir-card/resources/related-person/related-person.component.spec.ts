import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NgbCollapseModule } from '@ng-bootstrap/ng-bootstrap';
import { RouterTestingModule } from '@angular/router/testing';

import { RelatedPersonComponent } from './related-person.component';

describe('RelatedPersonComponent', () => {
  let component: RelatedPersonComponent;
  let fixture: ComponentFixture<RelatedPersonComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RelatedPersonComponent, NgbCollapseModule, RouterTestingModule]
    }).compileComponents();
    fixture = TestBed.createComponent(RelatedPersonComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
