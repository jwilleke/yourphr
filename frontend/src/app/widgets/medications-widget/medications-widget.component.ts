import {Component, OnInit} from '@angular/core';
import {CommonModule} from '@angular/common';
import {RouterModule} from '@angular/router';
import {DashboardWidgetComponent} from '../dashboard-widget/dashboard-widget.component';
import {LoadingWidgetComponent} from '../loading-widget/loading-widget.component';
import {EmptyWidgetComponent} from '../empty-widget/empty-widget.component';
import {ReconciledMedication} from '../../models/fasten/reconciled-medication';

// Dashboard widget surfacing the reconciled Current Medications list (#185). Bespoke fetch — it
// calls the existing getReconciledMedications() rather than the generic query model, so it overrides
// ngOnInit (no widgetConfig.queries needed). Compact: the active meds (already newest-first from the
// backend), capped, linking to the full /medications page.
@Component({
  imports: [CommonModule, RouterModule, LoadingWidgetComponent, EmptyWidgetComponent],
  selector: 'medications-widget',
  templateUrl: './medications-widget.component.html',
  styleUrls: ['./medications-widget.component.scss'],
})
export class MedicationsWidgetComponent extends DashboardWidgetComponent implements OnInit {
  activeMeds: ReconciledMedication[] = [];
  totalCount = 0;

  private static readonly MAX_ROWS = 8;

  ngOnInit(): void {
    this.loading = true;
    this.fastenApi.getReconciledMedications().subscribe({
      next: (meds) => {
        const all = meds || [];
        this.totalCount = all.length;
        // backend returns newest-on-top; show the active ones, capped
        this.activeMeds = all.filter((m) => m.state === 'Active').slice(0, MedicationsWidgetComponent.MAX_ROWS);
        this.isEmpty = this.activeMeds.length === 0;
        this.loading = false;
      },
      error: () => {
        this.isEmpty = true;
        this.loading = false;
      },
    });
  }
}
