import {ChangeDetectorRef, Component, Input, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {NgbCollapseModule} from '@ng-bootstrap/ng-bootstrap';

import {Router, RouterModule} from '@angular/router';
import {BadgeComponent} from '../../common/badge/badge.component';
import {TableComponent} from '../../common/table/table.component';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {FhirCardComponentInterface} from '../../fhir-card/fhir-card-component-interface';
import {ClaimModel} from '../../../../../lib/models/resources/claim-model';
import {money} from '../explanation-of-benefit/explanation-of-benefit.component';

/**
 * A Claim is the bill a provider sent to an insurer (#521) — not a statement of what the patient
 * owes. That distinction is the single most useful thing this card can communicate, because a
 * patient typically receives a Claim and an ExplanationOfBenefit for the same care and reasonably
 * assumes both are bills.
 *
 * So the amount is labelled "Amount claimed" and the card says who sent it to whom. No total is
 * derived, estimated or re-badged as a balance: FHIR did not state one, and inventing it would be
 * exactly the guess the display rules forbid (#262).
 */
@Component({
  imports: [NgbCollapseModule, BadgeComponent, TableComponent, RouterModule],
  selector: 'fhir-claim',
  templateUrl: './claim.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./claim.component.scss'],
})
export class ClaimComponent implements OnInit, FhirCardComponentInterface {
  @Input() displayModel: ClaimModel | null;
  @Input() showDetails = true;
  @Input() isCollapsed = false;

  tableData: TableRowItem[] = [];
  heading = 'Claim';
  amountClaimed: string | undefined;
  lineItems: {description: string; date?: string; amount?: string}[] = [];

  constructor(public changeRef: ChangeDetectorRef, public router: Router) {}

  ngOnInit(): void {
    const model = this.displayModel;

    this.heading = model?.type?.[0]?.display || model?.type?.[0]?.code || 'Claim';
    this.amountClaimed = money(model?.total);

    this.tableData = [
      {
        label: 'Claim type',
        data: model?.type as any,
        data_type: TableRowItemDataType.CodingList,
        enabled: !!model?.hasType,
      },
      {
        label: 'Billed by',
        data: model?.provider,
        data_type: TableRowItemDataType.Reference,
        enabled: !!model?.provider,
      },
      {
        label: 'Billed to',
        data: model?.insurer,
        data_type: TableRowItemDataType.Reference,
        enabled: !!model?.insurer,
      },
      {
        label: 'Date submitted',
        data: model?.created,
        enabled: !!model?.created,
      },
      {
        label: 'Priority',
        data: model?.priority as any,
        data_type: TableRowItemDataType.CodableConcept,
        enabled: !!model?.priority,
      },
      {
        label: 'Claim number',
        data: model?.identifier?.[0]?.value,
        enabled: !!model?.identifier?.[0]?.value,
      },
    ];

    this.lineItems = (model?.items || [])
      .map((item) => ({
        description: item.coding?.display || item.coding?.code || 'Service',
        date: item.servicedDate ? String(item.servicedDate).slice(0, 10) : undefined,
        amount: money(item.net),
      }))
      // A line with no description AND no amount tells the reader nothing.
      .filter((row) => row.description !== 'Service' || !!row.amount);
  }

  markForCheck() {
    this.changeRef.markForCheck();
  }
}
