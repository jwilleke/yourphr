import {Component, ChangeDetectionStrategy} from '@angular/core';
import {GenericColumnDefn, DatatableGenericResourceComponent} from './datatable-generic-resource.component';
import {attributeXTime} from './utils';

@Component({
    selector: 'fhir-datatable-diagnostic-report',
    templateUrl: './datatable-generic-resource.component.html',
    styleUrls: ['./datatable-generic-resource.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class DatatableDiagnosticReportComponent extends DatatableGenericResourceComponent {
  // Prefer lab-panel fields (code, category, results). Document/author only when the export
  // has presentedForm / performer — blank is correct for many SMART Health IT lab reports.
  columnDefinitions: GenericColumnDefn[] = [
    { title: 'Status', versions: '*', getter: d => d.status },
    {
      title: 'Category',
      versions: '*',
      format: 'codeableConcept',
      getter: d => d.category?.[0],
    },
    { title: 'Title', versions: '*', format: 'codeableConcept', getter: d => d.code },
    {
      title: 'Effective',
      versions: '*',
      format: 'date',
      getter: d => d.effectiveDateTime || d.effectivePeriod?.start || d.issued,
    },
    { title: 'Issued', versions: '*', format: 'date', getter: d => d.issued },
    {
      title: 'Results',
      versions: '*',
      getter: d => {
        const results = d.result;
        if (!Array.isArray(results) || results.length === 0) {
          return undefined;
        }
        const labels = results
          .map((r: { display?: string; reference?: string }) => r?.display || r?.reference)
          .filter((x: string | undefined): x is string => !!x);
        if (labels.length === 0) {
          return `${results.length}`;
        }
        const head = labels.slice(0, 3).join(', ');
        return labels.length > 3 ? `${head} (+${labels.length - 3})` : head;
      },
    },
    {
      title: 'Document',
      versions: '*',
      getter: d => d.presentedForm?.[0]?.title,
    },
    {
      title: 'Author',
      versions: '*',
      getter: d =>
        d.performer?.[0]?.display ||
        d.performer?.[0]?.actor?.display ||
        d.performer?.[0]?.reference,
    },
  ]
}
