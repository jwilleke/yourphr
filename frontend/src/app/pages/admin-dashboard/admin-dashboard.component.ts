import {Component, OnInit} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FastenApiService} from '../../services/fasten-api.service';
import {ServerLogs} from '../../models/fasten/server-logs';
import {LoadingSpinnerComponent} from '../../components/loading-spinner/loading-spinner.component';

// Admin Dashboard (#170): an admin-only page, a grid of cards that grows over time. v1 card:
// Server Logs. The route is gated by IsAdminAuthGuard and each backend endpoint also self-gates on
// the admin role.
@Component({
  standalone: true,
  imports: [CommonModule, LoadingSpinnerComponent],
  selector: 'app-admin-dashboard',
  templateUrl: './admin-dashboard.component.html',
  styleUrls: ['./admin-dashboard.component.scss'],
})
export class AdminDashboardComponent implements OnInit {
  // --- Server Logs card ---
  logsLoading = true;
  logsErrored = false;
  logs?: ServerLogs;

  constructor(private fastenApi: FastenApiService) {}

  ngOnInit(): void {
    this.loadLogs();
  }

  loadLogs(): void {
    this.logsLoading = true;
    this.logsErrored = false;
    this.fastenApi.getServerLogs().subscribe({
      next: (logs) => {
        this.logs = logs;
        this.logsLoading = false;
      },
      error: () => {
        this.logsErrored = true;
        this.logsLoading = false;
      },
    });
  }
}
