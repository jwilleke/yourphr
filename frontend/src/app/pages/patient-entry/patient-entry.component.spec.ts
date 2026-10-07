import {ComponentFixture, TestBed} from '@angular/core/testing';
import {RouterTestingModule} from '@angular/router/testing';
import {of, throwError} from 'rxjs';

import {PatientEntryComponent} from './patient-entry.component';
import {FastenApiService} from '../../services/fasten-api.service';

describe('PatientEntryComponent', () => {
  let component: PatientEntryComponent;
  let fixture: ComponentFixture<PatientEntryComponent>;
  let api: jasmine.SpyObj<FastenApiService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj('FastenApiService', ['createPatientEntry', 'getOwnDevices']);
    api.getOwnDevices.and.returnValue(of([{id: 'cuff-1', name: 'Omron cuff'}]));
    api.createPatientEntry.and.returnValue(of({
      resource_type: 'Observation',
      source_resource_id: 'obs-1',
      source_id: 'src-1',
      sort_title: 'Body weight 70 kg',
    }));

    await TestBed.configureTestingModule({
      imports: [PatientEntryComponent, RouterTestingModule],
      providers: [{provide: FastenApiService, useValue: api}],
    }).compileComponents();

    fixture = TestBed.createComponent(PatientEntryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates and submits a weight vital', () => {
    component.vital = 'body_weight';
    component.value = 70;
    component.submit();
    expect(api.createPatientEntry).toHaveBeenCalled();
    const arg = api.createPatientEntry.calls.mostRecent().args[0];
    expect(arg.vital).toBe('body_weight');
    expect(arg.value).toBe(70);
    expect(component.successMsg).toContain('Body weight');
  });

  it('submits an implant with only its stated identifiers and lifecycle dates, then clears the draft', () => {
    component.kind = 'implant';
    component.name = 'Synthetic coronary stent';
    component.implantStatus = 'inactive';
    component.implantDeviceIdentifier = '00844588003288';
    component.implantSerialNumber = 'SYNTHETIC-456';
    component.implantInsertionDate = '2020-04-20';
    component.implantRemovalDate = '2024-06-10';
    component.submit();
    const payload = api.createPatientEntry.calls.mostRecent().args[0];
    expect(payload).toEqual({
      kind: 'implant', name: 'Synthetic coronary stent', effective_date_time: undefined,
      implant_status: 'inactive', implant_device_identifier: '00844588003288',
      implant_serial_number: 'SYNTHETIC-456', implant_distinct_identifier: undefined,
      implant_lot_number: undefined, implant_manufacture_date: undefined, implant_expiration_date: undefined,
      implant_insertion_date: '2020-04-20', implant_removal_date: '2024-06-10',
    });
    expect(component.name).toBe('');
    expect(component.implantInsertionDate).toBe('');
    expect(component.implantRemovalDate).toBe('');
    expect(component.implantSerialNumber).toBe('');
  });

  it('asks only about implants and leaves optional dates unspecified', () => {
    component.kind = 'implant';
    fixture.detectChanges();
    expect(component.nameLabel).toBe('What implant is it?');
    expect(fixture.nativeElement.textContent).toContain('inside your body');
    expect(fixture.nativeElement.textContent).toContain('Measured with');
    expect(fixture.nativeElement.querySelector('#implant-insertion-date')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#implant-removal-date')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#vital-date')).toBeNull();
    component.name = 'Synthetic stent';
    component.submit();
    const payload = api.createPatientEntry.calls.mostRecent().args[0];
    expect(payload.implant_insertion_date).toBeUndefined();
    expect(payload.implant_removal_date).toBeUndefined();
  });

  it('refuses removal before placement and keeps the draft', () => {
    component.kind = 'implant';
    component.name = 'Synthetic stent';
    component.implantInsertionDate = '2024-06-10';
    component.implantRemovalDate = '2020-04-20';
    component.submit();
    expect(api.createPatientEntry).not.toHaveBeenCalled();
    expect(component.error).toContain('cannot be before');
    expect(component.name).toBe('Synthetic stent');
    expect(component.saving).toBeFalse();
  });

  it('requires an implant name and retains implant fields after a failed save', () => {
    component.kind = 'implant';
    component.submit();
    expect(api.createPatientEntry).not.toHaveBeenCalled();
    expect(component.error).toBe('Name the implant.');
    api.createPatientEntry.and.returnValue(throwError(() => new Error('Unavailable')));
    component.name = 'Synthetic stent';
    component.implantSerialNumber = 'SYNTHETIC-456';
    component.submit();
    expect(component.name).toBe('Synthetic stent');
    expect(component.implantSerialNumber).toBe('SYNTHETIC-456');
    expect(component.saving).toBeFalse();
  });

  // yourphr#696: half a reading is a fact. The form no longer refuses it — the server keeps what
  // was measured and asks the person to confirm it. Only an empty reading is refused.
  it('sends half a blood pressure rather than refusing it, and says what is waiting', () => {
    api.createPatientEntry.and.returnValue(of({
      resource_type: 'Observation', source_resource_id: 'o-1', source_id: 'source-1',
      sort_title: 'Blood pressure 128 systolic mmHg',
      needs_review: ['only the systolic half of this blood pressure was given'],
    }));
    component.vital = 'blood_pressure';
    component.systolic = 128;
    component.diastolic = null;
    component.submit();
    expect(api.createPatientEntry).toHaveBeenCalled();
    const arg = api.createPatientEntry.calls.mostRecent().args[0] as Record<string, unknown>;
    expect(arg['systolic']).toBe(128);
    expect(arg['diastolic']).toBeUndefined(); // nothing invented for the half that was not given
    expect(component.needsReview).toEqual(['only the systolic half of this blood pressure was given']);
    expect(component.successMsg).toContain('not part of your records yet');
  });

  it('refuses only an empty blood pressure — nothing to record', () => {
    component.vital = 'blood_pressure';
    component.systolic = null;
    component.diastolic = null;
    component.submit();
    expect(api.createPatientEntry).not.toHaveBeenCalled();
    expect(component.error).toContain('blood pressure reading');
  });

  // yourphr#763: the form offers the kinds the server can store in a record type of their own.
  it('sends an allergy as an allergy, with the substance in the person\'s words', () => {
    api.createPatientEntry.and.returnValue(of({
      resource_type: 'AllergyIntolerance', source_resource_id: 'a-1', source_id: 'source-1',
      sort_title: 'Allergy to penicillin',
      needs_review: ['"penicillin" is stored exactly as you wrote it — nothing has matched it to a known substance yet'],
    }));
    component.kind = 'allergy';
    component.name = ' penicillin ';
    component.submit();
    const arg = api.createPatientEntry.calls.mostRecent().args[0] as Record<string, unknown>;
    expect(arg['kind']).toBe('allergy');
    expect(arg['name']).toBe('penicillin');
    expect(arg['vital']).toBeUndefined(); // an allergy is not a measurement
    expect(component.successMsg).toContain('Allergy to penicillin');
    expect(component.lastResourceType).toBe('AllergyIntolerance');
  });

  it('sends a medication, and says nothing about whether it is taken unless the person did', () => {
    component.kind = 'medication';
    component.name = 'metformin 500mg';
    component.submit();
    let arg = api.createPatientEntry.calls.mostRecent().args[0] as Record<string, unknown>;
    expect(arg['kind']).toBe('medication');
    expect(arg['status']).toBeUndefined(); // they did not say; the server records that, not a guess

    component.medicationStatus = 'active';
    component.name = 'metformin 500mg';
    component.submit();
    arg = api.createPatientEntry.calls.mostRecent().args[0] as Record<string, unknown>;
    expect(arg['status']).toBe('active');
  });

  it('refuses an unnamed allergy or medication, and sends nothing', () => {
    component.kind = 'allergy';
    component.name = '   ';
    component.submit();
    expect(api.createPatientEntry).not.toHaveBeenCalled();
    expect(component.error).toContain('allergic to');

    component.kind = 'medication';
    component.submit();
    expect(api.createPatientEntry).not.toHaveBeenCalled();
    expect(component.error).toContain('medication');
  });

  // yourphr#764: what measured it is evidence, and only when they said so.
  it('sends the device they picked, and nothing when they picked none', () => {
    component.vital = 'heart_rate';
    component.value = 64;
    component.submit();
    let arg = api.createPatientEntry.calls.mostRecent().args[0] as Record<string, unknown>;
    expect(arg['device']).toBeUndefined(); // no device named is an answer, not a gap to fill
    expect(arg['device_name']).toBeUndefined();

    component.deviceId = 'cuff-1';
    component.value = 64;
    component.submit();
    arg = api.createPatientEntry.calls.mostRecent().args[0] as Record<string, unknown>;
    expect(arg['device']).toBe('cuff-1');
  });

  it('sends a device named for the first time by name, and offers it next time', () => {
    component.vital = 'body_weight';
    component.value = 70;
    component.deviceId = '__new';
    component.newDeviceName = ' Withings scale ';
    component.submit();
    const arg = api.createPatientEntry.calls.mostRecent().args[0] as Record<string, unknown>;
    expect(arg['device_name']).toBe('Withings scale');
    expect(arg['device']).toBeUndefined(); // it has no id yet — the server makes or finds it
    expect(api.getOwnDevices).toHaveBeenCalledTimes(2); // re-read, so the new one is a choice now
  });

  it('offers the devices the person already named', () => {
    expect(component.devices).toEqual([{id: 'cuff-1', name: 'Omron cuff'}]);
  });

  it('surfaces API errors', () => {
    api.createPatientEntry.and.returnValue(throwError(() => ({error: {error: 'boom'}})));
    component.vital = 'heart_rate';
    component.value = 60;
    component.submit();
    expect(component.error).toBeTruthy();
  });
});
