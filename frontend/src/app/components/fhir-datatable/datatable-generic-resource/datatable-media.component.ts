import {Component, ChangeDetectionStrategy} from '@angular/core';
import {GenericColumnDefn, DatatableGenericResourceComponent} from './datatable-generic-resource.component';

/**
 * Explore list for FHIR Media (#446).
 * Card/MediaModel already exist; list was falling back to Id + Title (reasonCode — empty for Media).
 */
@Component({
    selector: 'fhir-datatable-media',
    templateUrl: './datatable-generic-resource.component.html',
    styleUrls: ['./datatable-generic-resource.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class DatatableMediaComponent extends DatatableGenericResourceComponent {
  columnDefinitions: GenericColumnDefn[] = [
    { title: 'Status', versions: '*', getter: m => m.status },
    {
      title: 'Modality',
      versions: '*',
      format: 'codeableConcept',
      getter: m => m.modality || m.type,
    },
    {
      title: 'Title',
      versions: '*',
      getter: m =>
        m.content?.title ||
        m.deviceName ||
        m.type?.text ||
        m.type?.coding?.[0]?.display,
    },
    {
      title: 'Content type',
      versions: '*',
      getter: m => m.content?.contentType,
    },
    {
      title: 'Created',
      versions: '*',
      format: 'date',
      getter: m => m.createdDateTime || m.createdPeriod?.start || m.issued,
    },
    {
      title: 'Operator',
      versions: '*',
      getter: m => m.operator?.display || m.operator?.reference,
    },
    {
      title: 'Subject',
      versions: '*',
      getter: m => m.subject?.display || m.subject?.reference,
    },
  ]
}
