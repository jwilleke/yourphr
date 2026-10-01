import {Component, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {CommonModule} from '@angular/common';
import {RouterModule} from '@angular/router';
import {FastenApiService} from '../../services/fasten-api.service';
import {AppNotification} from '../../models/fasten/app-notification';

/** Plain words for where a link goes, so the button says it instead of showing a path. */
const PLACES: Record<string, string> = {
  '/admin/database': 'Admin → Database',
  '/admin/config': 'Admin → Configuration',
  '/admin/logs': 'Admin → Server logs',
  '/admin/provider-catalog': 'Admin → Provider catalog',
};

// The admin home's Notifications panel (#854), modelled on ngdpbase's System Notifications card:
// count, newest first, coloured by level, dismiss each or all. Unlike ngdpbase's, every notice that
// has somewhere to be dealt with links straight there — the reason this exists is that a stale search
// index sat as one row two clicks deep, and "no one will ever do that" (Jim, 2026-10-01).
@Component({
  standalone: true,
  imports: [CommonModule, RouterModule],
  selector: 'app-admin-notifications-panel',
  templateUrl: './admin-notifications-panel.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class AdminNotificationsPanelComponent implements OnInit {
  notifications: AppNotification[] = [];
  loading = true;
  errored = false;

  constructor(private fastenApi: FastenApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.fastenApi.getNotifications().subscribe({
      next: (list) => {
        this.notifications = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));
        this.loading = false;
        this.errored = false;
      },
      error: () => { this.loading = false; this.errored = true; },
    });
  }

  alertClass(n: AppNotification): string {
    return {error: 'alert-danger', warning: 'alert-warning', success: 'alert-success'}[n.level] ?? 'alert-info';
  }

  icon(n: AppNotification): string {
    return {error: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle', success: 'fa-check-circle'}[n.level] ?? 'fa-info-circle';
  }

  place(link: string): string {
    return PLACES[link] ?? 'Open';
  }

  dismiss(n: AppNotification): void {
    this.notifications = this.notifications.filter((x) => x.id !== n.id);
    this.fastenApi.dismissNotification(n.id).subscribe({error: () => this.load()});
  }

  dismissAll(): void {
    if (!confirm('Dismiss every notification? They are hidden from you only; other admins still see them.')) return;
    this.notifications = [];
    this.fastenApi.dismissAllNotifications().subscribe({error: () => this.load()});
  }
}
