import {Component, OnInit} from '@angular/core';
import {CommonModule} from '@angular/common';
import {RouterModule} from '@angular/router';
import {NgbCollapseModule} from '@ng-bootstrap/ng-bootstrap';
import {FastenApiService} from '../../services/fasten-api.service';
import {ReconciledMedication} from '../../models/fasten/reconciled-medication';
import {MissingDataComponent} from '../../components/missing-data/missing-data.component';
import {LoadingSpinnerComponent} from '../../components/loading-spinner/loading-spinner.component';

type SortColumn = 'title' | 'state' | 'lastActivity';

// The patient-facing "Current Medications" view (#179): a reconciled, de-duplicated list derived by
// the backend (GET /secure/medications/reconciled). The frontend does not re-derive — it renders the
// list, lets the user sort/filter, and links out to authoritative drug info. Absent expected fields
// show the shared "Data Not Provided" marker (no guessing).
@Component({
  standalone: true,
  imports: [CommonModule, RouterModule, NgbCollapseModule, MissingDataComponent, LoadingSpinnerComponent],
  selector: 'app-current-medications',
  templateUrl: './current-medications.component.html',
  styleUrls: ['./current-medications.component.scss'],
})
export class CurrentMedicationsComponent implements OnInit {
  loading = true;
  errored = false;
  medications: ReconciledMedication[] = [];
  filtered: ReconciledMedication[] = [];
  expanded: Record<string, boolean> = {};

  showActiveOnly = false;
  sortColumn: SortColumn = 'lastActivity';
  sortDirection: 'asc' | 'desc' = 'desc'; // default: newest on top

  // RxNorm code-system OID for MedlinePlus Connect.
  private static readonly RXNORM_OID = '2.16.840.1.113883.6.88';

  constructor(private fastenApi: FastenApiService) {}

  ngOnInit(): void {
    this.fastenApi.getReconciledMedications().subscribe({
      next: (meds) => {
        this.medications = meds || [];
        this.applyView();
        this.loading = false;
      },
      error: () => {
        this.errored = true;
        this.loading = false;
      },
    });
  }

  toggleActiveOnly(): void {
    this.showActiveOnly = !this.showActiveOnly;
    this.applyView();
  }

  toggleExpanded(key: string): void {
    this.expanded[key] = !this.expanded[key];
  }

  sortBy(column: SortColumn): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      // dates default to newest-first; text columns to A→Z
      this.sortDirection = column === 'lastActivity' ? 'desc' : 'asc';
    }
    this.applyView();
  }

  private applyView(): void {
    let rows = [...this.medications];
    if (this.showActiveOnly) {
      rows = rows.filter((m) => m.state === 'Active');
    }
    rows.sort((a, b) => this.compare(a, b));
    this.filtered = rows;
  }

  private compare(a: ReconciledMedication, b: ReconciledMedication): number {
    const dir = this.sortDirection === 'asc' ? 1 : -1;
    if (this.sortColumn === 'lastActivity') {
      // Undated rows always sink to the bottom, regardless of direction (no invented dates).
      if (!a.lastActivity && !b.lastActivity) return (a.title || '').localeCompare(b.title || '');
      if (!a.lastActivity) return 1;
      if (!b.lastActivity) return -1;
      return dir * (new Date(a.lastActivity).getTime() - new Date(b.lastActivity).getTime());
    }
    const av = String((a as any)[this.sortColumn] || '');
    const bv = String((b as any)[this.sortColumn] || '');
    return dir * av.localeCompare(bv);
  }

  // Authoritative consumer drug info (MedlinePlus, NLM). Only when we have an RxCUI — the Connect
  // endpoint is code-based; we don't fabricate a link without one. Pure href; nothing is fetched
  // until the patient clicks, and only the drug name/RxCUI travels — never patient identity.
  medlinePlusUrl(med: ReconciledMedication): string | null {
    if (!med.rxNormCode) return null;
    const params = new URLSearchParams({
      'mainSearchCriteria.v.cs': CurrentMedicationsComponent.RXNORM_OID,
      'mainSearchCriteria.v.c': med.rxNormCode,
      'mainSearchCriteria.v.dn': med.title || '',
      'informationRecipient.languageCode.c': 'en',
    });
    return `https://connect.medlineplus.gov/application?${params.toString()}`;
  }

  // FDA label via DailyMed — works by drug name, so it is always available.
  dailyMedUrl(med: ReconciledMedication): string {
    return `https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=${encodeURIComponent(med.title || '')}`;
  }

  stateBadgeClass(state: string): string {
    switch (state) {
      case 'Active': return 'badge-success';
      case 'Suspended': return 'badge-warning';
      case 'Past': return 'badge-secondary';
      default: return 'badge-light';
    }
  }
}
