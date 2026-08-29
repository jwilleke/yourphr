import {Component, OnInit, ChangeDetectionStrategy} from '@angular/core';

import {FormsModule} from '@angular/forms';
import {FastenApiService} from '../../services/fasten-api.service';
import {AdminConfig, ConfigEntry} from '../../models/fasten/admin-config';
import {AdminBackLinkComponent} from '../../components/admin-back-link/admin-back-link.component';
import {LoadingSpinnerComponent} from '../../components/loading-spinner/loading-spinner.component';

type TabId = 'current' | 'custom' | 'defaults';

// Admin Configuration page (#458). Admin-only.
//
// Answers the question an operator cannot answer today — what is this instance actually
// configured to do, and which of it did I choose? A value that silently fell back to a default is
// indistinguishable from one set on purpose, which is the ambiguity behind #397 and #399.
//
// Three tabs rather than ngdpbase's four: its fourth is "Add New Property", and the backend
// rejects keys outside the shipped catalogue (#456 guarantees it is complete), so a free-form add
// form would only ever produce errors. Overriding any known key is done from the rows themselves.
@Component({
  standalone: true,
  imports: [FormsModule, AdminBackLinkComponent, LoadingSpinnerComponent],
  selector: 'app-admin-config',
  templateUrl: './admin-config.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./admin-config.component.scss'],
})
export class AdminConfigComponent implements OnInit {
  config: AdminConfig | null = null;
  loading = true;
  error = '';

  activeTab: TabId = 'current';
  filter = '';

  // Values revealed this session, by key. Populated only by an explicit click — the listing never
  // carries them.
  revealed: Record<string, any> = {};

  // The key currently being edited, and its working value.
  editingKey = '';
  editingValue: any = '';
  saving = false;

  constructor(private fastenApi: FastenApiService) {}

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading = true;
    this.error = '';
    this.fastenApi.getAdminConfig().subscribe({
      next: (config) => {
        this.config = config;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Could not load the configuration.';
        this.loading = false;
      },
    });
  }

  get entries(): ConfigEntry[] {
    const all = this.config?.entries || [];
    const scoped = this.activeTab === 'custom' ? all.filter((e) => e.source === 'custom') : all;
    const needle = this.filter.trim().toLowerCase();
    return needle ? scoped.filter((e) => e.key.includes(needle)) : scoped;
  }

  get customCount(): number {
    return (this.config?.entries || []).filter((e) => e.source === 'custom').length;
  }

  // What to print in the value column: a revealed value if one was fetched, else whatever the
  // listing gave us (the real value for public keys, a placeholder otherwise).
  displayValue(entry: ConfigEntry): any {
    if (Object.prototype.hasOwnProperty.call(this.revealed, entry.key)) {
      return this.format(this.revealed[entry.key]);
    }
    return this.format(entry.value);
  }

  displayDefault(entry: ConfigEntry): any {
    return this.format(entry.default);
  }

  // Arrays and objects are settings too; print them as JSON rather than "[object Object]".
  private format(value: any): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  isRevealed(entry: ConfigEntry): boolean {
    return Object.prototype.hasOwnProperty.call(this.revealed, entry.key);
  }

  reveal(entry: ConfigEntry) {
    if (this.isRevealed(entry)) {
      delete this.revealed[entry.key];
      return;
    }
    this.fastenApi.revealAdminConfigValue(entry.key).subscribe({
      next: (result) => { this.revealed[entry.key] = result.value; },
      error: (err) => { this.error = err?.error?.error || `Could not reveal ${entry.key}.`; },
    });
  }

  startEdit(entry: ConfigEntry) {
    this.editingKey = entry.key;
    this.error = '';

    // Edit against the real value where we have one. For a masked key that has not been revealed,
    // start empty rather than seeding the field with the placeholder — saving "••••••••" as a
    // secret would be a quiet disaster.
    if (this.isRevealed(entry)) {
      this.editingValue = this.revealed[entry.key];
    } else if (entry.masked) {
      this.editingValue = typeof entry.default === 'boolean' ? false : '';
    } else {
      this.editingValue = entry.value;
    }

    if (typeof this.editingValue === 'object' && this.editingValue !== null) {
      this.editingValue = JSON.stringify(this.editingValue);
    }
  }

  cancelEdit() {
    this.editingKey = '';
    this.editingValue = '';
  }

  isBoolean(entry: ConfigEntry): boolean {
    return typeof entry.default === 'boolean' || typeof entry.value === 'boolean';
  }

  isNumber(entry: ConfigEntry): boolean {
    return typeof entry.default === 'number' || typeof entry.value === 'number';
  }

  save(entry: ConfigEntry) {
    this.saving = true;
    this.error = '';

    let value: any = this.editingValue;
    if (this.isNumber(entry)) {
      value = Number(value);
    } else if (this.isBoolean(entry)) {
      value = value === true || value === 'true';
    } else if (typeof entry.default === 'object' && entry.default !== null) {
      // Arrays (the `public` list) are edited as JSON text.
      try {
        value = JSON.parse(value);
      } catch {
        this.error = `${entry.key}: not valid JSON.`;
        this.saving = false;
        return;
      }
    }

    this.fastenApi.setAdminConfigValue(entry.key, value).subscribe({
      next: () => {
        this.saving = false;
        this.cancelEdit();
        // A revealed value is stale once changed; drop it so the next reveal fetches afresh.
        delete this.revealed[entry.key];
        this.load();
      },
      error: (err) => {
        this.error = err?.error?.error || `Could not save ${entry.key}.`;
        this.saving = false;
      },
    });
  }

  reset(entry: ConfigEntry) {
    this.saving = true;
    this.error = '';
    this.fastenApi.resetAdminConfigValue(entry.key).subscribe({
      next: () => {
        this.saving = false;
        delete this.revealed[entry.key];
        this.load();
      },
      error: (err) => {
        this.error = err?.error?.error || `Could not reset ${entry.key}.`;
        this.saving = false;
      },
    });
  }
}
