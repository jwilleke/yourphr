import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
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
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class PatientProfileComponent implements OnInit {
  loading: Record<string, boolean> = {page: false}

  patient: ResourceFhir = null
  /** The connected source the shown Patient came from, so the page says whose record it is. */
  patientSourceLabel = ''
  profileItems: ClassifiedCondition[] = []   // SDOH / health-concern — "Personal & social information"

  constructor(
    private fastenApi: FastenApiService,
  ) { }

  ngOnInit(): void {
    this.loading['page'] = true

    // yourphr#888: only a Patient the person confirmed as themselves; none confirmed, the page asks.
    this.fastenApi.getSelfPatient().subscribe({
      next: ({patient, sourceLabel}) => {
        this.loading['page'] = false
        this.patient = patient
        this.patientSourceLabel = sourceLabel
      },
      error: () => {
        this.loading['page'] = false
      },
    })

    // Personal & social information: the SDOH / health-concern items the condition classifier
    // separated out of Medical Concerns ("stuff about me"). Loaded independently of the
    // demographics so a failure here never blanks the page.
    this.fastenApi.getReconciledConditions().subscribe({
      next: (rows) => {
        this.profileItems = (rows || [])
          .filter((r) => r.category === 'sdoh' || r.category === 'health-concern')
          .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
      },
      error: () => { /* leave the section empty on error */ },
    })
  }

}
