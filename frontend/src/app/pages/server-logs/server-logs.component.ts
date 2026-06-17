import {Component, OnInit} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FastenApiService} from '../../services/fasten-api.service';
import {ServerLogs} from '../../models/fasten/server-logs';
import {LoadingSpinnerComponent} from '../../components/loading-spinner/loading-spinner.component';
import {AdminBackLinkComponent} from '../../components/admin-back-link/admin-back-link.component';

// Server Logs (#170): its own admin page (/admin/logs), reached from the Admin Dashboard like the
// other cards. Shows the tail of the configured log file; when log.file is unset the backend reports
// configured=false and we explain how to enable it. Admin-gated route; the endpoint self-gates too.
@Component({
  standalone: true,
  imports: [CommonModule, LoadingSpinnerComponent, AdminBackLinkComponent],
  selector: 'app-server-logs',
  templateUrl: './server-logs.component.html',
})
export class ServerLogsComponent implements OnInit {
  loading = true;
  errored = false;
  logs?: ServerLogs;

  constructor(private fastenApi: FastenApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.errored = false;
    this.fastenApi.getServerLogs().subscribe({
      next: (logs) => { this.logs = logs; this.loading = false; },
      error: () => { this.errored = true; this.loading = false; },
    });
  }
}
