import {Component, Input, OnInit, ChangeDetectionStrategy} from '@angular/core';
@Component({
  standalone: true,
  selector: 'fhir-ui-badge',
  templateUrl: './badge.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./badge.component.scss']
})
export class BadgeComponent implements OnInit {
  @Input() status = ""

  constructor() { }

  ngOnInit(): void {
  }

  // text-bg-* rather than bg-* (yourphr#486).
  //
  // Bootstrap's .badge sets `--bs-badge-color: #fff`, so badge text is WHITE by default, and
  // bg-* sets only a background. This theme (Azia) overrides Bootstrap's palette with colours
  // chosen for looks, and several of them are far too light to carry white text. Measured
  // contrast of #fff against each background in the compiled bundle:
  //
  //   light      1.09:1   effectively invisible — the "white on white" in the report
  //   warning    1.63:1
  //   info       1.96:1
  //   success    2.84:1
  //   secondary  3.62:1   the "unknown" badge; large-text only, never AA for 10px text
  //   danger     4.53:1   (ok)
  //   primary    4.68:1   (ok)
  //
  // text-bg-* pairs each background with a foreground Bootstrap computes per variant, which
  // takes every one of these to WCAG AA: 4.53 – 19.26:1.
  //
  // Safe in BOTH modes here because the dark theme is a body.dark-theme class using its own
  // --dark-* properties and does NOT redefine --bs-*-rgb, so a variant's background is the same
  // colour either way. A move to Bootstrap 5.3's native [data-bs-theme] would need this revisited.
  getBadgeStatusColor(status): string {
    const lookup = {
      // condition
      active: 'text-bg-primary',
      recurrence: '',
      relapse: 'text-bg-info',
      inactive: 'text-bg-secondary',
      remission: 'text-bg-info',
      resolved: 'text-bg-primary',
      // immunization
      'in-progress': 'text-bg-warning',
      'on-hold': 'text-bg-secondary',
      completed: 'text-bg-success',
      'entered-in-error': 'text-bg-danger',
      stopped: 'text-bg-secondary',
      'not-done': 'text-bg-warning',
      // procedure
      preparation: 'text-bg-primary',
      suspended: '',
      aborted: '',
      unknown: 'text-bg-secondary',
      // practitioner
      // allergy intolerance
      unconfirmed: '',
      confirmed: '',
      refuted: '',
      // appointment
      proposed: '',
      pending: '',
      booked: '',
      arrived: '',
      fulfilled: '',
      cancelled: '',
      noshow: '',
      'checked-in': '',
      waitlist: '',
      // care plan
      draft: '',
      revoked: '',
      // care team
      // claim
      // claim response
      // device
      available: '',
      'not-available': '',
      // diagnostic report
      registered: '',
      partial: '',
      preliminary: '',
      final: '',
      corrected: '',
      appended: '',
      // document reference
      current: '',
      superseded: '',
      // encounter
      planned: '',
      triaged: '',
      onleave: '',
      finished: '',
      // explanation of benefit
      // family member history
      'health-unknown': '',
      // goal
      accepted: '',
      rejected: '',
      achieved: '',
      sustaining: '',
      'on-target': '',
      'ahead-of-target': '',
      'behind-target': '',
      // list
      retired: '',
      // location
      // mediacation
      brand: '',
      // medication administration
      // medication knowledge
      // medication statement
      intended: '',
      'not-taken': '',
      // observation
      amended: '',
      // procedure
      // questionnaire
      published: '',
      // questionnaire response
      // research study
      'administratively-completed': '',
      approved: '',
      'closed-to-accrual': '',
      'closed-to-accrual-and-intervention': '',
      disapproved: '',
      'in-review': '',
      'temporarily-closed-to-accrual': '',
      'temporarily-closed-to-accrual-and-intervention': '',
      withdrawn: '',
    };
    return lookup[status] || 'text-bg-secondary'
  }

}
