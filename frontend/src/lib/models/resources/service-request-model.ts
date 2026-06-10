import {fhirVersions, ResourceType} from '../constants';
import * as _ from "lodash";
import {CodableConceptModel} from '../datatypes/codable-concept-model';
import {ReferenceModel} from '../datatypes/reference-model';
import {FastenDisplayModel} from '../fasten/fasten-display-model';
import {FastenOptions} from '../fasten/fasten-options';

export class ServiceRequestModel extends FastenDisplayModel {
  title: string | undefined
  status: string | undefined                       // US Core MS
  intent: string | undefined                        // US Core MS
  category: CodableConceptModel[] | undefined       // US Core MS
  code: CodableConceptModel | undefined             // US Core MS
  subject: ReferenceModel | undefined               // US Core MS: subject (Patient)
  occurrence_datetime: string | undefined           // US Core MS: occurrence[x]
  occurrence_period_start: string | undefined
  occurrence_period_end: string | undefined
  authored_on: string | undefined
  requester: ReferenceModel | undefined
  reason_code: CodableConceptModel[] | undefined
  priority: string | undefined

  constructor(fhirResource: any, fhirVersion?: fhirVersions, fastenOptions?: FastenOptions) {
    super(fastenOptions)
    this.source_resource_type = ResourceType.ServiceRequest
    this.resourceDTO(fhirResource, fhirVersion || fhirVersions.R4);
  }

  commonDTO(fhirResource: any){
    this.code = _.get(fhirResource, 'code');
    this.title =
      _.get(fhirResource, 'code.text') ||
      _.get(fhirResource, 'code.coding.0.display') ||
      'Service Request';
    this.status = _.get(fhirResource, 'status', '');
    this.intent = _.get(fhirResource, 'intent');
    this.category = _.get(fhirResource, 'category');
    this.subject = _.get(fhirResource, 'subject');
    this.occurrence_datetime = _.get(fhirResource, 'occurrenceDateTime');
    this.occurrence_period_start = _.get(fhirResource, 'occurrencePeriod.start');
    this.occurrence_period_end = _.get(fhirResource, 'occurrencePeriod.end');
    this.authored_on = _.get(fhirResource, 'authoredOn');
    this.requester = _.get(fhirResource, 'requester');
    this.reason_code = _.get(fhirResource, 'reasonCode');
    this.priority = _.get(fhirResource, 'priority');
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
