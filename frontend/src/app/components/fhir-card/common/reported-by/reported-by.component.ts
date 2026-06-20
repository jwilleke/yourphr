import {Component, Input} from '@angular/core';
import {CommonModule} from '@angular/common';
import {Provenance} from '../../../../../lib/models/fasten/provenance';

// "Who said this" — a standalone, patient-legible rendering of the resolved Provenance. Kept generic
// (no card coupling) so it is reused by the fhir-card host (#308) AND the /medical-history rows
// (#315/#351) — the "who" is resolved once in the backend; this only formats it.
@Component({
  standalone: true,
  imports: [CommonModule],
  selector: 'fhir-ui-reported-by',
  templateUrl: './reported-by.component.html',
})
export class ReportedByComponent {
  @Input() provenance: Provenance | undefined

  // label phrases the attribution: self-reported and the "Source: X" floor read naturally as-is; a
  // named clinician/organization reads "Reported by <name>". Never fabricated upstream.
  get label(): string {
    const p = this.provenance
    if (!p || !p.display) {
      return ''
    }
    switch (p.kind) {
      case 'self-reported':
        return 'Self-reported'
      case 'source':
        return p.display // already "Source: <name>"
      default:
        return 'Reported by ' + p.display
    }
  }

  get iconClass(): string {
    switch (this.provenance?.kind) {
      case 'self-reported':
        return 'fa-user-pen'
      case 'organization':
        return 'fa-hospital'
      case 'practitioner':
        return 'fa-user-doctor'
      default:
        return 'fa-circle-info'
    }
  }
}
