import {ComponentFixture, TestBed} from '@angular/core/testing';
import {ClassifiedSummaryComponent} from './classified-summary.component';

describe('ClassifiedSummaryComponent', () => {
  let component: ClassifiedSummaryComponent;
  let fixture: ComponentFixture<ClassifiedSummaryComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({imports: [ClassifiedSummaryComponent]}).compileComponents();
    fixture = TestBed.createComponent(ClassifiedSummaryComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('hasAny is false for an unclassified resource', () => {
    component.classified = undefined;
    expect(component.hasAny).toBeFalse();
    component.classified = {};
    expect(component.hasAny).toBeFalse();
  });

  it('hasAny is true when any synthesized field is present', () => {
    component.classified = {state: 'Active', verification: 'Confirmed'};
    expect(component.hasAny).toBeTrue();
  });

  it('renders the synthesized badges', () => {
    component.classified = {state: 'Final', category: 'Laboratory'};
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent || '';
    expect(text).toContain('Final');
    expect(text).toContain('Laboratory');
  });
});
