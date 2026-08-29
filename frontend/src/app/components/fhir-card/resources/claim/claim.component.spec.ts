import {ComponentFixture, TestBed} from '@angular/core/testing';
import {RouterTestingModule} from '@angular/router/testing';

import {ClaimComponent} from './claim.component';
import {ClaimModel} from '../../../../../lib/models/resources/claim-model';
import {fhirVersions} from '../../../../../lib/models/constants';

const CLAIM = {
  resourceType: 'Claim',
  id: 'claim-1',
  status: 'active',
  use: 'claim',
  created: '2026-02-10T09:00:00Z',
  type: {coding: [{code: 'oral', display: 'Oral Health'}]},
  patient: {reference: 'Patient/1'},
  provider: {reference: 'Organization/2', display: 'Springfield Dental'},
  insurer: {reference: 'Organization/3', display: 'Blue Cross'},
  priority: {coding: [{code: 'normal'}]},
  identifier: [{system: 'http://example.org/claims', value: 'CLM-99'}],
  total: {value: 275.5, currency: 'USD'},
  item: [
    {
      sequence: 1,
      productOrService: {coding: [{code: '1200', display: 'Exam'}]},
      servicedDate: '2026-02-09',
      net: {value: 75.5, currency: 'USD'},
    },
    {
      sequence: 2,
      productOrService: {coding: [{code: '1201', display: 'X-ray'}]},
      servicedDate: '2026-02-09',
      net: {value: 200, currency: 'USD'},
    },
  ],
};

describe('ClaimComponent', () => {
  let component: ClaimComponent;
  let fixture: ComponentFixture<ClaimComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClaimComponent, RouterTestingModule],
    }).compileComponents();

    fixture = TestBed.createComponent(ClaimComponent);
    component = fixture.componentInstance;
    component.displayModel = new ClaimModel(CLAIM, fhirVersions.R4);
    fixture.detectChanges();
  });

  const text = () => (fixture.nativeElement as HTMLElement).textContent;

  it('should lead with the claim type', () => {
    expect(component.heading).toEqual('Oral Health');
  });

  // The distinction that stops a patient thinking they owe this money twice.
  it('should say plainly that this is a bill to insurance, not a balance owed', () => {
    expect(text()).toContain('bill your provider sent to your insurance');
    expect(text()).toContain('not a statement of what you owe');
  });

  it('should label the total as the amount claimed', () => {
    expect(component.amountClaimed).toContain('275.50');
    expect(text()).toContain('Amount claimed');
    expect(text()).not.toContain('You owe');
  });

  it('should name who billed whom rather than a bare reference', () => {
    const labels = component.tableData.filter((r) => r.enabled).map((r) => r.label);

    expect(labels).toContain('Billed by');
    expect(labels).toContain('Billed to');
  });

  it('should list the services billed with their dates and amounts', () => {
    expect(component.lineItems.length).toEqual(2);
    expect(component.lineItems[0]).toEqual(
      jasmine.objectContaining({description: 'Exam', date: '2026-02-09'})
    );
    expect(text()).toContain('X-ray');
    expect(text()).toContain('$200.00');
  });

  it('should survive a claim with no line items or total', () => {
    // A FRESH fixture, not the one beforeEach already rendered. This component derives its view
    // state in ngOnInit, so testing a different input means INITIALISING with it. Swapping
    // displayModel on a rendered component and calling ngOnInit() by hand moves `heading` after
    // Angular has already checked it, which Angular 22 reports as NG0100
    // (ExpressionChangedAfterItHasBeenCheckedError) rather than tolerating as Angular 20 did.
    const bare = TestBed.createComponent(ClaimComponent);
    bare.componentInstance.displayModel = new ClaimModel({resourceType: 'Claim', status: 'draft'}, fhirVersions.R4);
    bare.detectChanges();

    expect(bare.componentInstance.lineItems).toEqual([]);
    expect(bare.componentInstance.amountClaimed).toEqual('');
    expect(bare.componentInstance.heading).toEqual('Claim');
  });
});
