import {Component, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {Router} from '@angular/router';
import {FastenApiService} from '../../services/fasten-api.service';

/**
 * MaintenanceComponent is where a signed-in person lands while the operator has the instance in
 * maintenance mode (yourphr#714). The server answers every signed-in request with 503 and the
 * operator's message; the interceptor brings the person here rather than leaving a page of failed
 * requests. "Try again" goes back to the dashboard, which lands here again until it is over.
 */
@Component({
    selector: 'app-maintenance',
    templateUrl: './maintenance.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class MaintenanceComponent implements OnInit {
  message = ''

  constructor(private router: Router, private fastenApi: FastenApiService) { }

  ngOnInit(): void {
    // The interceptor passes the server's message along; a reload loses it, so ask the public
    // instance, which publishes the same message to anyone.
    const passed = history.state?.message
    if (typeof passed === 'string' && passed !== '') {
      this.message = passed
      return
    }
    this.fastenApi.getPublicInstanceInfo().subscribe({
      next: (info) => { this.message = info.maintenance_message },
      error: () => { this.message = '' },
    })
  }

  tryAgain(): void {
    this.router.navigateByUrl('/dashboard')
  }
}
