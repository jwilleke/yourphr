import { Component, OnInit } from '@angular/core';
import {ResourceFhir} from '../../models/fasten/resource_fhir';
import {FastenApiService} from '../../services/fasten-api.service';
import {forkJoin} from 'rxjs';
import {fhirModelFactory} from '../../../lib/models/factory';
import {ResourceType} from '../../../lib/models/constants';
import {ImmunizationModel} from '../../../lib/models/resources/immunization-model';
import {AllergyIntoleranceModel} from '../../../lib/models/resources/allergy-intolerance-model';
import {ClassifiedCondition} from '../../models/fasten/classified-condition';

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
  profileItems: ClassifiedCondition[] = []   // SDOH / health-concern — "Personal & social information"
  constructor(
    private fastenApi: FastenApiService,
  ) { }

  ngOnInit(): void {
    this.loading['page'] = true

    forkJoin([
      this.fastenApi.getResources("Patient"),
      this.fastenApi.getResources("Immunization"),
      this.fastenApi.getResources("AllergyIntolerance")
    ]).subscribe(results => {
      this.loading['page'] = false
      this.patient = results[0][0]
      this.immunizations = results[1].map((immunization) => {
        return fhirModelFactory(immunization.source_resource_type as ResourceType, immunization) as ImmunizationModel
      })
      this.allergyIntolerances = results[2].map((allergy) => {
        return fhirModelFactory(allergy.source_resource_type as ResourceType, allergy) as AllergyIntoleranceModel
      })
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
