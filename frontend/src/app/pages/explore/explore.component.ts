import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import {FastenApiService} from '../../services/fasten-api.service';
import {Source} from '../../models/fasten/source';
import {forkJoin, of} from 'rxjs';
import {ConnectGatewayService} from '../../services/connect-gateway.service';
import {Router} from '@angular/router';
import {SourceListItem} from '../medical-sources/medical-sources.component';
import {AuthService} from '../../services/auth.service';

/** localStorage key for admin preference: include sandbox sources on Explore. */
const EXPLORE_SHOW_SANDBOX_KEY = 'explore_show_sandbox_sources';

@Component({
    selector: 'app-explore',
    templateUrl: './explore.component.html',
    styleUrls: ['./explore.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class ExploreComponent implements OnInit {
  loading = false
  /** All connected sources (production + sandbox). */
  private allSources: SourceListItem[] = []
  /** Sources currently shown (after sandbox filter). */
  connectedSources: SourceListItem[] = []
  /** Admin-only: include sources with environment=sandbox. Default off. */
  showSandboxSources = false
  isAdmin = false
  /** How many sandbox sources are connected (for the toggle label). */
  sandboxSourceCount = 0

  constructor(
    private fastenApi: FastenApiService,
    private connectGatewayApi: ConnectGatewayService,
    private authService: AuthService,
    private router: Router
  ) { }

  async ngOnInit(): Promise<void> {
    this.loading = true
    try {
      this.isAdmin = await this.authService.IsAdmin()
    } catch {
      this.isAdmin = false
    }
    // Only admins may opt into sandbox tiles; restore their last choice.
    if (this.isAdmin) {
      this.showSandboxSources = localStorage.getItem(EXPLORE_SHOW_SANDBOX_KEY) === 'true'
    }

    this.fastenApi.getSources().subscribe(results => {
      const connectedSources = results as Source[]
      forkJoin(connectedSources.map((source) => {
        //TODO: remove this, and similar code in medical-sources-card.component.ts
        if(source.platform_type == 'fasten' || source.platform_type == 'manual') {
          return this.connectGatewayApi.getConnectGatewayCatalogBrand(source.platform_type)
        } else {
          return of(null)
        }
      })).subscribe((connectedMetadata) => {
          this.allSources = []
          for(const ndx in connectedSources){
            this.allSources.push({source: connectedSources[ndx], brand: connectedMetadata[ndx]})
          }
          this.sandboxSourceCount = this.allSources.filter(item => this.isSandboxSource(item)).length
          this.applyFilter()
          this.loading = false
        }, () => {
          this.loading = false
        })
      if(connectedSources.length == 0) this.loading = false

    }, () => {
      this.loading = false
    })
  }

  /** True when source is marked sandbox (admin testing); missing env counts as production (#331). */
  isSandboxSource(item: SourceListItem): boolean {
    return (item.source?.environment || 'production') === 'sandbox'
  }

  applyFilter(): void {
    if (this.showSandboxSources && this.isAdmin) {
      this.connectedSources = [...this.allSources]
      return
    }
    this.connectedSources = this.allSources.filter(item => !this.isSandboxSource(item))
  }

  onShowSandboxChange(checked: boolean): void {
    if (!this.isAdmin) { return }
    this.showSandboxSources = checked
    localStorage.setItem(EXPLORE_SHOW_SANDBOX_KEY, checked ? 'true' : 'false')
    this.applyFilter()
  }

  public exploreSource(sourceListItem: SourceListItem, ) {
    this.router.navigate(['/explore', sourceListItem.source.id], {
      state: sourceListItem.source
    });
  }

}
