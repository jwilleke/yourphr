import {Component, OnInit} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {FastenApiService} from '../../services/fasten-api.service';
import {DatabaseInfo, BackupSettings, DirListing} from '../../models/fasten/database-info';
import {AdminBackLinkComponent} from '../../components/admin-back-link/admin-back-link.component';
import {LoadingSpinnerComponent} from '../../components/loading-spinner/loading-spinner.component';

// Admin Database page (#361): runtime DB facts; on-demand backup (download w/ spinner, or fire-and-forget
// to a server folder); and a settable auto-backup schedule (enable + time-of-day + days + destination +
// retention), aligned to the ngdpbase BackupManager. Admin-only.
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

  schedule: BackupSettings = {enabled: false, time: '02:00', days: 'daily', destination: '', max_backups: 7};

  backingUp = false;     // server-side (fire-and-forget) backup in progress
  downloading = false;   // on-demand download in progress (must stay on page)
  savingSchedule = false;
  backupError = '';
  backupResult = '';
  scheduleMsg = '';

  // Server-folder browser
  browsing = false;
  browse: DirListing | null = null;
  browseError = '';

  // Restore
  restoring = '';   // backup filename currently being restored
  restoreMsg = '';

  constructor(private fastenApi: FastenApiService) {}

  ngOnInit(): void {
    this.load(true);
  }

  private load(initial: boolean): void {
    this.fastenApi.getDatabaseInfo().subscribe({
      next: (info) => {
        this.info = info;
        if (initial && info.schedule) { this.schedule = {...info.schedule}; }
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

  // Fire-and-forget server-side backup to the configured destination folder (leave the page freely).
  backup(): void {
    this.backingUp = true;
    this.backupError = '';
    this.backupResult = '';
    this.fastenApi.backupDatabase(this.schedule.destination).subscribe({
      next: (res) => {
        this.backupResult = `Saved ${res.filename} (${this.humanSize(res.size_bytes)}) to ${res.destination}`;
        this.backingUp = false;
        this.load(false);
      },
      error: (e) => {
        this.backupError = e?.error?.error || 'Backup failed — check the server logs.';
        this.backingUp = false;
      },
    });
  }

  // On-demand download; the browser Save dialog picks the location. Stay on the page until done.
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

  openBrowser(): void {
    this.browsing = true;
    this.browseError = '';
    this.loadBrowse(this.schedule.destination || '');
  }
  private loadBrowse(path: string): void {
    this.fastenApi.browseDirectories(path).subscribe({
      next: (d) => { this.browse = d; this.browseError = ''; },
      error: (e) => { this.browseError = e?.error?.error || 'Cannot read that folder.'; },
    });
  }
  navigateInto(dir: string): void {
    if (this.browse) { this.loadBrowse(this.joinPath(this.browse.path, dir)); }
  }
  navigateUp(): void {
    if (this.browse?.parent) { this.loadBrowse(this.browse.parent); }
  }
  useFolder(): void {
    if (this.browse) { this.schedule.destination = this.browse.path; this.browsing = false; }
  }
  private joinPath(a: string, b: string): string {
    return a.endsWith('/') ? a + b : a + '/' + b;
  }

  // restore stages a restore from a listed backup; applied on the next restart. Requires a typed
  // confirmation because it replaces the entire database (every user's records).
  restore(name: string): void {
    const typed = window.prompt(
      `This will REPLACE the entire database — every user's records — with "${name}" on the next app restart.\n\nType "restore" to confirm:`);
    if (typed !== 'restore') { return; }
    this.restoring = name;
    this.restoreMsg = '';
    this.fastenApi.restoreDatabase(name).subscribe({
      next: (res) => { this.restoreMsg = res.message || 'Restore staged. Restart the app to apply.'; this.restoring = ''; this.load(false); },
      error: (e) => { this.restoreMsg = e?.error?.error || 'Restore failed.'; this.restoring = ''; },
    });
  }

  saveSchedule(): void {
    this.savingSchedule = true;
    this.scheduleMsg = '';
    this.fastenApi.setBackupSchedule(this.schedule).subscribe({
      next: (s) => {
        this.schedule = {...s};
        this.scheduleMsg = 'Schedule saved.';
        this.savingSchedule = false;
        this.load(false);
      },
      error: (e) => {
        this.scheduleMsg = e?.error?.error || 'Could not save the schedule.';
        this.savingSchedule = false;
      },
    });
  }
}
