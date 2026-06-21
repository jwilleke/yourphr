import {Component, OnInit} from '@angular/core';
import {CommonModule} from '@angular/common';
import {RouterModule} from '@angular/router';
import {FastenApiService} from '../../services/fasten-api.service';
import {ClassifiedAllergy} from '../../models/fasten/classified-allergy';
import {MissingDataComponent} from '../../components/missing-data/missing-data.component';
import {LoadingSpinnerComponent} from '../../components/loading-spinner/loading-spinner.component';

type SortColumn = 'title' | 'state' | 'lastActivity';

// Patient-facing Allergies view (#290) — a deduped list from the backend allergy classifier
// (GET /secure/allergies/classified): one entry per substance (not repeated per encounter), titled by
// the record's text/display, with a first-seen → last-seen date range. "No known allergy" negations are
// shown as their own deduped entries (e.g. "No Known Food Allergies"), never inflating an allergy count.
// The frontend renders; it does not re-derive. Absent fields show the "Data Not Provided" marker.
@Component({
  standalone: true,
  imports: [CommonModule, RouterModule, MissingDataComponent, LoadingSpinnerComponent],
  selector: 'app-allergies',
  templateUrl: './allergies.component.html',
  styleUrls: ['./allergies.component.scss'],
})
export class AllergiesComponent implements OnInit {
  loading = true;
  errored = false;
  allergies: ClassifiedAllergy[] = [];
  filtered: ClassifiedAllergy[] = [];
  expanded: Record<string, boolean> = {};

  showActiveOnly = false;
  sortColumn: SortColumn = 'lastActivity';
  sortDirection: 'asc' | 'desc' = 'desc';

  constructor(private fastenApi: FastenApiService) {}

  ngOnInit(): void {
    this.fastenApi.getClassifiedAllergies().subscribe({
      next: (rows) => {
        this.allergies = rows || [];
        this.applyView();
        this.loading = false;
      },
      error: () => {
        this.errored = true;
        this.loading = false;
      },
    });
  }

  key(a: ClassifiedAllergy): string {
    return `${a.sourceId}/${a.sourceResourceId}`;
  }

  toggleActiveOnly(): void {
    this.showActiveOnly = !this.showActiveOnly;
    this.applyView();
  }

  toggleExpanded(k: string): void {
    this.expanded[k] = !this.expanded[k];
  }

  sortBy(column: SortColumn): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = column === 'lastActivity' ? 'desc' : 'asc';
    }
    this.applyView();
  }

  // The date range as stated: "start – end", or a single date when they coincide / only one is known.
  dateRange(a: ClassifiedAllergy): { start?: string; end?: string } {
    const start = a.start || '';
    const end = a.end || '';
    if (start && end && start.slice(0, 10) !== end.slice(0, 10)) return {start, end};
    return {start: start || end || ''};
  }

  reactionSummary(a: ClassifiedAllergy): string {
    const labels = (a.reactions || []).flatMap((r) => r.manifestations || []);
    return Array.from(new Set(labels)).join(', ');
  }

  private applyView(): void {
    let rows = [...this.allergies];
    if (this.showActiveOnly) {
      rows = rows.filter((a) => a.state === 'Active' && !a.noKnown);
    }
    rows.sort((x, y) => this.compare(x, y));
    this.filtered = rows;
  }

  private compare(a: ClassifiedAllergy, b: ClassifiedAllergy): number {
    const dir = this.sortDirection === 'asc' ? 1 : -1;
    if (this.sortColumn === 'lastActivity') {
      const av = a.lastActivity || a.end || a.start || '';
      const bv = b.lastActivity || b.end || b.start || '';
      if (!av && !bv) return (a.title || '').localeCompare(b.title || '');
      if (!av) return 1;
      if (!bv) return -1;
      return dir * (new Date(av).getTime() - new Date(bv).getTime());
    }
    const av = String((a as any)[this.sortColumn] || '');
    const bv = String((b as any)[this.sortColumn] || '');
    return dir * av.localeCompare(bv);
  }

  stateBadgeClass(state: string): string {
    switch (state) {
      case 'Active': return 'badge-danger';
      case 'Inactive': return 'badge-secondary';
      case 'Resolved': return 'badge-secondary';
      case 'RuledOut': return 'badge-light';
      default: return 'badge-light';
    }
  }
}
