import {Component, ChangeDetectionStrategy} from '@angular/core';

import {FormsModule} from '@angular/forms';
import {Router, RouterModule} from '@angular/router';
import {FastenApiService} from '../../services/fasten-api.service';
import {extractErrorFromResponse} from '../../../lib/utils/error_extract';

/** Simple patient-entered home vitals (#313 first slice). Full visit wizard remains at /resource/create. */
@Component({
  standalone: true,
  imports: [FormsModule, RouterModule],
  selector: 'app-patient-entry',
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './patient-entry.component.html',
})
export class PatientEntryComponent {
  vital: 'body_weight' | 'heart_rate' | 'body_temperature' | 'oxygen_saturation' | 'blood_pressure' = 'body_weight';
  value: number | null = null;
  systolic: number | null = null;
  diastolic: number | null = null;
  unit = '';
  effectiveDate = ''; // yyyy-mm-dd optional
  saving = false;
  error = '';
  successMsg = '';
  lastSourceId = '';
  lastResourceId = '';

  constructor(private api: FastenApiService, private router: Router) {
    const today = new Date();
    this.effectiveDate = today.toISOString().slice(0, 10);
  }

  get needsSingleValue(): boolean {
    return this.vital !== 'blood_pressure';
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
    this.saving = true;

    const payload: any = {
      kind: 'vital',
      vital: this.vital,
      effective_date_time: this.effectiveDate || undefined,
    };
    if (this.unit.trim()) {
      payload.unit = this.unit.trim();
    }
    if (this.vital === 'blood_pressure') {
      if (this.systolic == null || this.diastolic == null) {
        this.saving = false;
        this.error = 'Enter both systolic and diastolic blood pressure.';
        return;
      }
      payload.systolic = Number(this.systolic);
      payload.diastolic = Number(this.diastolic);
    } else {
      if (this.value == null || isNaN(Number(this.value))) {
        this.saving = false;
        this.error = 'Enter a numeric value.';
        return;
      }
      payload.value = Number(this.value);
    }

    this.api.createPatientEntry(payload).subscribe({
      next: (data) => {
        this.saving = false;
        this.lastSourceId = data.source_id;
        this.lastResourceId = data.source_resource_id;
        this.successMsg = `Saved: ${data.sort_title}. Stored as patient-reported on your YourPHR records.`;
        this.value = null;
        this.systolic = null;
        this.diastolic = null;
      },
      error: (err) => {
        this.saving = false;
        this.error = extractErrorFromResponse(err) || 'Could not save vital.';
      },
    });
  }

  viewInExplore(): void {
    if (this.lastSourceId && this.lastResourceId) {
      this.router.navigate(['/explore', this.lastSourceId, 'resource', 'Observation', this.lastResourceId]);
    }
  }
}
