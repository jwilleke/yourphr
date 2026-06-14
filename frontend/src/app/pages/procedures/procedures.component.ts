import {Component, OnInit} from '@angular/core';
import {FastenApiService} from '../../services/fasten-api.service';
import {ResourceFhir} from '../../models/fasten/resource_fhir';
import {fhirModelFactory} from '../../../lib/models/factory';
import {ResourceType} from '../../../lib/models/constants';
import {ProcedureModel} from '../../../lib/models/resources/procedure-model';

type SortColumn = 'name' | 'category' | 'date';

// Procedures — part of Medical History ("what was done to me"), NOT Medical Concerns. A sortable
// overview list (legible by default) that drills into the existing per-resource Procedure card
// (complete on demand). Grouped by the category the record actually states; we never infer
// "major vs minor" or "follow-up" (not encoded in FHIR Procedure). Frontend-only — the raw
// Procedure resources are already served by the generic resource endpoint. Child of hub #277 (#275).
@Component({
  selector: 'app-procedures',
  templateUrl: './procedures.component.html',
  styleUrls: ['./procedures.component.scss'],
  standalone: false,
})
export class ProceduresComponent implements OnInit {
  loading = true;
  errored = false;
  procedures: ProcedureModel[] = [];
  filtered: ProcedureModel[] = [];
  expanded: Record<string, boolean> = {};
  sortColumn: SortColumn = 'date';
  sortDirection: 'asc' | 'desc' = 'desc'; // newest first

  // SNOMED procedure-category code → plain-language group. Only explicit categories map; everything
  // else falls through to the record's own category display, then "Not specified" (no guessing).
  private static readonly CATEGORY_LABELS: Record<string, string> = {
    '103693007': 'Test / diagnostic',
    '387713003': 'Surgical',
    '277132007': 'Treatment',
  };

  constructor(private fastenApi: FastenApiService) {}

  ngOnInit(): void {
    this.fastenApi.getResources('Procedure').subscribe({
      next: (resources: ResourceFhir[]) => {
        // Guard the factory (it throws on an unrecognized type) so one bad resource can't crash the view.
        this.procedures = (resources || []).flatMap((r) => {
          try {
            return [fhirModelFactory(r.source_resource_type as ResourceType, r) as ProcedureModel];
          } catch {
            return [];
          }
        });
        this.applyView();
        this.loading = false;
      },
      error: () => {
        this.errored = true;
        this.loading = false;
      },
    });
  }

  rowKey(p: ProcedureModel): string {
    return `${p.source_id}/${p.source_resource_id}`;
  }

  toggleExpanded(key: string): void {
    this.expanded[key] = !this.expanded[key];
  }

  name(p: ProcedureModel): string {
    return p.display || 'Unnamed procedure';
  }

  date(p: ProcedureModel): string | undefined {
    return p.performed_datetime || p.performed_period_start;
  }

  categoryLabel(p: ProcedureModel): string {
    const c: any = p.category; // category.coding[0] — {system, code, display}
    if (c?.code && ProceduresComponent.CATEGORY_LABELS[c.code]) return ProceduresComponent.CATEGORY_LABELS[c.code];
    if (c?.display) return c.display; // stated by the record, just not a code we group — show it, don't guess
    return 'Not specified';
  }

  sortBy(column: SortColumn): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = column === 'date' ? 'desc' : 'asc';
    }
    this.applyView();
  }

  private applyView(): void {
    const rows = [...this.procedures];
    rows.sort((a, b) => this.compare(a, b));
    this.filtered = rows;
  }

  private compare(a: ProcedureModel, b: ProcedureModel): number {
    const dir = this.sortDirection === 'asc' ? 1 : -1;
    if (this.sortColumn === 'date') {
      const da = this.date(a);
      const db = this.date(b);
      // Undated rows sink to the bottom regardless of direction (no invented dates).
      if (!da && !db) return this.name(a).localeCompare(this.name(b));
      if (!da) return 1;
      if (!db) return -1;
      return dir * (new Date(da).getTime() - new Date(db).getTime());
    }
    const av = this.sortColumn === 'name' ? this.name(a) : this.categoryLabel(a);
    const bv = this.sortColumn === 'name' ? this.name(b) : this.categoryLabel(b);
    return dir * av.localeCompare(bv);
  }
}
