import {Component, ChangeDetectionStrategy} from '@angular/core';
import {GenericColumnDefn, DatatableGenericResourceComponent} from './datatable-generic-resource.component';

@Component({
    selector: 'fhir-datatable-medication-request',
    templateUrl: './datatable-generic-resource.component.html',
    styleUrls: ['./datatable-generic-resource.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class DatatableMedicationRequestComponent extends DatatableGenericResourceComponent {
  // SMART Health IT / Synthea: always has status, intent, medicationCodeableConcept, authoredOn,
  // requester (often reference-only). dosageInstruction / reasonCode often absent — don't lead with them.
  columnDefinitions: GenericColumnDefn[] = [
    { title: 'Status', versions: '*', getter: m => m.status },
    { title: 'Intent', versions: '*', getter: m => m.intent },
    {
      title: 'Medication',
      versions: '*',
      getter: m => {
        if (m.medicationCodeableConcept) {
          const c = m.medicationCodeableConcept;
          return c.text || c.coding?.[0]?.display || c.coding?.[0]?.code;
        }
        const r = m.medicationReference;
        return r?.display || r?.reference;
      },
    },
    { title: 'Authored', versions: '*', format: 'date', getter: m => m.authoredOn },
    {
      title: 'Requester',
      versions: '*',
      getter: m => m.requester?.display || m.requester?.reference,
    },
    {
      title: 'Dosage',
      versions: '*',
      getter: m => {
        const d0 = m.dosageInstruction?.[0];
        if (!d0) {
          return undefined;
        }
        return (
          d0.text ||
          d0.patientInstruction ||
          d0.route?.text ||
          d0.route?.coding?.[0]?.display ||
          d0.timing?.code?.text ||
          d0.timing?.code?.coding?.[0]?.display
        );
      },
    },
    {
      title: 'Reason',
      versions: '*',
      format: 'codeableConcept',
      getter: m => m.reasonCode?.[0],
    },
  ]
}
