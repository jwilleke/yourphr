import { Component, OnInit } from '@angular/core';
import {FastenApiService} from '../../services/fasten-api.service';
import {ActivatedRoute, Router} from '@angular/router';
import {ResourceFhir} from '../../models/fasten/resource_fhir';
import {fhirModelFactory} from '../../../lib/models/factory';
import {ResourceType} from '../../../lib/models/constants';
import {FastenDisplayModel} from '../../../lib/models/fasten/fasten-display-model';
import {Clipboard} from '@angular/cdk/clipboard';

@Component({
    selector: 'app-resource-detail',
    templateUrl: './resource-detail.component.html',
    styleUrls: ['./resource-detail.component.scss'],
    standalone: false
})
export class ResourceDetailComponent implements OnInit {
  loading = false
  debugMode = false;
  copied = false;


  sourceId = ""
  sourceName = ""
  resource: ResourceFhir = null
  displayModel: FastenDisplayModel = null

  constructor(private fastenApi: FastenApiService, private router: Router, private route: ActivatedRoute, private clipboard: Clipboard) {
  }

  // #167: copy the raw FHIR resource JSON (shown in debug mode) to the clipboard.
  copyResourceRaw(): void {
    if (!this.resource?.resource_raw) { return }
    const raw = this.resource.resource_raw as any
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)
    if (this.clipboard.copy(text)) {
      this.copied = true
      setTimeout(() => { this.copied = false }, 2000)
    }
  }

  ngOnInit(): void {
    this.loading = true
    this.fastenApi.getResourceBySourceId(this.route.snapshot.paramMap.get('source_id'), this.route.snapshot.paramMap.get('resource_id')).subscribe((resourceFhir) => {
      this.loading = false
      this.resource = resourceFhir;
      this.sourceId = this.route.snapshot.paramMap.get('source_id')
      this.sourceName = "unknown" //TODO popualte this

      try{
        const parsed = fhirModelFactory(resourceFhir.source_resource_type as ResourceType, resourceFhir)
        this.displayModel = parsed
      } catch (e) {
        console.error(e)
      }
    }, error => {
      this.loading = false
    });
  }

}
