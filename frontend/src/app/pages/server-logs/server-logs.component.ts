import {Component, OnDestroy, OnInit} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {FastenApiService} from '../../services/fasten-api.service';
import {ServerLogs} from '../../models/fasten/server-logs';
import {LoadingSpinnerComponent} from '../../components/loading-spinner/loading-spinner.component';
import {AdminBackLinkComponent} from '../../components/admin-back-link/admin-back-link.component';
import {extractErrorFromResponse} from '../../../lib/utils/error_extract';

// Server Logs (#170): its own admin page (/admin/logs). Logs come from an in-memory ring buffer on the
// server, so recent lines are always visible — no log.file, no restart. The admin can change the
// running log level here (runtime-only; resets to the configured default on restart). A live tail
// (auto-refresh) streams new lines so a level change is immediately visible. Admin-gated.
@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, LoadingSpinnerComponent, AdminBackLinkComponent],
  selector: 'app-server-logs',
  templateUrl: './server-logs.component.html',
})
export class ServerLogsComponent implements OnInit, OnDestroy {
  loading = true;
  errored = false;
  logs?: ServerLogs;

  level = '';
  levelSaving = false;
  levelMsg = '';

  live = true;                 // auto-refresh on
  private pollMs = 3000;
  private pollId: any = null;

  constructor(private fastenApi: FastenApiService) {}

  ngOnInit(): void {
    this.load();
    this.startPolling();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  // load fetches the current buffer + level. `quiet` skips the loading spinner (used by the live poll
  // so the view doesn't flicker every few seconds).
  load(quiet = false): void {
    if (!quiet) { this.loading = true; }
    this.errored = false;
    this.fastenApi.getServerLogs().subscribe({
      next: (logs) => { this.logs = logs; this.level = logs.level; this.loading = false; },
      error: () => { this.errored = true; this.loading = false; },
    });
  }

  toggleLive(): void {
    this.live = !this.live;
    if (this.live) { this.startPolling(); this.load(true); } else { this.stopPolling(); }
  }

  private startPolling(): void {
    this.stopPolling();
    if (!this.live) { return; }
    this.pollId = setInterval(() => this.load(true), this.pollMs);
  }

  private stopPolling(): void {
    if (this.pollId) { clearInterval(this.pollId); this.pollId = null; }
  }

  // Change the running log level immediately, then refresh so newly-visible lines appear.
  onLevelChange(level: string): void {
    this.levelSaving = true;
    this.levelMsg = '';
    this.fastenApi.setServerLogLevel(level).subscribe({
      next: (res) => {
        this.level = res.level;
        this.levelSaving = false;
        this.levelMsg = `Log level set to ${res.level}. New lines at this level appear as the server logs activity.`;
        this.load(true);
      },
      error: (err) => { this.levelSaving = false; this.levelMsg = 'Could not change level: ' + (extractErrorFromResponse(err) || 'Unknown Error'); },
    });
  }
}
