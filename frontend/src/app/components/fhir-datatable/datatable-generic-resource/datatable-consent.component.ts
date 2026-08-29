import {Component, ChangeDetectionStrategy} from '@angular/core';
import {GenericColumnDefn, DatatableGenericResourceComponent} from './datatable-generic-resource.component';

/**
 * Explore list for FHIR Consent (#440).
 * Prefer patient-legible fields from R4 Consent; leave blank when the export omits them.
 * Replaces fallback Id + Title (Title used reasonCode, which Consent does not have).
 */
@Component({
    selector: 'fhir-datatable-consent',
    templateUrl: './datatable-generic-resource.component.html',
    styleUrls: ['./datatable-generic-resource.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class DatatableConsentComponent extends DatatableGenericResourceComponent {
  columnDefinitions: GenericColumnDefn[] = [
    { title: 'Status', versions: '*', getter: c => c.status },
    { title: 'Scope', versions: '*', format: 'codeableConcept', getter: c => c.scope },
    { title: 'Category', versions: '*', format: 'codeableConcept', getter: c => c.category?.[0] },
    { title: 'Date', versions: '*', format: 'date', getter: c => c.dateTime },
    {
      title: 'Document',
      versions: '*',
      getter: c =>
        c.sourceAttachment?.title ||
        c.sourceReference?.display ||
        c.sourceReference?.reference,
    },
    {
      title: 'Policy',
      versions: '*',
      getter: c =>
        c.policyRule?.coding?.[0]?.display ||
        c.policyRule?.text ||
        c.policyRule?.coding?.[0]?.code,
    },
    { title: 'Provision', versions: '*', getter: c => c.provision?.type },
  ]
}
