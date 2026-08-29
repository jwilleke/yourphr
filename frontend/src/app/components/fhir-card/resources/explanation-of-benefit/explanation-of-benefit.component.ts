import {ChangeDetectorRef, Component, Input, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {NgbCollapseModule} from '@ng-bootstrap/ng-bootstrap';

import {Router, RouterModule} from '@angular/router';
import {BadgeComponent} from '../../common/badge/badge.component';
import {TableComponent} from '../../common/table/table.component';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {FhirCardComponentInterface} from '../../fhir-card/fhir-card-component-interface';
import {ExplanationOfBenefitModel} from '../../../../../lib/models/resources/explanation-of-benefit-model';
import {money} from '../../../../../lib/utils/fhir-money';

export {money};

/**
 * What a patient calls "the letter from my insurance" (#522).
 *
 * Until now this resource type fell through to "YourPHR does not know how to display this resource
 * type (yet)" and offered raw JSON — on a document whose entire purpose is to tell somebody what
 * they owe.
 *
 * The ordering is what the reader wants to know, not the order FHIR stores it in: what it was for,
 * who provided it, when, and then the money.
 */
@Component({
  imports: [NgbCollapseModule, BadgeComponent, TableComponent, RouterModule],
  selector: 'fhir-explanation-of-benefit',
  templateUrl: './explanation-of-benefit.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./explanation-of-benefit.component.scss'],
})
export class ExplanationOfBenefitComponent implements OnInit, FhirCardComponentInterface {
  @Input() displayModel: ExplanationOfBenefitModel | null;
  @Input() showDetails = true;
  @Input() isCollapsed = false;

  tableData: TableRowItem[] = [];

  /** Money rows, kept apart from the facts so the template can lead with them. */
  amounts: {label: string; value: string}[] = [];

  heading = 'Insurance claim';
  serviceDates: string | undefined;

  constructor(public changeRef: ChangeDetectorRef, public router: Router) {}

  ngOnInit(): void {
    const model = this.displayModel;

    this.heading = codingText(model?.type) || 'Insurance claim';
    this.serviceDates = periodText(model?.billablePeriod);

    this.tableData = [
      {
        label: 'Claim type',
        data: model?.type as any,
        data_type: TableRowItemDataType.CodingList,
        enabled: !!model?.hasType,
      },
      {
        label: 'Provider',
        data: model?.provider,
        data_type: TableRowItemDataType.Reference,
        enabled: !!model?.provider,
      },
      {
        label: 'Insurer',
        data: model?.insurer,
        data_type: TableRowItemDataType.Reference,
        enabled: !!model?.insurer,
      },
      {
        label: 'Service dates',
        data: this.serviceDates,
        enabled: !!this.serviceDates,
      },
      {
        label: 'Processed on',
        data: model?.created,
        enabled: !!model?.created,
      },
      {
        label: 'Diagnosis',
        data: model?.code as any,
        data_type: TableRowItemDataType.CodableConcept,
        enabled: !!model?.code,
      },
      {
        // "outcome" is complete/partial/error in FHIR; "disposition" is the human sentence the payer
        // wrote. Show the sentence when there is one, since it is already in the reader's language.
        label: 'Result',
        data: model?.disposition || model?.outcome,
        enabled: !!(model?.disposition || model?.outcome),
      },
    ];

    this.amounts = (model?.total || [])
      .map((total) => ({
        label: amountLabel(total?.category),
        value: money(total?.amount),
      }))
      .filter((row) => !!row.value);
  }

  markForCheck() {
    this.changeRef.markForCheck();
  }
}

/**
 * Translate a C4BB adjudication category into what the reader is actually asking.
 *
 * "submitted", "benefit" and "coinsurance" are billing vocabulary; "Amount billed", "Paid by
 * insurance" and "Your coinsurance" are the same facts in the reader's language (#262). Anything
 * unrecognised falls back to the payer's own text rather than being dropped or guessed at — an
 * unknown category is still a real number on a real statement.
 */
export function amountLabel(category: any): string {
  const code = (category?.coding?.[0]?.code || '').toLowerCase();
  const known: Record<string, string> = {
    submitted: 'Amount billed',
    eligible: 'Amount allowed',
    benefit: 'Paid by insurance',
    payment: 'Paid by insurance',
    copay: 'Your copay',
    deductible: 'Applied to your deductible',
    coinsurance: 'Your coinsurance',
    noncovered: 'Not covered',
    patientpay: 'Your responsibility',
    paidbypatient: 'You paid',
    paidtoprovider: 'Paid to the provider',
    priorpayerpaid: 'Paid by another insurer',
  };
  return known[code] || category?.text || category?.coding?.[0]?.display || 'Amount';
}

function codingText(codings: any[] | undefined): string {
  const coding = codings?.[0];
  return coding?.display || coding?.text || '';
}

function periodText(period: any): string | undefined {
  // The model types billablePeriod as an array, but R4 stores a single Period; accept both.
  const value = Array.isArray(period) ? period[0] : period;
  const start = value?.start ? String(value.start).slice(0, 10) : '';
  const end = value?.end ? String(value.end).slice(0, 10) : '';
  if (start && end && start !== end) {
    return `${start} to ${end}`;
  }
  return start || end || undefined;
}
