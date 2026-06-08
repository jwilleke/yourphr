import {fhirVersions, ResourceType} from '../constants';
import _ from "lodash";
import {CodableConceptModel} from '../datatypes/codable-concept-model';
import {ReferenceModel} from '../datatypes/reference-model';
import {FastenDisplayModel} from '../fasten/fasten-display-model';
import {FastenOptions} from '../fasten/fasten-options';
import { QuantityModel } from '../datatypes/quantity-model';
import { StringModel } from '../datatypes/string-model';
import { IntegerModel } from '../datatypes/integer-model';
import { BooleanModel } from '../datatypes/boolean-model';
import { ObservationValueCodeableConceptModel } from '../datatypes/observation-value-codeable-concept-model';
import { ReferenceRangeModel } from '../datatypes/reference-range-model';
import { DataAbsentReasonModel } from '../datatypes/data-absent-reason-model';
import { classifyObservationProfile, ObservationClassification } from './observation-profile-registry';

// A single component of a multi-component Observation (e.g. Blood Pressure systolic/diastolic).
export interface ObservationComponent {
  label: string
  code: CodableConceptModel | undefined
  value_model: ObservationValue | undefined
}

// should have either range or value
export interface ValueObject {
  range?: { low?: number | null, high?: number | null }
  value?: number | string | boolean | null
}

export interface ObservationValue {
  display(): string
  visualizationTypes(): string[]
  valueObject(): ValueObject
}

// https://www.hl7.org/fhir/R4/observation.html
export class ObservationModel extends FastenDisplayModel {
  code: CodableConceptModel | undefined
  effective_date: string
  code_coding_display: string
  code_text: string
  status: string
  subject: ReferenceModel | undefined
  fhirResource: any
  reference_range: ReferenceRangeModel

  value_model: ObservationValue

  // US Core 9.0.0 (#146): the claimed conformance profiles + the resolved classification (meta.profile
  // when present, else inferred from category + LOINC code), and any value-bearing components.
  meta_profiles: string[]
  us_core_profile: ObservationClassification
  components: ObservationComponent[] = []

  constructor(fhirResource: any, fhirVersion?: fhirVersions, fastenOptions?: FastenOptions) {
    super(fastenOptions)
    this.fhirResource = fhirResource
    this.source_resource_type = ResourceType.Observation
    this.effective_date = _.get(fhirResource, 'effectiveDateTime');
    this.code = new CodableConceptModel(_.get(fhirResource, 'code'));
    this.code_coding_display = _.get(fhirResource, 'code.coding.0.display');
    this.code_text = _.get(fhirResource, 'code.text', '');
    this.status = _.get(fhirResource, 'status', '');
    this.subject = _.get(fhirResource, 'subject');
    this.reference_range = new ReferenceRangeModel(_.get(this.fhirResource, 'referenceRange.0'))

    this.meta_profiles = _.get(fhirResource, 'meta.profile', []) || [];
    this.us_core_profile = classifyObservationProfile(fhirResource);

    const value = ObservationModel.buildValue(fhirResource)
    if (value) { this.value_model = value }

    // Multi-component observations (e.g. Blood Pressure: systolic + diastolic). Each component carries
    // its own code + value[x] — US Core Must-Support for the component-bearing vital-signs profiles.
    this.components = _.get(fhirResource, 'component', []).map((component: any): ObservationComponent => ({
      label: _.get(component, 'code.coding.0.display') || _.get(component, 'code.text') || _.get(component, 'code.coding.0.code') || 'Component',
      code: new CodableConceptModel(_.get(component, 'code')),
      value_model: ObservationModel.buildValue(component),
    }))
  }

  // Builds the ObservationValue for a value[x] carrier (the Observation itself or a component).
  // Returns the first value[x] present; undefined if none.
  static buildValue(source: any): ObservationValue | undefined {
    if (_.get(source, 'valueQuantity')) { return new QuantityModel(source['valueQuantity']) }
    if (_.get(source, 'valueString')) { return new StringModel(source['valueString']) }
    if (_.get(source, 'valueInteger')) { return new IntegerModel(source['valueInteger']) }
    if (_.get(source, 'valueBoolean')) { return new BooleanModel(source['valueBoolean']) }
    if (_.get(source, 'valueCodeableConcept')) { return new ObservationValueCodeableConceptModel(source['valueCodeableConcept']) }
    // value[x] types without a dedicated model render as their string form (#146).
    if (_.get(source, 'valueDateTime')) { return new StringModel(source['valueDateTime']) }
    if (_.get(source, 'valuePeriod')) {
      return new StringModel([_.get(source, 'valuePeriod.start'), _.get(source, 'valuePeriod.end')].filter(Boolean).join(' – '))
    }
    if (_.get(source, 'valueTime')) { return new StringModel(source['valueTime']) }
    if (_.get(source, 'dataAbsentReason')) { return new DataAbsentReasonModel(source['dataAbsentReason']) }
    // TODO (#146 follow-up): valueRange, valueRatio, valueSampledData need dedicated value models.
    return undefined
  }
}
