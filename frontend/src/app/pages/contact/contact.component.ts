import {Component, OnInit, ChangeDetectionStrategy} from '@angular/core';

import {RouterModule} from '@angular/router';
import {FastenApiService} from '../../services/fasten-api.service';
import {AuthService} from '../../services/auth.service';

// Contact page (#454) — every contact detail for THIS instance, driven by the Admin Dashboard
// Instance card and persisted in the instance custom config store (#452). Nothing here is
// hardcoded per deployment.
//
// The operator is the data controller for the records held on this instance, so "who do I ask
// about my data" is an instance-level question, not a project-level one. Project links are shown
// separately and clearly labelled, so the two are never confused.
@Component({
  standalone: true,
  imports: [RouterModule],
  selector: 'app-contact',
  templateUrl: './contact.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./contact.component.scss'],
})
export class ContactComponent implements OnInit {
  operatorName = '';
  operatorContactEmail = '';
  operatorContactUrl = '';

  // Distinguishes "the operator set nothing" from "we have not asked yet", so the page never
  // flashes a "not configured" message while the request is still in flight.
  loaded = false;

  constructor(private fastenApi: FastenApiService, private authService: AuthService) {}

  get hasOperatorContact(): boolean {
    return !!(this.operatorName || this.operatorContactEmail || this.operatorContactUrl);
  }

  async ngOnInit() {
    // A signed-in user gets the operator's email as well; anonymous callers do not, so it is not
    // harvested off an unauthenticated endpoint (#459). The page works either way — this route is
    // reachable logged-out on purpose, since someone locked out is who most needs the operator.
    const signedIn = await this.authService.IsAuthenticated().catch(() => false);
    const request = signedIn
      ? this.fastenApi.getInstanceInfo()
      : this.fastenApi.getPublicInstanceInfo();

    request.subscribe({
      next: ({name, contact_email, contact_url}) => {
        this.operatorName = name;
        this.operatorContactEmail = contact_email;
        this.operatorContactUrl = contact_url;
        this.loaded = true;
      },
      // An unreachable endpoint is reported as "no contact details available", not as a blank
      // page and not as invented details.
      error: () => { this.loaded = true; },
    });
  }
}
