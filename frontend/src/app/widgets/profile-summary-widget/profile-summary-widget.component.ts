import {Component, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {CommonModule} from '@angular/common';
import {RouterModule} from '@angular/router';
import {DashboardWidgetComponent} from '../dashboard-widget/dashboard-widget.component';
import {LoadingWidgetComponent} from '../loading-widget/loading-widget.component';
import {MissingDataComponent} from '../../components/missing-data/missing-data.component';
import {ResourceFhir} from '../../models/fasten/resource_fhir';
import {fhirModelFactory} from '../../../lib/models/factory';
import {ResourceType} from '../../../lib/models/constants';

interface ProfileSummaryRow {
  title: string;
  status?: string;
  date?: string | Date;
  // routerLink commands — the working resource-detail route /explore/:source_id/resource/:resource_id
  link: any[];
}

// Generic, config-driven "Profile summary" widget (#245, EPIC #244). The display end-state of #136:
// one component renders the recent N resources of ANY category as a titled list — a summary line
// (the server-computed sort_title), a status badge where present, and a per-item deep-link to that
// resource's existing fhir-card (#136). It reads its target resource type from the config's first
// query (`queries[0].q.from`) and fetches via the existing getResources() endpoint — so the array
// length is an exact count and each ResourceFhir carries the source ids needed to deep-link (which
// the DashboardWidgetQuery select-engine strips). Empty category → the <app-missing-data> marker
// (#178), per the no-guessing principle — never an empty card or a fabricated value.
//
// "View all →" is intentionally config-optional (`parsing.view_all_route`): per-type list pages
// don't exist yet — wiring those global deep-links is deferred to Phase 4 of the dashboards plan —
// so the per-item links are the working navigation today and the header link appears only once a
// route is supplied.
@Component({
  imports: [CommonModule, RouterModule, LoadingWidgetComponent, MissingDataComponent],
  selector: 'profile-summary-widget',
  templateUrl: './profile-summary-widget.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./profile-summary-widget.component.scss'],
})
export class ProfileSummaryWidgetComponent extends DashboardWidgetComponent implements OnInit {
  rows: ProfileSummaryRow[] = [];
  totalCount = 0;
  resourceType = '';

  private static readonly MAX_ROWS = 6;

  ngOnInit(): void {
    this.loading = true;
    // The category to summarise is carried in the config's first query (reusing the existing
    // DashboardWidgetConfig shape); without it there's nothing to show.
    this.resourceType = this.widgetConfig?.queries?.[0]?.q?.from || '';
    if (!this.resourceType) {
      this.isEmpty = true;
      this.loading = false;
      return;
    }

    this.fastenApi.getResources(this.resourceType).subscribe({
      next: (resources) => {
        const all = resources || [];
        this.totalCount = all.length;
        const sorted = [...all].sort((a, b) => this.sortValue(b) - this.sortValue(a));
        this.rows = sorted
          .slice(0, ProfileSummaryWidgetComponent.MAX_ROWS)
          .map((r) => this.toRow(r));
        this.isEmpty = this.rows.length === 0;
        this.loading = false;
      },
      error: () => {
        this.isEmpty = true;
        this.loading = false;
      },
    });
  }

  // newest-first; resources with no sort_date fall to the bottom
  private sortValue(r: ResourceFhir): number {
    const t = r?.sort_date ? new Date(r.sort_date).getTime() : 0;
    return isNaN(t) ? 0 : t;
  }

  private toRow(r: ResourceFhir): ProfileSummaryRow {
    let status: string | undefined;
    // Status is "where present" — parse the display model to read it. Defensive: FollowMyHealth /
    // non-US-Core resources can fail to parse cleanly; a parse failure just means no badge.
    try {
      const model = fhirModelFactory(r.source_resource_type as ResourceType, r) as any;
      // Models name status differently: most expose `status`, Condition exposes `clinical_status`.
      status = model?.status || model?.clinical_status || undefined;
    } catch (e) {
      status = undefined;
    }
    return {
      title: r.sort_title || r.source_resource_type,
      status,
      date: r.sort_date || undefined,
      link: ['/explore', r.source_id, 'resource', r.source_resource_id],
    };
  }

  get viewAllRoute(): string | undefined {
    return this.widgetConfig?.parsing?.view_all_route;
  }
}
