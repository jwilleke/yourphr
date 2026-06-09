import {FastenDisplayModel} from '../fasten/fasten-display-model';
import {CodingModel} from '../datatypes/coding-model';
import {fhirVersions, ResourceType} from '../constants';
import {FastenOptions} from '../fasten/fasten-options';
import * as _ from "lodash";
import {ReferenceModel} from '../datatypes/reference-model';
import {CodableConceptModel} from '../datatypes/codable-concept-model';

// MedicationStatement is NOT a US Core profile, but FollowMyHealth (and other portals) emit it for
// self-reported meds (OTC, supplements). Detect-don't-require: resolve the medication name from
// medicationCodeableConcept (text → coding display → coding code), then a referenced/contained
// Medication, so a non-US-Core statement still renders a meaningful title (#177).
export class MedicationStatementModel extends FastenDisplayModel {
  code: CodableConceptModel|undefined
  display: string|undefined
  medication_reference: ReferenceModel|undefined
  medication_codeable_concept: CodingModel|undefined
  status: string|undefined
  subject: ReferenceModel|undefined
  effective_date: string|undefined          // effectiveDateTime | effectivePeriod.start
  date_asserted: string|undefined
  information_source: ReferenceModel|undefined
  reason_code: string|undefined
  dosage_text: string|undefined             // dosage.text (the SIG)
  categories: string[] = []

  constructor(fhirResource: any, fhirVersion?: fhirVersions, fastenOptions?: FastenOptions) {
    super(fastenOptions)
    this.source_resource_type = ResourceType.MedicationStatement

    this.code = _.get(fhirResource, 'medicationCodeableConcept');
    this.medication_codeable_concept = _.get(fhirResource, 'medicationCodeableConcept.coding.0');
    this.medication_reference = _.get(fhirResource, 'medicationReference');
    this.status = _.get(fhirResource, 'status');
    this.subject = _.get(fhirResource, 'subject');
    this.effective_date =
      _.get(fhirResource, 'effectiveDateTime') || _.get(fhirResource, 'effectivePeriod.start');
    this.date_asserted = _.get(fhirResource, 'dateAsserted');
    this.information_source = _.get(fhirResource, 'informationSource');
    this.reason_code = _.get(fhirResource, 'reasonCode');
    this.dosage_text = _.get(fhirResource, 'dosage.0.text');
    this.categories = (_.get(fhirResource, 'category') ? [].concat(_.get(fhirResource, 'category')) : [])
      .map((c: any) => _.get(c, 'coding.0.display') || _.get(c, 'text') || _.get(c, 'coding.0.code'))
      .filter(Boolean);

    this.display =
      _.get(fhirResource, 'medicationCodeableConcept.text') ||
      _.get(fhirResource, 'medicationCodeableConcept.coding.0.display') ||
      _.get(fhirResource, 'medicationCodeableConcept.coding.0.code') ||
      _.get(fhirResource, 'medicationReference.display') ||
      _.get(fhirResource, 'contained.0.code.coding.0.display') ||
      'unknown';
  }
}
