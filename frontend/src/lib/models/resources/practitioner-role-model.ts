import {fhirVersions, ResourceType} from '../constants';
import * as _ from "lodash";
import {CodableConceptModel} from '../datatypes/codable-concept-model';
import {ReferenceModel} from '../datatypes/reference-model';
import {FastenDisplayModel} from '../fasten/fasten-display-model';
import {FastenOptions} from '../fasten/fasten-options';

export class PractitionerRoleModel extends FastenDisplayModel {

  title: string | undefined
  status: string | undefined
  codes: CodableConceptModel[] | undefined          // US Core MS: code (the role)
  specialties: CodableConceptModel[] | undefined     // US Core MS: specialty
  organization: ReferenceModel | undefined            // US Core MS
  practitioner: ReferenceModel | undefined             // US Core MS
  locations: ReferenceModel[] | undefined              // US Core MS: location
  telecom: { system?: string, value?: string }[] | undefined  // US Core MS
  endpoints: ReferenceModel[] | undefined              // US Core MS: endpoint

  constructor(fhirResource: any, fhirVersion?: fhirVersions, fastenOptions?: FastenOptions) {
    super(fastenOptions)
    this.source_resource_type = ResourceType.PractitionerRole
    this.resourceDTO(fhirResource, fhirVersion || fhirVersions.R4);
  }

  commonDTO(fhirResource:any){
    const active = _.get(fhirResource, 'active');
    this.status = active === true ? 'active' : (active === false ? 'inactive' : '');
    this.codes = _.get(fhirResource, 'code');
    this.specialties = _.get(fhirResource, 'specialty');
    this.organization = _.get(fhirResource, 'organization');
    this.practitioner = _.get(fhirResource, 'practitioner');
    this.locations = _.get(fhirResource, 'location');
    this.telecom = _.get(fhirResource, 'telecom');
    this.endpoints = _.get(fhirResource, 'endpoint');
    this.title =
      _.get(fhirResource, 'code.0.text') ||
      _.get(fhirResource, 'code.0.coding.0.display') ||
      _.get(fhirResource, 'practitioner.display') ||
      'Practitioner Role';
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
