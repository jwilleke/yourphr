import {Component, OnInit} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FastenApiService} from '../../services/fasten-api.service';
import {ClassifiedCondition} from '../../models/fasten/classified-condition';
import {LoadingSpinnerComponent} from '../../components/loading-spinner/loading-spinner.component';

type SortColumn = 'title' | 'state' | 'recorded';

// MedlinePlus Connect supports these problem code systems (FHIR system URL → OID), in the order we
// prefer them for the consumer-info link.
const MEDLINEPLUS_PROBLEM_SYSTEMS: {url: string; oid: string}[] = [
  {url: 'http://hl7.org/fhir/sid/icd-10-cm', oid: '2.16.840.1.113883.6.90'},
  {url: 'http://snomed.info/sct', oid: '2.16.840.1.113883.6.96'},
  {url: 'http://hl7.org/fhir/sid/icd-9-cm', oid: '2.16.840.1.113883.6.103'},
];

// The patient-facing "Medical Concerns" view: a sortable list of the real health problems
// (Condition.category = problem-list-item) the backend classifier separated from social/administrative
// "Patient Profile" items. The frontend does not re-classify — it renders, sorts/filters, surfaces
// "who said this" (provenance), and links out to consumer health info. Refuted (RuledOut) conditions
// are not current problems and are never shown. Mirrors the Current Medications page.
@Component({
  standalone: true,
  imports: [CommonModule, LoadingSpinnerComponent],
  selector: 'app-medical-concerns',
  templateUrl: './medical-concerns.component.html',
  styleUrls: ['./medical-concerns.component.scss'],
})
export class MedicalConcernsComponent implements OnInit {
  loading = true;
  errored = false;
  concerns: ClassifiedCondition[] = [];
  filtered: ClassifiedCondition[] = [];
  expanded: Record<string, boolean> = {};

  showActiveOnly = true;
  sortColumn: SortColumn = 'recorded';
  sortDirection: 'asc' | 'desc' = 'desc'; // default: newest on top

  constructor(private fastenApi: FastenApiService) {}

  ngOnInit(): void {
    this.fastenApi.getClassifiedConditions().subscribe({
      next: (rows) => {
        this.concerns = (rows || []).filter((r) => r.category === 'problem-list-item' && r.state !== 'RuledOut');
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

  rowKey(c: ClassifiedCondition): string {
    return `${c.sourceId}/${c.sourceResourceId}`;
  }

  sortBy(column: SortColumn): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = column === 'recorded' ? 'desc' : 'asc';
    }
    this.applyView();
  }

  private applyView(): void {
    let rows = [...this.concerns];
    if (this.showActiveOnly) {
      // Current concerns: Active + Remission (still tracked) + Unknown (shown, never assumed).
      rows = rows.filter((c) => c.state === 'Active' || c.state === 'Remission' || c.state === 'Unknown');
    }
    rows.sort((a, b) => this.compare(a, b));
    this.filtered = rows;
  }

  private compare(a: ClassifiedCondition, b: ClassifiedCondition): number {
    const dir = this.sortDirection === 'asc' ? 1 : -1;
    if (this.sortColumn === 'recorded') {
      // Undated rows always sink to the bottom, regardless of direction (no invented dates).
      if (!a.recorded && !b.recorded) return (a.title || '').localeCompare(b.title || '');
      if (!a.recorded) return 1;
      if (!b.recorded) return -1;
      return dir * (new Date(a.recorded).getTime() - new Date(b.recorded).getTime());
    }
    const av = String((a as any)[this.sortColumn] || '');
    const bv = String((b as any)[this.sortColumn] || '');
    return dir * av.localeCompare(bv);
  }

  // Authoritative consumer health info via MedlinePlus Connect, keyed by a standard problem code
  // (ICD-10-CM → SNOMED → ICD-9-CM, in that preference order). Null when none is coded — we don't
  // fabricate a code-based link. Pure href; nothing is fetched until the patient clicks, and only the
  // code/term travels, never patient identity.
  medlinePlusUrl(c: ClassifiedCondition): string | null {
    for (const sys of MEDLINEPLUS_PROBLEM_SYSTEMS) {
      const coding = (c.standardCodings || []).find((x) => x.system === sys.url && x.code);
      if (coding) {
        const params = new URLSearchParams({
          'mainSearchCriteria.v.cs': sys.oid,
          'mainSearchCriteria.v.c': coding.code!,
          'mainSearchCriteria.v.dn': c.title || coding.display || '',
          'informationRecipient.languageCode.c': 'en',
        });
        return `https://connect.medlineplus.gov/application?${params.toString()}`;
      }
    }
    return null;
  }

  // Plain MedlinePlus name search — always available, even for uncoded conditions.
  medlinePlusSearchUrl(c: ClassifiedCondition): string {
    return `https://medlineplus.gov/search/?query=${encodeURIComponent(c.title || '')}`;
  }

  // Friendly label for a code system URL — codes are for clinicians, but the system name needn't be a URL.
  codeSystemName(system?: string): string {
    switch (system) {
      case 'http://hl7.org/fhir/sid/icd-10-cm': return 'ICD-10-CM';
      case 'http://hl7.org/fhir/sid/icd-9-cm': return 'ICD-9-CM';
      case 'http://snomed.info/sct': return 'SNOMED CT';
      case 'http://loinc.org': return 'LOINC';
      default: return system || '—';
    }
  }

  stateBadgeClass(state: string): string {
    switch (state) {
      case 'Active': return 'badge-danger';
      case 'Remission': return 'badge-warning';
      case 'Resolved': return 'badge-secondary';
      default: return 'badge-light'; // Unknown
    }
  }
}
