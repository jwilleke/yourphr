import {Component} from '@angular/core';
import {CommonModule} from '@angular/common';
import {RouterModule} from '@angular/router';

// Admin Dashboard (#170): the single admin hub — a grid of cards, each linking to a dedicated admin
// page (Sandbox Testing, Provider Catalog, Server Logs, …). The route is gated by IsAdminAuthGuard and
// each target page + backend endpoint also self-gates on the admin role. Every linked page carries a
// shared <app-admin-back-link> back to here.
@Component({
  standalone: true,
  imports: [CommonModule, RouterModule],
  selector: 'app-admin-dashboard',
  templateUrl: './admin-dashboard.component.html',
  styleUrls: ['./admin-dashboard.component.scss'],
})
export class AdminDashboardComponent {}
