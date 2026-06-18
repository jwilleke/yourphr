import {Component, OnInit} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {RouterModule} from '@angular/router';
import {FastenApiService} from '../../services/fasten-api.service';
import {ProviderCatalogEntry, ProviderCatalogEntryRequest} from '../../models/fasten/provider-catalog';
import {LoadingSpinnerComponent} from '../../components/loading-spinner/loading-spinner.component';
import {AdminBackLinkComponent} from '../../components/admin-back-link/admin-back-link.component';
import {extractErrorFromResponse} from '../../../lib/utils/error_extract';

// Admin Provider Catalog (#310): the admin-only CRUD UI for the connectable-provider catalog that
// patients pick from (#306). The client_secret is write-only — it is never returned by the backend
// and never shown here; the list only reports whether one is stored. Reached from the Admin
// Dashboard; the route is gated by IsAdminAuthGuard and every backend endpoint self-gates on admin.
@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, LoadingSpinnerComponent, AdminBackLinkComponent],
  selector: 'app-provider-catalog-admin',
  templateUrl: './provider-catalog-admin.component.html',
})
export class ProviderCatalogAdminComponent implements OnInit {
  entries: ProviderCatalogEntry[] = [];
  loading = true;
  errorMsg = '';
  successMsg = '';

  // Inline create/edit form state. editingId === null => creating a new entry.
  showForm = false;
  editingId: string | null = null;
  form: ProviderCatalogEntryRequest = this.blankForm();

  constructor(private fastenApi: FastenApiService) {}

  ngOnInit(): void {
    this.load();
  }

  private blankForm(): ProviderCatalogEntryRequest {
    return {display: '', environment: 'production', api_endpoint_base_url: '', scopes: '', client_id: '', client_secret: '', platform_type: 'ehr', brand_logo_url: '', enabled: false};
  }

  load(): void {
    this.loading = true;
    this.fastenApi.listProviderCatalogEntries().subscribe(
      (entries) => { this.entries = entries || []; },
      (err) => { this.errorMsg = 'Could not load the provider catalog: ' + (extractErrorFromResponse(err) || 'Unknown Error'); this.loading = false; },
      () => { this.loading = false; },
    );
  }

  newEntry(): void {
    this.editingId = null;
    this.form = this.blankForm();
    this.errorMsg = '';
    this.successMsg = '';
    this.showForm = true;
  }

  editEntry(entry: ProviderCatalogEntry): void {
    this.editingId = entry.id || null;
    // client_secret is intentionally blank — it is never returned; leaving it empty preserves the stored one.
    this.form = {
      display: entry.display,
      environment: entry.environment || 'production',
      api_endpoint_base_url: entry.api_endpoint_base_url,
      scopes: entry.scopes,
      client_id: entry.client_id,
      client_secret: '',
      platform_type: entry.platform_type || 'ehr',
      brand_logo_url: entry.brand_logo_url || '',
      enabled: entry.enabled,
    };
    this.errorMsg = '';
    this.successMsg = '';
    this.showForm = true;
  }

  cancel(): void {
    this.showForm = false;
    this.editingId = null;
  }

  save(): void {
    this.errorMsg = '';
    this.successMsg = '';
    if (!this.form.display.trim() || !this.form.api_endpoint_base_url.trim() || !this.form.client_id.trim()) {
      this.errorMsg = 'Display name, FHIR base URL, and Client ID are required.';
      return;
    }
    const obs = this.editingId
      ? this.fastenApi.updateProviderCatalogEntry(this.editingId, this.form)
      : this.fastenApi.createProviderCatalogEntry(this.form);
    obs.subscribe(
      () => {
        this.successMsg = this.editingId ? 'Provider updated.' : 'Provider added.';
        this.showForm = false;
        this.editingId = null;
        this.load();
      },
      (err) => { this.errorMsg = 'Save failed: ' + (extractErrorFromResponse(err) || 'Unknown Error'); },
    );
  }

  remove(entry: ProviderCatalogEntry): void {
    if (!entry.id) { return; }
    if (!confirm(`Delete "${entry.display}"? Already-connected sources are unaffected.`)) { return; }
    this.errorMsg = '';
    this.successMsg = '';
    this.fastenApi.deleteProviderCatalogEntry(entry.id).subscribe(
      () => { this.successMsg = 'Provider deleted.'; this.load(); },
      (err) => { this.errorMsg = 'Delete failed: ' + (extractErrorFromResponse(err) || 'Unknown Error'); },
    );
  }
}
