import {Component, ChangeDetectionStrategy, OnInit} from '@angular/core';

import {FormsModule} from '@angular/forms';
import {Router, RouterModule} from '@angular/router';
import {FastenApiService} from '../../services/fasten-api.service';
import {extractErrorFromResponse} from '../../../lib/utils/error_extract';

/**
 * What a person adds about themselves (#313, #696, #763).
 *
 * The kinds offered here are exactly the kinds the server can store in a record type of their own:
 * a home vital as an Observation, an allergy as an AllergyIntolerance, a medication as a
 * MedicationStatement. Offering a kind the server would have to reshape would be offering to
 * misfile it.
 */
@Component({
  standalone: true,
  imports: [FormsModule, RouterModule],
  selector: 'app-patient-entry',
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './patient-entry.component.html',
})
export class PatientEntryComponent implements OnInit {
  kind: 'vital' | 'allergy' | 'medication' = 'vital';
  /**
   * What measured it (#764). '' means they named no device, which is the honest answer and not a
   * default; '__new' reveals the box for one they have not named here before.
   */
  deviceId = '';
  newDeviceName = '';
  devices: {id: string, name: string}[] = [];
  /** The substance or the medicine, in the person's own words. */
  name = '';
  /** Medication only. Empty means they did not say, and the record says so rather than guessing. */
  medicationStatus: '' | 'active' | 'stopped' = '';
  vital: 'body_weight' | 'heart_rate' | 'body_temperature' | 'oxygen_saturation' | 'blood_pressure' = 'body_weight';
  value: number | null = null;
  systolic: number | null = null;
  diastolic: number | null = null;
  unit = '';
  effectiveDate = ''; // yyyy-mm-dd optional
  saving = false;
  error = '';
  successMsg = '';
  /** Why the last entry is waiting, in the words the server used (#762). */
  needsReview: string[] = [];
  lastSourceId = '';
  lastResourceId = '';
  lastResourceType = 'Observation';

  constructor(private api: FastenApiService, private router: Router) {
    const today = new Date();
    this.effectiveDate = today.toISOString().slice(0, 10);
  }

  ngOnInit(): void {
    // Their own devices, so a cuff named once is a choice from then on. A failure here costs the
    // convenience, not the entry: they can still type a name.
    this.api.getOwnDevices().subscribe({next: (devices) => this.devices = devices, error: () => this.devices = []});
  }

  get needsSingleValue(): boolean {
    return this.vital !== 'blood_pressure';
  }

  get isVital(): boolean {
    return this.kind === 'vital';
  }

  get namingNewDevice(): boolean {
    return this.deviceId === '__new';
  }

  get nameLabel(): string {
    return this.kind === 'allergy' ? 'What are you allergic to?' : 'Which medication?';
  }

  get defaultUnitHint(): string {
    switch (this.vital) {
      case 'body_weight': return 'kg (or set lb via unit)';
      case 'heart_rate': return '/min';
      case 'body_temperature': return 'Cel (or [degF])';
      case 'oxygen_saturation': return '%';
      case 'blood_pressure': return 'mmHg';
      default: return '';
    }
  }

  submit(): void {
    this.error = '';
    this.successMsg = '';
    this.needsReview = [];
    this.saving = true;

    const payload: any = {
      kind: this.kind,
      effective_date_time: this.effectiveDate || undefined,
    };

    if (this.kind !== 'vital') {
      // An allergy or a medication is one stated thing. Nothing about it is coded yet and nothing
      // about it is guessed: what they typed is what is stored (#763).
      if (!this.name.trim()) {
        this.saving = false;
        this.error = this.kind === 'allergy' ? 'Name what you are allergic to.' : 'Name the medication.';
        return;
      }
      payload.name = this.name.trim();
      if (this.kind === 'medication' && this.medicationStatus) {
        payload.status = this.medicationStatus;
      }
      this.send(payload);
      return;
    }

    payload.vital = this.vital;
    if (this.unit.trim()) {
      payload.unit = this.unit.trim();
    }
    // Only when they said so. No device is the honest answer for a reading they did not measure
    // with one, and nothing here guesses from the vital or the unit (#764).
    if (this.namingNewDevice && this.newDeviceName.trim()) {
      payload.device_name = this.newDeviceName.trim();
    } else if (this.deviceId && !this.namingNewDevice) {
      payload.device = this.deviceId;
    }
    if (this.vital === 'blood_pressure') {
      // Half a reading is still a fact (#696): the server keeps what was measured and asks you to
      // confirm it, rather than refusing the whole entry. Only an empty form is refused.
      if (this.systolic == null && this.diastolic == null) {
        this.saving = false;
        this.error = 'Enter a blood pressure reading.';
        return;
      }
      if (this.systolic != null) payload.systolic = Number(this.systolic);
      if (this.diastolic != null) payload.diastolic = Number(this.diastolic);
    } else {
      if (this.value == null || isNaN(Number(this.value))) {
        this.saving = false;
        this.error = 'Enter a numeric value.';
        return;
      }
      payload.value = Number(this.value);
    }

    this.send(payload);
  }

  private send(payload: any): void {
    this.api.createPatientEntry(payload).subscribe({
      next: (data) => {
        this.saving = false;
        this.lastSourceId = data.source_id;
        this.lastResourceId = data.source_resource_id;
        this.lastResourceType = data.resource_type || 'Observation';
        // What was kept but still needs the person: they are told here AND it waits for them on
        // the review screen, rather than being announced once and forgotten (#762).
        this.needsReview = data.needs_review ?? [];
        this.successMsg = this.needsReview.length
          ? `Kept: ${data.sort_title}. It is not part of your records yet — see why below.`
          : `Saved: ${data.sort_title}. Stored as patient-reported on your YourPHR records.`;
        this.value = null;
        this.systolic = null;
        this.diastolic = null;
        this.name = '';
        // A device named here is one they can pick next time, so the list is refreshed rather than
        // left a request behind.
        if (payload.device_name) {
          this.newDeviceName = '';
          this.deviceId = '';
          this.api.getOwnDevices().subscribe({next: (devices) => this.devices = devices, error: () => {}});
        }
      },
      error: (err) => {
        this.saving = false;
        this.error = extractErrorFromResponse(err) || 'Could not save this record.';
      },
    });
  }

  viewInExplore(): void {
    if (this.lastSourceId && this.lastResourceId) {
      // The type the server actually stored it as — an allergy is not an Observation (#763).
      this.router.navigate(['/explore', this.lastSourceId, 'resource', this.lastResourceType, this.lastResourceId]);
    }
  }
}
