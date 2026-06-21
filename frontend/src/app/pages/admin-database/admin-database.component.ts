import {Component, OnInit} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FastenApiService} from '../../services/fasten-api.service';
import {DatabaseInfo} from '../../models/fasten/database-info';
import {AdminBackLinkComponent} from '../../components/admin-back-link/admin-back-link.component';
import {LoadingSpinnerComponent} from '../../components/loading-spinner/loading-spinner.component';

// Admin Database page (#361): runtime DB facts + a safe online backup. Admin-only (route guarded +
// backend self-gates). The backup is the ENTIRE single-file DB — every user's full records (PHI) — so
// the UI warns before download.
@Component({
  standalone: true,
  imports: [CommonModule, AdminBackLinkComponent, LoadingSpinnerComponent],
  selector: 'app-admin-database',
  templateUrl: './admin-database.component.html',
  styleUrls: ['./admin-database.component.scss'],
})
export class AdminDatabaseComponent implements OnInit {
  loading = true;
  errored = false;
  info: DatabaseInfo | null = null;
  backingUp = false;
  backupError = '';

  constructor(private fastenApi: FastenApiService) {}

  ngOnInit(): void {
    this.fastenApi.getDatabaseInfo().subscribe({
      next: (info) => { this.info = info; this.loading = false; },
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
    this.fastenApi.backupDatabase().subscribe({
      next: (resp) => {
        const blob = resp.body as Blob;
        let filename = 'yourphr-backup.db';
        const cd = resp.headers.get('Content-Disposition');
        const m = cd ? /filename="?([^"]+)"?/.exec(cd) : null;
        if (m) { filename = m[1]; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        this.backingUp = false;
      },
      error: () => { this.backupError = 'Backup failed — check the server logs.'; this.backingUp = false; },
    });
  }
}
