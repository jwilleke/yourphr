import { ObservationModel } from './observation-model';
import { fhirVersions } from '../constants';
import { observationR4Factory } from 'src/lib/fixtures/factories/r4/resources/observation-r4-factory';
import { QuantityModel } from '../datatypes/quantity-model';
import { StringModel } from '../datatypes/string-model';
import { IntegerModel } from '../datatypes/integer-model';
import { BooleanModel } from '../datatypes/boolean-model';
import { ObservationValueCodeableConceptModel } from '../datatypes/observation-value-codeable-concept-model';
import { ReferenceRangeModel } from '../datatypes/reference-range-model';
import { DataAbsentReasonModel } from '../datatypes/data-absent-reason-model';
import * as bloodPressureFixture from '../../fixtures/r4/resources/observation/blood-pressure.json';

describe('ObservationModel', () => {
  it('should create an instance', () => {
    expect(new ObservationModel({})).toBeTruthy();
  });

  it('sets reference_range', () => {
    expect(new ObservationModel({}).reference_range).toBeInstanceOf(ReferenceRangeModel);
  });

  describe('value_model', () => {
    it('is null if there is no value setting', () => {
      expect(new ObservationModel({}).value_model).toBeFalsy();
    });

    it('is a QuantityModel if valueQuantity is set', () => {
      const observation = new ObservationModel(observationR4Factory.valueQuantity().build(), fhirVersions.R4);

      expect(observation.value_model).toBeInstanceOf(QuantityModel);
    });

    it('is a ObservationValueStringModel if valueString is set', () => {
      const observation = new ObservationModel(observationR4Factory.valueString().build(), fhirVersions.R4);

      expect(observation.value_model).toBeInstanceOf(StringModel);
    });

    it('is a ObservationValueIntegerModel if valueInteger is set', () => {
      const observation = new ObservationModel(observationR4Factory.valueInteger().build(), fhirVersions.R4);

      expect(observation.value_model).toBeInstanceOf(IntegerModel);
    });

    it('is a ObservationValueBooleanModel if valueBoolean is set', () => {
      const observation = new ObservationModel(observationR4Factory.valueBoolean().build(), fhirVersions.R4);

      expect(observation.value_model).toBeInstanceOf(BooleanModel);
    });

    it('is a ObservationValueCodeableConceptModel if valueCodeableConcept is set', () => {
      const observation = new ObservationModel(observationR4Factory.valueCodeableConcept().build(), fhirVersions.R4);

      expect(observation.value_model).toBeInstanceOf(ObservationValueCodeableConceptModel);
    });

    it('is a ObservationValueDataAbsentReasonModel if dataAbsentReason is set', () => {
      const observation = new ObservationModel(observationR4Factory.dataAbsent().build(), fhirVersions.R4);

      expect(observation.value_model).toBeInstanceOf(DataAbsentReasonModel);
    });

    it('is a StringModel for valueDateTime', () => {
      const observation = new ObservationModel({ valueDateTime: '2020-01-02' }, fhirVersions.R4);
      expect(observation.value_model).toBeInstanceOf(StringModel);
      expect(observation.value_model.display()).toBe('2020-01-02');
    });
  });

  // US Core 9.0.0 profile classification + components (#146)
  describe('US Core profile classification', () => {
    it('classifies a Blood Pressure observation via meta.profile (not inferred)', () => {
      const obs = new ObservationModel(bloodPressureFixture, fhirVersions.R4);
      expect(obs.meta_profiles).toContain('http://hl7.org/fhir/us/core/StructureDefinition/us-core-blood-pressure');
      expect(obs.us_core_profile.kind).toBe('blood-pressure');
      expect(obs.us_core_profile.inferred).toBe(false);
      expect(obs.us_core_profile.profile?.display).toBe('Blood Pressure');
    });

    it('parses the systolic + diastolic components with their values', () => {
      const obs = new ObservationModel(bloodPressureFixture, fhirVersions.R4);
      expect(obs.components.length).toBe(2);
      expect(obs.components[0].label).toBe('Systolic blood pressure');
      expect(obs.components[0].value_model).toBeInstanceOf(QuantityModel);
      expect(obs.components[0].value_model!.display()).toBe('107 mmHg');
      expect(obs.components[1].label).toBe('Diastolic blood pressure');
      expect(obs.components[1].value_model!.display()).toBe('60 mmHg');
    });

    it('infers laboratory from category when meta.profile is absent (non-US-Core fallback)', () => {
      const obs = new ObservationModel({
        status: 'final',
        category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
        code: { coding: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }] },
        valueQuantity: { value: 13.2, unit: 'g/dL' },
      }, fhirVersions.R4);
      expect(obs.us_core_profile.kind).toBe('laboratory');
      expect(obs.us_core_profile.inferred).toBe(true);
      expect(obs.us_core_profile.profile).toBeUndefined();
    });

    it('infers blood-pressure from component codes when meta.profile is absent', () => {
      const obs = new ObservationModel({
        status: 'final',
        category: [{ coding: [{ code: 'vital-signs' }] }],
        component: [
          { code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] }, valueQuantity: { value: 120, unit: 'mmHg' } },
          { code: { coding: [{ system: 'http://loinc.org', code: '8462-4' }] }, valueQuantity: { value: 80, unit: 'mmHg' } },
        ],
      }, fhirVersions.R4);
      expect(obs.us_core_profile.kind).toBe('blood-pressure');
      expect(obs.us_core_profile.inferred).toBe(true);
    });

    it('defaults to "other" with empty components for a bare observation', () => {
      const obs = new ObservationModel({}, fhirVersions.R4);
      expect(obs.us_core_profile.kind).toBe('other');
      expect(obs.components).toEqual([]);
      expect(obs.meta_profiles).toEqual([]);
    });
  });
});
