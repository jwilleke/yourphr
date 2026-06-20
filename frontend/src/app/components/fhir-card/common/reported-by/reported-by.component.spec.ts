import {ComponentFixture, TestBed} from '@angular/core/testing';
import {ReportedByComponent} from './reported-by.component';

describe('ReportedByComponent', () => {
  let component: ReportedByComponent;
  let fixture: ComponentFixture<ReportedByComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({imports: [ReportedByComponent]}).compileComponents();
    fixture = TestBed.createComponent(ReportedByComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('phrases a named clinician as "Reported by <name>"', () => {
    component.provenance = {kind: 'practitioner', display: 'Dr. Jane Synthetic', level: 1};
    expect(component.label).toBe('Reported by Dr. Jane Synthetic');
    expect(component.iconClass).toBe('fa-user-doctor');
  });

  it('shows self-reported plainly', () => {
    component.provenance = {kind: 'self-reported', display: 'Self-reported', level: 1};
    expect(component.label).toBe('Self-reported');
  });

  it('passes the "Source: X" floor through unchanged', () => {
    component.provenance = {kind: 'source', display: 'Source: Epic', level: 4};
    expect(component.label).toBe('Source: Epic');
  });

  it('renders nothing without provenance', () => {
    component.provenance = undefined;
    expect(component.label).toBe('');
  });
});
