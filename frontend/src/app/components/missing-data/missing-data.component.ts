import {Component, Input} from '@angular/core';
import {CommonModule} from '@angular/common';
import {NgbTooltipModule} from '@ng-bootstrap/ng-bootstrap';

// App-wide "Data Not Provided" marker (#178). The visible expression of the no-guessing principle:
// when an *expected* field is absent from the imported record, render this instead of a blank cell,
// so the patient knows the data was not in the source — not that YourPHR failed or that the value
// is zero/none. Use it for prominent fields only; silently omit truly-minor optional fields.
@Component({
  standalone: true,
  imports: [CommonModule, NgbTooltipModule],
  selector: 'app-missing-data',
  templateUrl: './missing-data.component.html',
  styleUrls: ['./missing-data.component.scss']
})
export class MissingDataComponent {
  // The visible text. Defaults to the standard marker; override only if a context needs different wording.
  @Input() label = 'Data Not Provided';
  // Optional field name, used to tailor the explanation (e.g. field="Purpose").
  @Input() field?: string;

  get explanation(): string {
    const subject = this.field ? `"${this.field}"` : 'This information';
    return `${subject} was not included in the record imported from your provider. ` +
      `YourPHR shows only what the source supplied — it never fills in or guesses missing values.`;
  }
}
