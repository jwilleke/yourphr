import {Component, ChangeDetectionStrategy} from '@angular/core';

import {RouterModule} from '@angular/router';
import {ATTRIBUTIONS, AttributionNotice} from '../../models/fasten/attributions';

// Full list of third-party attribution notices (#428). Source: attributions registry.
@Component({
  standalone: true,
  imports: [RouterModule],
  selector: 'app-attributions',
  templateUrl: './attributions.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./attributions.component.scss'],
})
export class AttributionsComponent {
  notices: AttributionNotice[] = ATTRIBUTIONS.filter((a) =>
    a.contexts.includes('attributions-page'),
  );
}
