import {Component, OnInit} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {FastenApiService} from '../../services/fasten-api.service';
import {DatabaseInfo} from '../../models/fasten/database-info';
import {AdminBackLinkComponent} from '../../components/admin-back-link/admin-back-link.component';
import {LoadingSpinnerComponent} from '../../components/loading-spinner/loading-spinner.component';

// Admin Database page (#361): runtime DB facts + a safe online backup written to a server-side folder.
// Admin-only (route guarded + backend self-gates). A backup is the ENTIRE single-file DB — every user's
// full records (PHI) — so the UI warns. The destination folder defaults to the last-used location.
@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, AdminBackLinkComponent, LoadingSpinnerComponent],
  selector: 'app-admin-database',
  templateUrl: './admin-database.component.html',
  styleUrls: ['./admin-database.component.scss'],
})
export class AdminDatabaseComponent implements OnInit {
  loading = true;
  errored = false;
  info: DatabaseInfo | null = null;
  destination = '';
  backingUp = false;     // server-side (fire-and-forget) backup in progress
  downloading = false;   // on-demand download in progress (must stay on page)
  backupError = '';
  backupResult = '';

  constructor(private fastenApi: FastenApiService) {}

  ngOnInit(): void {
    this.load(true);
  }

  private load(initial: boolean): void {
    this.fastenApi.getDatabaseInfo().subscribe({
      next: (info) => {
        this.info = info;
        // Default the destination to the last-used folder; don't clobber what the admin is typing.
        if (initial || !this.destination) { this.destination = info.backup_destination; }
        this.loading = false;
      },
      error: () => { this.errored = true; this.loading = false; },
    });
  }

  humanSize(bytes: number): string {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  backup(): void {
    this.backingUp = true;
    this.backupError = '';
    this.backupResult = '';
    this.fastenApi.backupDatabase(this.destination).subscribe({
      next: (res) => {
        this.backupResult = `Saved ${res.filename} (${this.humanSize(res.size_bytes)}) to ${res.destination}`;
        this.backingUp = false;
        this.load(false); // refresh the backups list + destination
      },
      error: (e) => {
        this.backupError = e?.error?.error || 'Backup failed — check the server logs.';
        this.backingUp = false;
      },
    });
  }

  // downloadBackup streams a fresh backup to the browser; the Save dialog picks the location. You must
  // stay on the page until it finishes (a browser download cancels if you navigate away) — hence a
  // spinner. Reuses the source-export download pattern.
  downloadBackup(): void {
    this.downloading = true;
    this.backupError = '';
    this.backupResult = '';
    this.fastenApi.downloadBackup().subscribe({
      next: (resp) => {
        const blob = resp.body;
        if (!blob) { this.downloading = false; return; }
        const disposition = resp.headers.get('Content-Disposition') || '';
        const match = /filename="?([^";]+)"?/i.exec(disposition);
        const filename = (match && match[1].trim()) || 'yourphr-backup.db.gz';
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        this.backupResult = `Downloaded ${filename} (${this.humanSize(blob.size)}).`;
        this.downloading = false;
      },
      error: () => {
        this.backupError = 'Download failed — check the server logs.';
        this.downloading = false;
      },
    });
  }
}
