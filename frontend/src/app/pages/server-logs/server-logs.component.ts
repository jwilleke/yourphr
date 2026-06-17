import {Component, OnInit} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {FastenApiService} from '../../services/fasten-api.service';
import {ServerLogs} from '../../models/fasten/server-logs';
import {LoadingSpinnerComponent} from '../../components/loading-spinner/loading-spinner.component';
import {AdminBackLinkComponent} from '../../components/admin-back-link/admin-back-link.component';
import {extractErrorFromResponse} from '../../../lib/utils/error_extract';

// Server Logs (#170): its own admin page (/admin/logs). Logs come from an in-memory ring buffer on the
// server, so recent lines are always visible — no log.file, no restart. The admin can also change the
// running log level here (runtime-only; resets to the configured default on restart). Admin-gated.
@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, LoadingSpinnerComponent, AdminBackLinkComponent],
  selector: 'app-server-logs',
  templateUrl: './server-logs.component.html',
})
export class ServerLogsComponent implements OnInit {
  loading = true;
  errored = false;
  logs?: ServerLogs;

  level = '';
  levelSaving = false;
  levelMsg = '';

  constructor(private fastenApi: FastenApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.errored = false;
    this.fastenApi.getServerLogs().subscribe({
      next: (logs) => { this.logs = logs; this.level = logs.level; this.loading = false; },
      error: () => { this.errored = true; this.loading = false; },
    });
  }

  // Change the running log level immediately. Reloads so newly-visible (e.g. debug) lines appear.
  onLevelChange(level: string): void {
    this.levelSaving = true;
    this.levelMsg = '';
    this.fastenApi.setServerLogLevel(level).subscribe({
      next: (res) => { this.level = res.level; this.levelSaving = false; this.levelMsg = `Log level set to ${res.level}.`; this.load(); },
      error: (err) => { this.levelSaving = false; this.levelMsg = 'Could not change level: ' + (extractErrorFromResponse(err) || 'Unknown Error'); },
    });
  }
}
