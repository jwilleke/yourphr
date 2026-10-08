import { Component, OnInit, ChangeDetectionStrategy, DestroyRef, inject } from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {FastenApiService} from '../../services/fasten-api.service';
import {ActivatedRoute, Router} from '@angular/router';
import {ResourceFhir} from '../../models/fasten/resource_fhir';
import {fhirModelFactory} from '../../../lib/models/factory';
import {ResourceType} from '../../../lib/models/constants';
import {FastenDisplayModel} from '../../../lib/models/fasten/fasten-display-model';
import {Clipboard} from '@angular/cdk/clipboard';
import {forkJoin, of} from 'rxjs';
import {catchError, switchMap} from 'rxjs/operators';

/**
 * Last breadcrumb label from fields present on the resource only (#448).
 * Prefer codeable display + code when both exist, e.g. "Death Certification (308646001)".
 * Never invent text.
 */
export function resourceDetailCrumbTitle(resource: ResourceFhir, displayModel: FastenDisplayModel | null): string {
  const raw = (resource?.resource_raw || {}) as Record<string, any>

  const fromCodeable = (cc: any): string | undefined => {
    if (!cc) { return undefined }
    const display = cc.text || cc.coding?.[0]?.display
    const code = cc.coding?.[0]?.code
    if (display && code) { return `${display} (${code})` }
    if (display) { return display }
    if (code) { return code }
    return undefined
  }

  // Encounter / many clinical types: type[0]
  const typeField = raw['type']
  const fromType = fromCodeable(
    Array.isArray(typeField) ? typeField[0] : typeField
  )
  if (fromType) { return fromType }

  // Observation, DiagnosticReport, Condition, etc.: code
  const fromCode = fromCodeable(raw['code'])
  if (fromCode) { return fromCode }

  // Media
  const content = raw['content']
  if (content?.title) { return String(content.title) }

  // Consent
  const sourceAttachment = raw['sourceAttachment']
  if (sourceAttachment?.title) { return String(sourceAttachment.title) }

  // API-provided sort title
  if (resource?.sort_title) { return String(resource.sort_title) }

  // Display-model title fields when factory succeeded
  const dm = displayModel as any
  if (dm?.display) { return String(dm.display) }
  if (dm?.title) { return String(dm.title) }

  // Last resort: ids already on the resource (not invented labels)
  return resource?.source_resource_id || raw['id'] || 'detail'
}

@Component({
    selector: 'app-resource-detail',
    templateUrl: './resource-detail.component.html',
    styleUrls: ['./resource-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class ResourceDetailComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef)
  loading = false
  loadError = ''

  sourceId = ""
  /** First crumb: connected source display, else Patient subject.display, else short source id. */
  sourceOrPatientLabel = ""
  resourceType = ""
  resourceTitle = ""
  resource: ResourceFhir = null
  displayModel: FastenDisplayModel = null

  constructor(private fastenApi: FastenApiService, private router: Router, private route: ActivatedRoute, private clipboard: Clipboard) {
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(
      switchMap(params => {
        this.loading = true
        this.loadError = ''
        this.resource = null
        this.displayModel = null
        this.resourceTitle = ''
        this.resourceType = ''
        this.sourceOrPatientLabel = ''
        this.sourceId = params.get('source_id') || ''
        return forkJoin({
          resource: this.fastenApi.getResourceBySourceId(this.sourceId, params.get('resource_id') || ''),
          source: this.fastenApi.getSource(this.sourceId).pipe(catchError(() => of(null))),
          routeType: of(params.get('resource_type') || ''),
        }).pipe(catchError(() => {
          this.loadError = 'Could not load this record. It may have been removed or you may no longer have access. Try opening it again.'
          return of(null)
        }))
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: result => {
        this.loading = false
        if (!result) return
        const {resource, source, routeType} = result
        this.resource = resource
        this.resourceType = resource?.source_resource_type || routeType || ''

        try {
          const parsed = fhirModelFactory(resource.source_resource_type as ResourceType, resource)
          this.displayModel = parsed
        } catch (e) {
          console.error(e)
        }

        this.resourceTitle = resourceDetailCrumbTitle(resource, this.displayModel)

        const raw = (resource?.resource_raw || {}) as Record<string, any>
        const subject = raw['subject'] || raw['patient']
        const patientLabel = subject?.display
        // Prefer connected source name (Explore hierarchy); fall back to patient display when present.
        this.sourceOrPatientLabel =
          (source?.display && String(source.display).trim()) ||
          (patientLabel && String(patientLabel).trim()) ||
          (this.sourceId ? this.sourceId.slice(0, 8) : 'source')
      },
      error: () => {
        this.loading = false
        this.loadError = 'Could not load this record. Try opening it again.'
      },
    })
  }

}
