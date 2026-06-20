import {Component, Input} from '@angular/core';
import {CommonModule} from '@angular/common';
import {Classified} from '../../../../../lib/models/fasten/classified';

// A standalone, patient-legible summary strip of the Layer-1 synthesized fields (state, verification,
// category, source attribution, self-reported). Generic over the Classified superset so one component
// covers every classifier-backed resource type, and is reused by the fhir-card host (#308) and the
// /medical-history rows (#315/#351). All values come from the backend classifiers — never re-derived.
@Component({
  standalone: true,
  imports: [CommonModule],
  selector: 'fhir-ui-classified-summary',
  templateUrl: './classified-summary.component.html',
})
export class ClassifiedSummaryComponent {
  @Input() classified: Classified | undefined

  // hasAny gates the whole strip so it renders nothing for unclassified resources.
  get hasAny(): boolean {
    const c = this.classified
    return !!c && !!(c.state || c.verification || c.category || c.source || c.selfReported)
  }
}
