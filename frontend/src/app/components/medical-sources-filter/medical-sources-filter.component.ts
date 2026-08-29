import {Component, Input, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {
  ConnectGatewaySourceSearchAggregation,
} from '../../models/connect-gateway/connect-gateway-source-search';
import {MedicalSourcesFilterService} from '../../services/medical-sources-filter.service';

@Component({
    selector: 'app-medical-sources-filter',
    templateUrl: './medical-sources-filter.component.html',
    styleUrls: ['./medical-sources-filter.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class MedicalSourcesFilterComponent implements OnInit {

  @Input() categories: ConnectGatewaySourceSearchAggregation = {buckets: [], sum_other_doc_count: 0}
  @Input() platformTypes: ConnectGatewaySourceSearchAggregation = {buckets: [], sum_other_doc_count: 0}

  constructor(
    public filterService: MedicalSourcesFilterService,
  ) { }

  ngOnInit(): void {

  }

  categorySelected(category: string){
    this.filterService.filterForm.patchValue({'categories': {[category]: true}})
  }
  platformTypeSelected(platformType: string){
    this.filterService.filterForm.patchValue({'platformTypes': {[platformType]: true}})
  }

  bucketDocCount(aggregationData: ConnectGatewaySourceSearchAggregation, key): number {
    return aggregationData?.buckets?.find(bucket => bucket.key === key)?.doc_count
  }

}
