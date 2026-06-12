import {Component, Input, OnInit} from '@angular/core';
@Component({
  standalone: true,
  selector: 'fhir-ui-badge',
  templateUrl: './badge.component.html',
  styleUrls: ['./badge.component.scss']
})
export class BadgeComponent implements OnInit {
  @Input() status = ""

  constructor() { }

  ngOnInit(): void {
  }

  getBadgeStatusColor(status): string {
    const lookup = {
      // condition
      active: 'bg-primary',
      recurrence: '',
      relapse: 'bg-info',
      inactive: 'bg-secondary',
      remission: 'bg-info',
      resolved: 'bg-primary',
      // immunization
      'in-progress': 'bg-warning',
      'on-hold': 'bg-secondary',
      completed: 'bg-success',
      'entered-in-error': 'bg-danger',
      stopped: 'bg-secondary',
      'not-done': 'bg-warning',
      // procedure
      preparation: 'bg-primary',
      suspended: '',
      aborted: '',
      unknown: 'bg-secondary',
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
    return lookup[status] || 'bg-secondary'
  }

}
