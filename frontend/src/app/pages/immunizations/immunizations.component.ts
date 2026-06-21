import {Component, OnInit} from '@angular/core';
import {CommonModule} from '@angular/common';
import {RouterModule} from '@angular/router';
import {FastenApiService} from '../../services/fasten-api.service';
import {ClassifiedImmunization} from '../../models/fasten/classified-immunization';
import {MissingDataComponent} from '../../components/missing-data/missing-data.component';
import {LoadingSpinnerComponent} from '../../components/loading-spinner/loading-spinner.component';

type SortColumn = 'title' | 'state' | 'lastActivity';

// Patient-facing Immunizations view (#289) — a deduped list from the backend immunization classifier
// (GET /secure/immunizations/classified): one entry per vaccine (not repeated per encounter), titled by
// the record's text/display, showing the most recent administration date and a dose count when the same
// vaccine was given more than once. The frontend renders; it does not re-derive.
@Component({
  standalone: true,
  imports: [CommonModule, RouterModule, MissingDataComponent, LoadingSpinnerComponent],
  selector: 'app-immunizations',
  templateUrl: './immunizations.component.html',
  styleUrls: ['./immunizations.component.scss'],
})
export class ImmunizationsComponent implements OnInit {
  loading = true;
  errored = false;
  immunizations: ClassifiedImmunization[] = [];
  filtered: ClassifiedImmunization[] = [];
  expanded: Record<string, boolean> = {};

  sortColumn: SortColumn = 'lastActivity';
  sortDirection: 'asc' | 'desc' = 'desc';

  constructor(private fastenApi: FastenApiService) {}

  ngOnInit(): void {
    this.fastenApi.getClassifiedImmunizations().subscribe({
      next: (rows) => {
        this.immunizations = rows || [];
        this.applyView();
        this.loading = false;
      },
      error: () => {
        this.errored = true;
        this.loading = false;
      },
    });
  }

  key(i: ClassifiedImmunization): string {
    return `${i.sourceId}/${i.sourceResourceId}`;
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

  private applyView(): void {
    const rows = [...this.immunizations];
    rows.sort((x, y) => this.compare(x, y));
    this.filtered = rows;
  }

  private compare(a: ClassifiedImmunization, b: ClassifiedImmunization): number {
    const dir = this.sortDirection === 'asc' ? 1 : -1;
    if (this.sortColumn === 'lastActivity') {
      const av = a.lastActivity || a.occurrence || '';
      const bv = b.lastActivity || b.occurrence || '';
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
      case 'Completed': return 'badge-success';
      case 'NotDone': return 'badge-warning';
      default: return 'badge-light';
    }
  }
}
