import {Component, ChangeDetectionStrategy} from '@angular/core';
import {GenericColumnDefn, DatatableGenericResourceComponent} from './datatable-generic-resource.component';

/**
 * Explore list for FHIR AdverseEvent (#449) — harm and near-misses.
 * SMART/Synthea often omit event/date; fall back to suspectEntity + meta.lastUpdated.
 */
@Component({
    selector: 'fhir-datatable-adverse-event',
    templateUrl: './datatable-generic-resource.component.html',
    styleUrls: ['./datatable-generic-resource.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class DatatableAdverseEventComponent extends DatatableGenericResourceComponent {
  columnDefinitions: GenericColumnDefn[] = [
    {
      title: 'Date',
      versions: '*',
      format: 'date',
      getter: a =>
        a.date || a.detected || a.recordedDate || a.meta?.lastUpdated,
    },
    {
      title: 'Event',
      versions: '*',
      getter: a => {
        const ev = a.event;
        if (ev) {
          const t = ev.text || ev.coding?.[0]?.display || ev.coding?.[0]?.code;
          if (t) { return t; }
        }
        const inst = a.suspectEntity?.[0]?.instance;
        return inst?.display || inst?.reference;
      },
    },
    {
      title: 'Outcome',
      versions: '*',
      getter: a =>
        a.outcome?.text ||
        a.outcome?.coding?.[0]?.display ||
        a.outcome?.coding?.[0]?.code,
    },
    {
      title: 'Seriousness',
      versions: '*',
      getter: a =>
        a.seriousness?.text ||
        a.seriousness?.coding?.[0]?.display ||
        a.seriousness?.coding?.[0]?.code,
    },
    {
      title: 'Actuality',
      versions: '*',
      getter: a => a.actuality,
    },
  ]
}
