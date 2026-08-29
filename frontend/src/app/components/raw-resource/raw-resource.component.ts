import {Clipboard} from '@angular/cdk/clipboard';
import {Component, Input, ChangeDetectionStrategy} from '@angular/core';

/**
 * The one place raw FHIR is offered to a patient.
 *
 * Two screens grew their own version of this and drifted (#526): /explore used a checkbox inside a
 * yellow WARNING alert labelled "Enable Debug mode", while /medical-history used a top-right button
 * labelled "Show raw FHIR" — and the two copy buttons disagreed even on capitalisation. Same
 * feature, two vocabularies, and nothing to stop a third appearing.
 *
 * Wording is deliberate. "Raw data" rather than "debug mode": looking at your own record in its
 * original form is a legitimate thing for a patient to do, not a developer setting. "FHIR" is the
 * format's name, not a word most people know, so it belongs in the panel rather than on the button.
 *
 * The warning styling is gone with it. Nothing here is dangerous.
 */
@Component({
  selector: 'app-raw-resource',
  templateUrl: './raw-resource.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class RawResourceComponent {
  /** The resource to show. Anything JSON-serialisable; usually a `resource_raw`. */
  @Input() raw: unknown;

  /** Collapsed by default — the formatted record is what a patient came for. */
  expanded = false;

  copied = false;

  // CDK's Clipboard, NOT navigator.clipboard. The async Clipboard API is only available in a SECURE
  // CONTEXT, so on a plain-HTTP LAN deployment — which web.listen.https.enabled defaults to allowing
  // — navigator.clipboard is undefined and the button would fail silently. Both screens this
  // component replaces already used CDK for that reason; the fallback is a textarea + execCommand.
  constructor(private clipboard: Clipboard) {}

  toggle(): void {
    this.expanded = !this.expanded;
  }

  copy(): void {
    if (this.raw === undefined || this.raw === null) {
      return;
    }
    const text = typeof this.raw === 'string' ? this.raw : JSON.stringify(this.raw, null, 2);
    if (this.clipboard.copy(text)) {
      this.copied = true;
      setTimeout(() => {
        this.copied = false;
      }, 2000);
    }
  }
}
