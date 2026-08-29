import {Component, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {AuthService} from '../../services/auth.service';

/**
 * DemoEntryComponent is the deep-link entrance to a public demo (#517): /demo signs a visitor in as
 * the demo patient, /demo-admin as the read-only demo admin (#516).
 *
 * WHY A URL AND NOT JUST THE BUTTON. The button on the sign-in page serves someone who wanders in.
 * The case that matters is a link in an email or on a CMS application form, and sending someone to
 * the root of a personal health record shows them a login form — the last thing a reviewer should
 * meet. One link should land inside the product.
 *
 * INERT ON AN ORDINARY INSTALL. The endpoints answer 403 unless demo mode is on, so these routes
 * exist everywhere and do nothing anywhere else: the visitor is sent to the sign-in page with the
 * same message any other failure produces, and nothing here reveals whether demo mode exists.
 */
@Component({
    selector: 'app-demo-entry',
    templateUrl: './demo-entry.component.html',
    // Declared in AppModule like every other page here. Angular now defaults components to
    // standalone, and the AOT build fails with NG6008 without this.
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class DemoEntryComponent implements OnInit {
  // Set from the route's data, so the two entrances share one component rather than one duplicating
  // the other's error handling.
  asAdmin = false

  constructor(
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
  ) { }

  async ngOnInit(): Promise<void> {
    this.asAdmin = this.route.snapshot.data?.['asAdmin'] === true

    // Sign out whatever session is already here first, so the link means the same thing every time
    // rather than "whoever you happened to be". Logout is best-effort: a failure here must not stop
    // the demo from opening.
    try {
      await this.authService.Logout()
    } catch (err) {
      // Nothing to do — the sign-in below replaces the token either way.
    }

    try {
      if (this.asAdmin) {
        await this.authService.DemoAdminSignin()
        await this.router.navigate(['/admin'])
      } else {
        await this.authService.DemoSignin()
        await this.router.navigate(['/dashboard'])
      }
    } catch (err) {
      await this.router.navigate(['/auth/signin'], {
        queryParams: {demo_unavailable: 1},
      })
    }
  }
}
