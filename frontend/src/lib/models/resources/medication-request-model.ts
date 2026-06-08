import {FastenDisplayModel} from '../fasten/fasten-display-model';
import {CodingModel} from '../datatypes/coding-model';
import {fhirVersions, ResourceType} from '../constants';
import {FastenOptions} from '../fasten/fasten-options';
import * as _ from "lodash";
import {ReferenceModel} from '../datatypes/reference-model';
import {CodableConceptModel} from '../datatypes/codable-concept-model';

export class MedicationRequestModel extends FastenDisplayModel {
  code: CodableConceptModel|undefined
  display: string|undefined
  medication_reference: ReferenceModel|undefined
  medication_codeable_concept: CodingModel|undefined
  reason_code: string|undefined
  dosage_instruction: string|any[]|undefined
  has_dosage_instruction: boolean|undefined
  requester: ReferenceModel|undefined
  created: string|undefined
  intent: string|undefined
  status: string|undefined
  // US Core 9.0.0 Must-Support (#144):
  subject: ReferenceModel|undefined          // Reference(Patient) — mandatory
  encounter: ReferenceModel|undefined
  reported_boolean: boolean|undefined        // reported[x]: was this reported rather than primary?
  reported_reference: ReferenceModel|undefined
  categories: string[] = []                  // category:us-core (e.g. community, discharge)
  dosage_instruction_text: string|undefined  // dosageInstruction.text (MS)

  constructor(fhirResource: any, fhirVersion?: fhirVersions, fastenOptions?: FastenOptions) {
    super(fastenOptions)
    this.source_resource_type = ResourceType.MedicationRequest

    this.medication_reference = _.get(fhirResource, 'medicationReference');
    this.medication_codeable_concept = _.get(
      fhirResource,
      'medicationCodeableConcept.coding.0',
    );
    this.code = _.get(fhirResource, 'medicationCodeableConcept');
    this.reason_code = _.get(fhirResource, 'reasonCode');
    this.status = _.get(fhirResource, 'status');
    this.dosage_instruction = _.get(fhirResource, 'dosageInstruction');
    this.has_dosage_instruction =
      Array.isArray(this.dosage_instruction) && this.dosage_instruction.length > 0;
    this.dosage_instruction_text = _.get(fhirResource, 'dosageInstruction.0.text');
    this.requester =
      _.get(fhirResource, 'requester.agent') || _.get(fhirResource, 'requester');
    this.created = _.get(fhirResource, 'authoredOn');
    this.intent = _.get(fhirResource, 'intent');

    // US Core Must-Support elements (#144)
    this.subject = _.get(fhirResource, 'subject');
    this.encounter = _.get(fhirResource, 'encounter');
    this.reported_boolean = _.get(fhirResource, 'reportedBoolean');
    this.reported_reference = _.get(fhirResource, 'reportedReference');
    this.categories = _.get(fhirResource, 'category', [])
      .map((c: any) => _.get(c, 'coding.0.display') || _.get(c, 'text') || _.get(c, 'coding.0.code'))
      .filter(Boolean);

    this.display = _.get(fhirResource, 'medicationCodeableConcept.text') || _.get(fhirResource, 'medicationCodeableConcept.0.display') || _.get(fhirResource, 'dosageInstruction.0.text') || 'unknown'
  }
}
