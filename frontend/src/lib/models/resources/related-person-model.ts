import {fhirVersions, ResourceType} from '../constants';
import * as _ from "lodash";
import {CodableConceptModel, hasValue} from '../datatypes/codable-concept-model';
import {ReferenceModel} from '../datatypes/reference-model';
import {CodingModel} from '../datatypes/coding-model';
import {FastenDisplayModel} from '../fasten/fasten-display-model';
import {FastenOptions} from '../fasten/fasten-options';

export class RelatedPersonModel extends FastenDisplayModel {

  patient: ReferenceModel|undefined                    // the Patient this person is related to
  name: any|undefined                                  // HumanName
  display_name: string|undefined                       // formatted name for display
  relationship: CodableConceptModel[]|undefined        // US Core MS: relationship
  birthdate: string|undefined
  gender: string|undefined
  address: string|undefined
  related_person_telecom: string|undefined

  constructor(fhirResource: any, fhirVersion?: fhirVersions, fastenOptions?: FastenOptions) {
    super(fastenOptions)
    this.source_resource_type = ResourceType.RelatedPerson

    this.resourceDTO(fhirResource, fhirVersion || fhirVersions.R4);
  }


  commonDTO(fhirResource:any){
    this.patient = _.get(fhirResource, 'patient');
    this.relationship = _.get(fhirResource, 'relationship');  // US Core MS (array of CodeableConcept)
    this.birthdate = _.get(fhirResource, 'birthDate');
    this.gender = _.get(fhirResource, 'gender');
    this.address = _.get(fhirResource, 'address[0]');
    this.related_person_telecom = _.get(fhirResource, 'telecom', []).filter(
        (telecom: any) => telecom.system === 'phone',
    );
  };

  // Format a HumanName for display: prefer `.text`, else join prefix/given/family.
  private static formatName(n: any): string|undefined {
    if (!n) { return undefined }
    if (n.text) { return n.text }
    const parts = [...(n.prefix || []), ...(n.given || []), n.family].filter(Boolean)
    return parts.length ? parts.join(' ') : undefined
  }

  dstu2DTO(fhirResource:any){
    this.name = _.get(fhirResource, 'name');
    this.display_name = RelatedPersonModel.formatName(this.name);
  };

  stu3r4DTO(fhirResource:any){
    // R4 RelatedPerson.name is 0..* — use a safe path (the old `_.get(...)[0]` threw when absent).
    this.name = _.get(fhirResource, 'name[0]');
    this.display_name = RelatedPersonModel.formatName(this.name);
  };

  resourceDTO(fhirResource:any, fhirVersion:fhirVersions){
    switch (fhirVersion) {
      case fhirVersions.DSTU2: {
        this.commonDTO(fhirResource)
        this.dstu2DTO(fhirResource)
        return
      }

      case fhirVersions.STU3:
      case fhirVersions.R4: {
        this.commonDTO(fhirResource)
        this.stu3r4DTO(fhirResource)
        return
      }

      default:
        throw Error('Unrecognized the fhir version property type.');
    }
  };
}
