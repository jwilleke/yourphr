import {Component, OnChanges, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {GenericColumnDefn, DatatableGenericResourceComponent, ResourceListComponentInterface} from './datatable-generic-resource.component';

@Component({
    selector: 'fhir-datatable-encounter',
    templateUrl: './datatable-generic-resource.component.html',
    styleUrls: ['./datatable-generic-resource.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class DatatableEncounterComponent extends DatatableGenericResourceComponent  {
  // SMART Health IT / Synthea: always has period, type, class, status; reason/discharge rare;
  // participants often reference-only (no display). Prefer always-populated columns first.
  columnDefinitions: GenericColumnDefn[] = [
    { title: 'Status', versions: '*', getter: e => e.status },
    {
      title: 'Class',
      versions: '*',
      getter: e => e.class?.display || e.class?.code,
    },
    {
      title: 'Type',
      versions: '*',
      format: 'codeableConcept',
      getter: e => e.type?.[0],
    },
    { title: 'Period', versions: '*', format: 'period', getter: e => e.period },
    {
      title: 'Reason',
      versions: '*',
      format: 'codeableConcept',
      getter: e => e.reasonCode?.[0],
    },
    {
      title: 'Practitioner',
      versions: '*',
      getter: e => {
        const ind = e.participant?.[0]?.individual;
        if (!ind) {
          return undefined;
        }
        // Prefer human display; fall back to bare reference (common in SMART/Synthea).
        return ind.display || ind.reference;
      },
    },
    {
      title: 'Organization',
      versions: '*',
      getter: e => e.serviceProvider?.display || e.serviceProvider?.reference,
    },
    {
      title: 'Discharge',
      versions: '*',
      format: 'codeableConcept',
      getter: e => e.hospitalization?.dischargeDisposition,
    },
  ]
}
