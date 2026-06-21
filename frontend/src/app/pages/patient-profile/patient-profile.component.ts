import { Component, OnInit } from '@angular/core';
import {ResourceFhir} from '../../models/fasten/resource_fhir';
import {FastenApiService} from '../../services/fasten-api.service';
import {ClassifiedCondition} from '../../models/fasten/classified-condition';

// Patient Profile = demographics + "Personal & social information" (the SDOH / health-concern items the
// condition classifier separates out of Medical Concerns). Allergies and Immunizations now live on their
// own dedicated pages (/allergies, /immunizations) — see #289 — so they are no longer hosted here.
@Component({
    selector: 'app-patient-profile',
    templateUrl: './patient-profile.component.html',
    styleUrls: ['./patient-profile.component.scss'],
    standalone: false
})
export class PatientProfileComponent implements OnInit {
  loading: Record<string, boolean> = {page: false}

  patient: ResourceFhir = null
  profileItems: ClassifiedCondition[] = []   // SDOH / health-concern — "Personal & social information"

  constructor(
    private fastenApi: FastenApiService,
  ) { }

  ngOnInit(): void {
    this.loading['page'] = true

    this.fastenApi.getResources("Patient").subscribe(results => {
      this.loading['page'] = false
      this.patient = results[0]
    }, () => {
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
