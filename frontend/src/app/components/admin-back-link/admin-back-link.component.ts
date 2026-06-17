import {Component} from '@angular/core';
import {CommonModule} from '@angular/common';
import {RouterModule} from '@angular/router';

// AdminBackLinkComponent is the single, consistent "Back to Admin Dashboard" control placed at the top
// of every admin sub-page (Sandbox, Provider Catalog, Server Logs, Users…). Standalone so it can be
// imported by both standalone pages and the NgModule that declares the older admin pages — one
// definition, identical look + action everywhere. Reached pages link back to /admin.
@Component({
  standalone: true,
  imports: [CommonModule, RouterModule],
  selector: 'app-admin-back-link',
  template: `
    <a routerLink="/admin" class="btn btn-sm btn-outline-secondary mg-b-20">
      <i class="fas fa-arrow-left mg-r-5"></i> Back to Admin Dashboard
    </a>
  `,
})
export class AdminBackLinkComponent {}
