import {Component, OnInit} from '@angular/core';
import {Clipboard} from '@angular/cdk/clipboard';
import {forkJoin} from 'rxjs';
import {FastenApiService} from '../../services/fasten-api.service';
import {ResourceFhir} from '../../models/fasten/resource_fhir';
import {ResourceGraphResponse} from '../../models/fasten/resource-graph-response';
import {ClassifiedCondition} from '../../models/fasten/classified-condition';
import {
  GroupDimension,
  HistoryGroup,
  HistoryRow,
  ConditionMaster,
  collapseByDate,
  DateBucket,
  distinctTotal,
  groupHistory,
  groupHistoryByConditions,
} from '../../../lib/utils/medical_history_grouping';
import {buildEncounterRows, buildTypedRows, MEDICAL_HISTORY_TYPES, rowKey} from './medical_history_rows';
import {fhirModelFactory} from '../../../lib/models/factory';
import {ResourceType} from '../../../lib/models/constants';
import {FastenDisplayModel} from '../../../lib/models/fasten/fasten-display-model';

@Component({
    selector: 'app-medical-history',
    templateUrl: './medical-history.component.html',
    styleUrls: ['./medical-history.component.scss'],
    standalone: false
})
export class MedicalHistoryComponent implements OnInit {
  loading = false

  // Group-by selector (#351). Date is the default. Date/Condition/Provider/Place pivot the encounter
  // universe (they need the encounter graph's links); Type pivots a bounded multi-type universe so it
  // isn't degenerate.
  dimensions: {key: GroupDimension; label: string}[] = [
    {key: 'date', label: 'Date'},
    {key: 'condition', label: 'Condition'},
    {key: 'provider', label: 'Provider'},
    {key: 'place', label: 'Place'},
    {key: 'type', label: 'Type'},
  ]
  dimension: GroupDimension = 'date'

  rows: HistoryRow[] = []         // encounter universe (date/condition/provider/place)
  typedRows: HistoryRow[] = []    // multi-type universe (by-Type view) — lazy-loaded on first Type switch
  typedLoaded = false
  typedLoading = false
  lookup: Record<string, ResourceFhir> = {}
  // Canonical conditions from /conditions/classified — the master for the by-Condition dimension (#359),
  // so ALL conditions appear, not only those linked to an encounter.
  conditions: ConditionMaster[] = []
  groups: HistoryGroup[] = []
  selectedKey: string | null = null
  detailBuckets: DateBucket[] = [] // computed once per selection — NOT a getter (a getter returns a new
                                   // array each change-detection cycle, re-mounting every fhir-card -> request storm)
  total = 0
  debug = false // page-level "raw FHIR" toggle, like /explore
  copiedKey: string | null = null // row whose raw FHIR was just copied (transient "Copied!")
  private modelCache: Record<string, FastenDisplayModel | null> = {}

  constructor(public fastenApi: FastenApiService, private clipboard: Clipboard) { }

  // copyRaw copies a record's raw FHIR JSON to the clipboard (like /explore's debug copy).
  copyRaw(row: HistoryRow): void {
    const res = this.resourceFor(row)
    if (!res?.resource_raw) { return }
    if (this.clipboard.copy(JSON.stringify(res.resource_raw, null, 2))) {
      this.copiedKey = rowKey(row)
      setTimeout(() => { this.copiedKey = null }, 2000)
    }
  }

  ngOnInit(): void {
    this.loading = true
    // Load the full encounter set + the canonical condition list in parallel (grouping needs the whole
    // history to build complete master groups, so this is not paginated). NOTE: heavy for very large
    // patients — a lightweight grouping endpoint is the scalable follow-up (#369).
    // Default view (Date/Condition/Provider/Place) only needs Encounters + the canonical condition list.
    // The by-Type universe (all 7 resource types) is heavier and is loaded lazily on first Type switch
    // (#369), so opening this page doesn't pull every resource up front.
    forkJoin({
      conditions: this.fastenApi.getClassifiedConditions(),
      encounters: this.fastenApi.getResources('Encounter'),
    }).subscribe(({conditions, encounters}) => {
      this.conditions = (conditions || []).map((c: ClassifiedCondition): ConditionMaster => ({
        key: rowKey({sourceId: c.sourceId, resourceId: c.sourceResourceId}),
        label: c.title || 'Condition',
        state: c.state,
      }))

      const ids = (encounters || []).map((r) => ({
        source_id: r.source_id,
        source_resource_type: r.source_resource_type,
        source_resource_id: r.source_resource_id,
      }))
      if (ids.length === 0) {
        this.regroup()
        this.loading = false
        return
      }
      this.fastenApi.getResourceGraph(null, ids).subscribe((graph: ResourceGraphResponse) => {
        const built = buildEncounterRows(graph.results['Encounter'] || [])
        this.rows = built.rows
        this.lookup = {...built.lookup}
        this.regroup()
        this.loading = false
      }, () => { this.loading = false })
    }, () => { this.loading = false })
  }

  setDimension(dim: GroupDimension): void {
    if (this.dimension === dim) return
    this.dimension = dim
    if (dim === 'type' && !this.typedLoaded && !this.typedLoading) {
      this.loadTypedUniverse()
    }
    this.regroup()
  }

  // loadTypedUniverse lazily fetches the by-Type resource set — only when the user opens the Type tab —
  // so the default Date view doesn't pull every resource of all 7 types up front (#369).
  private loadTypedUniverse(): void {
    this.typedLoading = true
    forkJoin(MEDICAL_HISTORY_TYPES.map((t) => this.fastenApi.getResources(t))).subscribe({
      next: (results) => {
        const byType: Record<string, ResourceFhir[]> = {}
        MEDICAL_HISTORY_TYPES.forEach((t, i) => { byType[t] = (results[i] as ResourceFhir[]) || [] })
        const built = buildTypedRows(byType)
        this.typedRows = built.rows
        Object.assign(this.lookup, built.lookup) // merge so the Type detail can render its records
        this.typedLoaded = true
        this.typedLoading = false
        if (this.dimension === 'type') { this.regroup() }
      },
      error: () => { this.typedLoading = false },
    })
  }

  selectGroup(key: string): void {
    this.selectedKey = key
    this.updateDetail()
  }

  private regroup(): void {
    // Type pivots the multi-type universe; Condition uses the canonical /conditions/classified master
    // (#359) so every condition shows (even with no linked visit); the rest pivot the encounter universe.
    if (this.dimension === 'type') {
      this.groups = groupHistory(this.typedRows, 'type')
      this.total = distinctTotal(this.typedRows)
    } else if (this.dimension === 'condition') {
      this.groups = groupHistoryByConditions(this.rows, this.conditions)
      this.total = distinctTotal(this.rows)
    } else {
      this.groups = groupHistory(this.rows, this.dimension)
      this.total = distinctTotal(this.rows)
    }
    this.selectedKey = this.groups.length ? this.groups[0].key : null
    this.updateDetail()
  }

  get selectedGroup(): HistoryGroup | undefined {
    return this.groups.find((g) => g.key === this.selectedKey)
  }

  // updateDetail recomputes the date-collapsed detail ONCE per selection change (stored in a stable
  // field), so change detection doesn't re-create the fhir-cards every cycle.
  private updateDetail(): void {
    const g = this.selectedGroup
    this.detailBuckets = g ? collapseByDate(g.rows) : []
  }

  // trackBy keeps Angular from tearing down + rebuilding DOM (and re-fetching fhir-cards) on each cycle.
  trackBucket(_i: number, b: DateBucket): string { return b.date }
  trackRow(_i: number, r: HistoryRow): string { return r.sourceId + '/' + r.resourceType + '/' + r.resourceId }

  resourceFor(row: HistoryRow): ResourceFhir | undefined {
    return this.lookup[rowKey(row)]
  }

  // modelFor parses a row's ResourceFhir into the rich display model that <fhir-card> renders (the same
  // path /explore uses). Cached per row; null when the resource can't be parsed (the template falls back
  // to a simple link). This is what surfaces the real record details inline (not the thin timeline card).
  modelFor(row: HistoryRow): FastenDisplayModel | null {
    const key = rowKey(row)
    if (key in this.modelCache) return this.modelCache[key]
    const res = this.lookup[key]
    let model: FastenDisplayModel | null = null
    if (res?.resource_raw) {
      try {
        model = fhirModelFactory(res.source_resource_type as ResourceType, res)
      } catch {
        model = null
      }
    }
    this.modelCache[key] = model
    return model
  }
}
