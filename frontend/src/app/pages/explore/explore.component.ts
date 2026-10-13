import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import {FastenApiService} from '../../services/fasten-api.service';
import {Source} from '../../models/fasten/source';
import {forkJoin, of} from 'rxjs';
import {Router} from '@angular/router';
import {SourceListItem} from '../medical-sources/medical-sources.component';

@Component({
    selector: 'app-explore',
    templateUrl: './explore.component.html',
    styleUrls: ['./explore.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class ExploreComponent implements OnInit {
  loading = false
  /** Every connected source. No admin filter here (#904): admin-only UI lives under /admin, and test
   * data belongs on a test login rather than hidden inside a real account. */
  connectedSources: SourceListItem[] = []

  constructor(
    private fastenApi: FastenApiService,
    private router: Router
  ) { }

  async ngOnInit(): Promise<void> {
    this.loading = true

    this.fastenApi.getSources().subscribe(results => {
      const connectedSources = results as Source[]
      forkJoin(connectedSources.map((source) => {
        // Local stand-in brand for the two synthetic platform types, so the card can pick its icon.
        // (Previously fetched from Fasten's Lighthouse for real brands — that path is gone, #700.)
        if(source.platform_type == 'fasten' || source.platform_type == 'manual') {
          return of({id: source.platform_type, last_updated: '', portal_ids: [], name: '', platform_type: source.platform_type})
        } else {
          return of(null)
        }
      })).subscribe((connectedMetadata) => {
          this.connectedSources = []
          for(const ndx in connectedSources){
            this.connectedSources.push({source: connectedSources[ndx], brand: connectedMetadata[ndx]})
          }
          this.loading = false
        }, () => {
          this.loading = false
        })
      if(connectedSources.length == 0) this.loading = false

    }, () => {
      this.loading = false
    })
  }

  public exploreSource(sourceListItem: SourceListItem, ) {
    this.router.navigate(['/explore', sourceListItem.source.id], {
      state: sourceListItem.source
    });
  }

}
