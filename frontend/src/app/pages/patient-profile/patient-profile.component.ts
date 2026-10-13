import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import {ResourceFhir} from '../../models/fasten/resource_fhir';
import {FastenApiService} from '../../services/fasten-api.service';
import {ClassifiedCondition} from '../../models/fasten/classified-condition';
import {forkJoin, of} from 'rxjs';
import {catchError} from 'rxjs/operators';

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

    // yourphr#888: an account can hold several Patients — one per connected source, and some may be
    // someone the person cares for. Show only one the person has CONFIRMED is them (yourphr#761);
    // never the first one found. With none confirmed, the page asks rather than guesses.
    forkJoin({
      patients: this.fastenApi.getResources("Patient"),
      identities: this.fastenApi.getSourceIdentities().pipe(catchError(() => of([]))),
    }).subscribe({
      next: ({patients, identities}) => {
        this.loading['page'] = false
        for (const identity of identities.filter((i) => i.answer === 'self')) {
          const match = (patients || []).find((p) => p.source_id === identity.sourceId && p.source_resource_id === identity.patientId)
          if (match) {
            this.patient = match
            this.patientSourceLabel = identity.label
            break
          }
        }
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
