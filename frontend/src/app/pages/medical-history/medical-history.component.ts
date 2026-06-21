import {Component, OnInit} from '@angular/core';
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
import {buildEncounterRows, rowKey} from './medical_history_rows';

@Component({
    selector: 'app-medical-history',
    templateUrl: './medical-history.component.html',
    styleUrls: ['./medical-history.component.scss'],
    standalone: false
})
export class MedicalHistoryComponent implements OnInit {
  loading = false

  // Group-by selector (#351). Date is the default. Type is deferred to #359 (needs a multi-type row
  // universe; today rows are encounters, so Type would be degenerate).
  dimensions: {key: GroupDimension; label: string}[] = [
    {key: 'date', label: 'Date'},
    {key: 'condition', label: 'Condition'},
    {key: 'provider', label: 'Provider'},
    {key: 'place', label: 'Place'},
  ]
  dimension: GroupDimension = 'date'

  rows: HistoryRow[] = []
  lookup: Record<string, ResourceFhir> = {}
  // Canonical conditions from /conditions/classified — the master for the by-Condition dimension (#359),
  // so ALL conditions appear, not only those linked to an encounter.
  conditions: ConditionMaster[] = []
  groups: HistoryGroup[] = []
  selectedKey: string | null = null
  total = 0

  constructor(public fastenApi: FastenApiService) { }

  ngOnInit(): void {
    this.loading = true
    // Load the full encounter set + the canonical condition list in parallel (grouping needs the whole
    // history to build complete master groups, so this is not paginated). NOTE: heavy for very large
    // patients — a lightweight grouping endpoint is the scalable follow-up (#354).
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
        const encounterResults = graph.results['Encounter'] || []
        const built = buildEncounterRows(encounterResults)
        this.rows = built.rows
        this.lookup = built.lookup
        this.total = distinctTotal(this.rows)
        this.regroup()
        this.loading = false
      }, () => { this.loading = false })
    }, () => { this.loading = false })
  }

  setDimension(dim: GroupDimension): void {
    if (this.dimension === dim) return
    this.dimension = dim
    this.regroup()
  }

  selectGroup(key: string): void {
    this.selectedKey = key
  }

  private regroup(): void {
    // The Condition dimension is driven by the canonical /conditions/classified master (#359) so every
    // condition shows — including ones with no linked visit. Other dimensions derive groups from the rows.
    this.groups = this.dimension === 'condition'
      ? groupHistoryByConditions(this.rows, this.conditions)
      : groupHistory(this.rows, this.dimension)
    this.selectedKey = this.groups.length ? this.groups[0].key : null
  }

  get selectedGroup(): HistoryGroup | undefined {
    return this.groups.find((g) => g.key === this.selectedKey)
  }

  get detailBuckets(): DateBucket[] {
    const g = this.selectedGroup
    return g ? collapseByDate(g.rows) : []
  }

  resourceFor(row: HistoryRow): ResourceFhir | undefined {
    return this.lookup[rowKey(row)]
  }
}
