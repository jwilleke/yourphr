import {fhirVersions, ResourceType} from '../constants';
import * as _ from "lodash";
import {CodableConceptModel} from '../datatypes/codable-concept-model';
import {ReferenceModel} from '../datatypes/reference-model';
import {FastenDisplayModel} from '../fasten/fasten-display-model';
import {FastenOptions} from '../fasten/fasten-options';

export class FamilyMemberHistoryModel extends FastenDisplayModel {
  title: string | undefined
  status: string | undefined                        // US Core MS
  patient: ReferenceModel | undefined               // US Core MS
  relationship: CodableConceptModel | undefined      // US Core MS
  name: string | undefined                           // US Core MS
  sex: CodableConceptModel | undefined               // US Core MS
  born_date: string | undefined
  age_string: string | undefined
  deceased: boolean | string | undefined
  conditions: { code?: CodableConceptModel, outcome?: CodableConceptModel, onset?: string, contributedToDeath?: boolean }[] | undefined  // US Core MS: condition

  constructor(fhirResource: any, fhirVersion?: fhirVersions, fastenOptions?: FastenOptions) {
    super(fastenOptions)
    this.source_resource_type = ResourceType.FamilyMemberHistory
    this.resourceDTO(fhirResource, fhirVersion || fhirVersions.R4);
  }

  commonDTO(fhirResource: any){
    this.status = _.get(fhirResource, 'status', '');
    this.patient = _.get(fhirResource, 'patient');
    this.relationship = _.get(fhirResource, 'relationship');
    this.name = _.get(fhirResource, 'name');
    this.sex = _.get(fhirResource, 'sex');
    this.born_date = _.get(fhirResource, 'bornDate') || _.get(fhirResource, 'bornString');

    const ageValue = _.get(fhirResource, 'ageAge.value');
    this.age_string = ageValue !== undefined
      ? `${ageValue} ${_.get(fhirResource, 'ageAge.unit', '')}`.trim()
      : _.get(fhirResource, 'ageString');

    let deceased: any = _.get(fhirResource, 'deceasedBoolean');
    if (deceased === undefined) {
      deceased = _.get(fhirResource, 'deceasedDate') || _.get(fhirResource, 'deceasedString');
    }
    this.deceased = deceased;

    this.conditions = _.get(fhirResource, 'condition', []).map((c: any) => {
      const onsetValue = _.get(c, 'onsetAge.value');
      return {
        code: _.get(c, 'code'),
        outcome: _.get(c, 'outcome'),
        onset: onsetValue !== undefined
          ? `${onsetValue} ${_.get(c, 'onsetAge.unit', '')}`.trim()
          : _.get(c, 'onsetString'),
        contributedToDeath: _.get(c, 'contributedToDeath'),
      };
    });

    this.title =
      _.get(fhirResource, 'relationship.text') ||
      _.get(fhirResource, 'relationship.coding.0.display') ||
      _.get(fhirResource, 'name') ||
      'Family Member History';
  };

  resourceDTO(fhirResource: any, fhirVersion: fhirVersions){
    switch (fhirVersion) {
      case fhirVersions.DSTU2:
      case fhirVersions.STU3:
      case fhirVersions.R4: {
        this.commonDTO(fhirResource)
        return
      }
      default:
        throw Error('Unrecognized the fhir version property type.');
    }
  };
}
