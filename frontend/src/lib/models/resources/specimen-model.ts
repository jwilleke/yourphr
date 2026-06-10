import {fhirVersions, ResourceType} from '../constants';
import * as _ from "lodash";
import {CodableConceptModel} from '../datatypes/codable-concept-model';
import {ReferenceModel} from '../datatypes/reference-model';
import {FastenDisplayModel} from '../fasten/fasten-display-model';
import {FastenOptions} from '../fasten/fasten-options';

export class SpecimenModel extends FastenDisplayModel {
  title: string | undefined
  status: string | undefined
  specimen_type: CodableConceptModel | undefined        // US Core MS: type
  subject: ReferenceModel | undefined                   // US Core MS: subject (Patient)
  received_time: string | undefined
  collected_datetime: string | undefined                // US Core MS: collection.collectedDateTime
  collection_period_start: string | undefined
  collection_body_site: CodableConceptModel | undefined // US Core MS: collection.bodySite
  collection_method: CodableConceptModel | undefined
  condition: CodableConceptModel[] | undefined          // US Core MS: condition
  container_type: CodableConceptModel | undefined

  constructor(fhirResource: any, fhirVersion?: fhirVersions, fastenOptions?: FastenOptions) {
    super(fastenOptions)
    this.source_resource_type = ResourceType.Specimen
    this.resourceDTO(fhirResource, fhirVersion || fhirVersions.R4);
  }

  commonDTO(fhirResource: any){
    this.specimen_type = _.get(fhirResource, 'type');
    this.title =
      _.get(fhirResource, 'type.text') ||
      _.get(fhirResource, 'type.coding.0.display') ||
      'Specimen';
    this.status = _.get(fhirResource, 'status', '');
    this.subject = _.get(fhirResource, 'subject');
    this.received_time = _.get(fhirResource, 'receivedTime');
    this.collected_datetime = _.get(fhirResource, 'collection.collectedDateTime');
    this.collection_period_start = _.get(fhirResource, 'collection.collectedPeriod.start');
    this.collection_body_site = _.get(fhirResource, 'collection.bodySite');
    this.collection_method = _.get(fhirResource, 'collection.method');
    this.condition = _.get(fhirResource, 'condition');
    this.container_type = _.get(fhirResource, 'container.0.type');
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
