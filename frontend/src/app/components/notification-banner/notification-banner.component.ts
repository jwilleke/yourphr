import {Component, OnDestroy, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {NavigationEnd, Router, RouterModule} from '@angular/router';
import {Subscription} from 'rxjs';
import {filter} from 'rxjs/operators';
import {FastenApiService} from '../../services/fasten-api.service';
import {AppNotification, notificationLinkLabel} from '../../models/fasten/app-notification';
import {AuthService} from '../../services/auth.service';

/** How often, at most, a navigation re-asks the server. A banner a minute late is fine; a request per click is not. */
const REFRESH_MS = 60_000;

// The signed-in person's notifications, across the top of every page (#793) — first, the alert that
// no backup has succeeded (#789), which must reach an admin without them going to look for it.
// ngdpbase renders these in its server views; this is the Angular shell's equivalent. Dismissing one
// hides it from this person only.
@Component({
  standalone: true,
  imports: [RouterModule],
  selector: 'app-notification-banner',
  templateUrl: './notification-banner.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class NotificationBannerComponent implements OnInit, OnDestroy {
  notifications: AppNotification[] = [];
  /** The operator's maintenance message while maintenance is on; '' when it is off (#869). */
  maintenance = '';
  private lastFetch = 0;
  private sub?: Subscription;
  /** Whether an /admin link would open for this person; everyone else sees the notice without it (#854). */
  isAdmin = false;

  constructor(private fastenApi: FastenApiService, private router: Router, private authService: AuthService) {}

  ngOnInit() {
    this.authService.IsAdmin().then((admin) => this.isAdmin = admin, () => this.isAdmin = false);
    this.refresh(true);
    this.sub = this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.refresh());
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  refresh(force = false) {
    const now = Date.now();
    if (!force && now - this.lastFetch < REFRESH_MS) return;
    this.lastFetch = now;
    // Maintenance comes from the live setting (#869), as ngdpbase's admin dashboard does: shown while
    // it is on, gone the moment it is off. A stored "maintenance on" notice says what was true when
    // it was written, and one left behind told every member the system was down when it was not.
    this.fastenApi.getPublicInstanceInfo().subscribe({
      next: (info) => this.maintenance = info.maintenance_enabled ? (info.maintenance_message || 'This instance is in maintenance mode.') : '',
      error: () => this.maintenance = '',
    });
    this.fastenApi.getNotifications().subscribe({
      next: (list) => this.notifications = list.filter((n) => n.type !== 'maintenance'),
      // Signed out, or the server is away: show nothing rather than an error about a banner.
      error: () => this.notifications = [],
    });
  }

  alertClass(n: AppNotification): string {
    return {error: 'alert-danger', warning: 'alert-warning', success: 'alert-success'}[n.level] ?? 'alert-info';
  }

  icon(n: AppNotification): string {
    return {error: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle', success: 'fa-check-circle'}[n.level] ?? 'fa-info-circle';
  }

  /** The link, when this person can follow it: a member is never offered an admin screen they would be refused. */
  linkFor(n: AppNotification): string | undefined {
    if (!n.link) return undefined;
    return n.link.startsWith('/admin') && !this.isAdmin ? undefined : n.link;
  }

  linkLabel(link: string): string {
    return notificationLinkLabel(link);
  }

  dismiss(n: AppNotification) {
    this.notifications = this.notifications.filter((x) => x.id !== n.id);
    this.fastenApi.dismissNotification(n.id).subscribe({error: () => this.refresh(true)});
  }
}
