import {fhirVersions, ResourceType} from '../constants';
import * as _ from "lodash";
import {CodableConceptModel, hasValue} from '../datatypes/codable-concept-model';
import {ReferenceModel} from '../datatypes/reference-model';
import {CodingModel} from '../datatypes/coding-model';
import {FastenDisplayModel} from '../fasten/fasten-display-model';
import {FastenOptions} from '../fasten/fasten-options';

// The standard code systems for Encounter.class (HL7 v3 ActCode / ActEncounterCode). A class coding in
// any OTHER system is a vendor-LOCAL code (e.g. Epic's "HOV" under its 1.2.840.114350.* OID) — cryptic
// to a patient — so we don't surface it as a "Class" value (#371). Never guess.
const STANDARD_ENCOUNTER_CLASS_SYSTEMS = [
  'http://terminology.hl7.org/CodeSystem/v3-ActCode',
  'http://hl7.org/fhir/v3/ActCode',
  'urn:oid:2.16.840.1.113883.5.4',
];

function isStandardEncounterClass(system: string | undefined): boolean {
  return !!system && STANDARD_ENCOUNTER_CLASS_SYSTEMS.includes(system);
}

export class EncounterModel extends FastenDisplayModel {
  code: CodableConceptModel | undefined
  display: string | undefined
  period_end: string | undefined
  period_start: string | undefined
  has_participant: boolean | undefined
  location_display: string | undefined
  encounter_type: CodableConceptModel[] | undefined
  resource_class: string | undefined
  resource_status: string | undefined
  discharge_disposition: CodableConceptModel | undefined
  subject: ReferenceModel | undefined          // US Core MS: subject (Patient)
  service_type: CodableConceptModel | undefined // US Core MS: serviceType
  participant: {
    display?: string,
    role?: string,
    reference?: ReferenceModel,
    text?: string,
    periodStart?:string
  }[] | undefined

  reasonCode: CodableConceptModel[] | undefined

  constructor(fhirResource: any, fhirVersion?: fhirVersions, fastenOptions?: FastenOptions) {
    super(fastenOptions)
    this.source_resource_type = ResourceType.Encounter
    this.resourceDTO(fhirResource, fhirVersion || fhirVersions.R4);
  }

  commonDTO(fhirResource:any){
    this.code = _.get(fhirResource, 'serviceType') || _.get(fhirResource, 'type.0');
    this.resource_status = _.get(fhirResource, 'status');
    this.location_display = _.get(fhirResource, 'location[0].location.display');
    this.encounter_type = _.get(fhirResource, 'type');
    this.has_participant = _.has(fhirResource, 'participant');
    this.reasonCode = _.get(fhirResource, 'reasonCode');
    this.discharge_disposition = _.get(fhirResource, 'hospitalization.dischargeDisposition');
    this.subject = _.get(fhirResource, 'subject');             // US Core MS: subject (Patient)
    this.service_type = _.get(fhirResource, 'serviceType');    // US Core MS: serviceType

    // Card title fallback. US Core titles off type/serviceType; Veradigm/FollowMyHealth often omits
    // both and ships only a location + a class with a system but no code — so without this the title
    // renders blank (#54 follow-up). Fall back: type → serviceType → class → location → generic.
    // (Note: the backend sort_title isn't in resource_raw, so the card can't rely on it.)
    this.display =
      _.get(fhirResource, 'type.0.text') ||
      _.get(fhirResource, 'type.0.coding.0.display') ||
      _.get(fhirResource, 'serviceType.text') ||
      _.get(fhirResource, 'serviceType.coding.0.display') ||
      _.get(fhirResource, 'class.display') ||
      _.get(fhirResource, 'class.code') ||
      this.location_display ||
      'Encounter';
  };

  dstu2DTO(fhirResource:any){
    this.period_end = _.get(fhirResource, 'period.end');
    this.period_start = _.get(fhirResource, 'period.start');
    this.resource_class = _.get(fhirResource, 'class');
    this.participant = _.get(fhirResource, 'participant', []).map((item: any) => {
      let periodStart = _.get(item, 'period.start');
      periodStart = new Date(periodStart).toLocaleString();
      const reference = _.get(item, 'individual', {});
      return {
        display: _.get(item, 'type[0].coding[0].display'),
        reference: reference,
        text: _.get(item, 'type[0].text'),
        periodStart,
      };
    });
  };

  stu3DTO(fhirResource:any){
    this.period_end = _.get(fhirResource, 'period.end');
    this.period_start = _.get(fhirResource, 'period.start');


    this.resource_class = _.get(fhirResource, 'class.display');
    this.participant = _.get(fhirResource, 'participant', []).map((item: any) => {
      const periodStart = _.get(item, 'period.start');
      const reference = _.get(item, 'individual', {});
      return {
        display: _.get(item, 'type[0].coding[0].display'),
        reference: reference,
        text: _.get(item, 'type[0].text'),
        periodStart,
      };
    });
  };

  r4DTO(fhirResource:any){
    this.period_end = _.get(fhirResource, 'period.end');
    this.period_start = _.get(fhirResource, 'period.start');

    // Only surface a "Class" value when it's a recognized standard ActCode (AMB/IMP/EMER/…). A
    // vendor-LOCAL class code (e.g. Epic "HOV") is cryptic and the Type row + title already convey the
    // setting legibly, so suppress it rather than show a raw code (#371). Veradigm R4 ships class with a
    // system but no code/display — that resolves to undefined here too. Never guess.
    this.resource_class = isStandardEncounterClass(_.get(fhirResource, 'class.system'))
      ? (_.get(fhirResource, 'class.display') || _.get(fhirResource, 'class.code'))
      : undefined;
    this.participant = _.get(fhirResource, 'participant', []).map((item: any) => {
      const periodStart = _.get(item, 'period.start');
      return {
        role: _.get(item, 'type[0].text') || _.get(item, 'type[0].coding[0].display'),
        display: _.get(item, 'individual.display'),
        reference: _.get(item, 'individual'),
        text: _.get(item, 'type[0].text'),
        periodStart,
      };
    });
  };

  resourceDTO(fhirResource:any, fhirVersion: fhirVersions){
    switch (fhirVersion) {
      case fhirVersions.DSTU2: {
        this.commonDTO(fhirResource)
        this.dstu2DTO(fhirResource)
        return
      }
      case fhirVersions.STU3: {
        this.commonDTO(fhirResource)
        this.stu3DTO(fhirResource)
        return
      }
      case fhirVersions.R4: {
        this.commonDTO(fhirResource)
        this.r4DTO(fhirResource)
        return
      }

      default:
        throw Error('Unrecognized the fhir version property type.');
    }
  };
}
