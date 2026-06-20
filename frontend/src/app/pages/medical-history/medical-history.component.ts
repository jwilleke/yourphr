import {Component, OnInit} from '@angular/core';
import {FastenApiService} from '../../services/fasten-api.service';
import {ResourceFhir} from '../../models/fasten/resource_fhir';
import {ResourceGraphResponse} from '../../models/fasten/resource-graph-response';
import {
  GroupDimension,
  HistoryGroup,
  HistoryRow,
  collapseByDate,
  DateBucket,
  distinctTotal,
  groupHistory,
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
  groups: HistoryGroup[] = []
  selectedKey: string | null = null
  total = 0

  constructor(public fastenApi: FastenApiService) { }

  ngOnInit(): void {
    this.loading = true
    // Load the full encounter set (grouping needs the whole history to build complete master groups,
    // so this is not paginated). NOTE: heavy for very large patients — a lightweight grouping endpoint
    // is the scalable follow-up (#359 / #354).
    this.fastenApi.getResources('Encounter').subscribe((response: ResourceFhir[]) => {
      const ids = (response || []).map((r) => ({
        source_id: r.source_id,
        source_resource_type: r.source_resource_type,
        source_resource_id: r.source_resource_id,
      }))
      if (ids.length === 0) {
        this.loading = false
        return
      }
      this.fastenApi.getResourceGraph(null, ids).subscribe((graph: ResourceGraphResponse) => {
        const encounters = graph.results['Encounter'] || []
        const built = buildEncounterRows(encounters)
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
    this.groups = groupHistory(this.rows, this.dimension)
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
