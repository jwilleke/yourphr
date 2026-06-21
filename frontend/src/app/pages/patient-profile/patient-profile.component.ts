import { Component, OnInit } from '@angular/core';
import {ResourceFhir} from '../../models/fasten/resource_fhir';
import {FastenApiService} from '../../services/fasten-api.service';
import {forkJoin} from 'rxjs';
import {fhirModelFactory} from '../../../lib/models/factory';
import {ResourceType} from '../../../lib/models/constants';
import {ImmunizationModel} from '../../../lib/models/resources/immunization-model';
import {AllergyIntoleranceModel} from '../../../lib/models/resources/allergy-intolerance-model';
import {ClassifiedCondition} from '../../models/fasten/classified-condition';
import {ClassifiedAllergy} from '../../models/fasten/classified-allergy';

@Component({
    selector: 'app-patient-profile',
    templateUrl: './patient-profile.component.html',
    styleUrls: ['./patient-profile.component.scss'],
    standalone: false
})
export class PatientProfileComponent implements OnInit {
  loading: Record<string, boolean> = {page: false}

  patient: ResourceFhir = null
  immunizations: ImmunizationModel[] = []
  allergyIntolerances: AllergyIntoleranceModel[] = []
  // #290: true when the record carries "no known allergy" negation assertions — shown as a single
  // reassuring line instead of listing the negations as if they were allergies.
  noKnownAllergies = false
  profileItems: ClassifiedCondition[] = []   // SDOH / health-concern — "Personal & social information"
  // #289: which cards are expanded inline (replaces the hover-only popover). Keyed "imm-<i>" / "alg-<i>".
  private expanded = new Set<string>()

  constructor(
    private fastenApi: FastenApiService,
  ) { }

  toggle(key: string): void {
    this.expanded.has(key) ? this.expanded.delete(key) : this.expanded.add(key)
  }
  isExpanded(key: string): boolean {
    return this.expanded.has(key)
  }

  ngOnInit(): void {
    this.loading['page'] = true

    forkJoin([
      this.fastenApi.getResources("Patient"),
      this.fastenApi.getResources("Immunization"),
      this.fastenApi.getResources("AllergyIntolerance"),
      this.fastenApi.getClassifiedAllergies(),
    ]).subscribe(results => {
      this.loading['page'] = false
      this.patient = results[0][0]
      this.immunizations = (results[1] as ResourceFhir[]).map((immunization) => {
        return fhirModelFactory(immunization.source_resource_type as ResourceType, immunization) as ImmunizationModel
      })
      // The allergy classifier flags negations (noKnown); exclude them from the list and surface a
      // single "No known allergies on record" line instead (#290). Match by resource identity, not text.
      const noKnownIds = new Set(
        (results[3] as ClassifiedAllergy[] || []).filter((c) => c.noKnown).map((c) => `${c.sourceId}/${c.sourceResourceId}`)
      )
      this.noKnownAllergies = noKnownIds.size > 0
      this.allergyIntolerances = (results[2] as ResourceFhir[])
        .filter((allergy) => !noKnownIds.has(`${allergy.source_id}/${allergy.source_resource_id}`))
        .map((allergy) => fhirModelFactory(allergy.source_resource_type as ResourceType, allergy) as AllergyIntoleranceModel)
    }, error => {
      this.loading['page'] = false
    })

    // Personal & social information: the SDOH / health-concern items the condition classifier
    // separated out of Medical Concerns ("stuff about me"). Loaded independently of the
    // demographics so a failure here never blanks the page.
    this.fastenApi.getClassifiedConditions().subscribe({
      next: (rows) => {
        this.profileItems = (rows || [])
          .filter((r) => r.category === 'sdoh' || r.category === 'health-concern')
          .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
      },
      error: () => { /* leave the section empty on error */ },
    })
  }

}
