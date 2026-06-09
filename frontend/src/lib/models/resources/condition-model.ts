import {fhirVersions, ResourceType} from '../constants';
import * as _ from "lodash";
import {CodableConceptModel, hasValue} from '../datatypes/codable-concept-model';
import {ReferenceModel} from '../datatypes/reference-model';
import {FastenDisplayModel} from '../fasten/fasten-display-model';
import {FastenOptions} from '../fasten/fasten-options';
import {resolveStatus} from '../datatypes/resolve-status';

export class ConditionModel extends FastenDisplayModel {
  code: CodableConceptModel | undefined
  code_text: string | undefined
  code_id: string | undefined
  code_system: string | undefined

  severity_text: string | undefined
  has_asserter: boolean | undefined
  asserter: ReferenceModel | undefined
  has_body_site: boolean | undefined
  body_site: CodableConceptModel[] | undefined
  clinical_status: string | undefined
  // US Core 9.0.0 Must-Support (Condition Problems & Health Concerns, #143):
  verification_status: string | undefined
  categories: string[] = []        // problem-list-item vs health-concern distinction
  subject: ReferenceModel | undefined
  date_recorded: string | undefined
  onset_datetime: string | undefined
  abatement_datetime: string | undefined
  note: string | undefined

  constructor(fhirResource: any, fhirVersion?: fhirVersions, fastenOptions?: FastenOptions) {
    super(fastenOptions)
    this.source_resource_type = ResourceType.Condition
    this.resourceDTO(fhirResource, fhirVersion || fhirVersions.R4);
  }


  commonDTO(fhirResource:any){
    this.code = _.get(fhirResource, 'code')
    this.code_text =
      _.get(fhirResource, 'code.coding.0.display') ||
      _.get(fhirResource, 'code.text') ||
      _.get(fhirResource, 'code.coding.0.code');
    this.code_id = _.get(fhirResource, 'code.coding.0.code')
    this.code_system = _.get(fhirResource, 'code.coding.0.system')
    this.severity_text =
      _.get(fhirResource, 'severity.coding.0.display') ||
      _.get(fhirResource, 'severity.text');
    this.onset_datetime = _.get(fhirResource, 'onsetDateTime') ||
      _.get(fhirResource, 'onsetPeriod.start') ||
      _.get(fhirResource, 'assertedDate');
    this.abatement_datetime = _.get(fhirResource, 'abatementDateTime') ||
      _.get(fhirResource, 'abatementPeriod.end');
    this.has_asserter = _.has(fhirResource, 'asserter');
    this.asserter = _.get(fhirResource, 'asserter');
    this.has_body_site = !!_.get(fhirResource, 'bodySite.0.coding.0.display');
    const bodySite = _.get(fhirResource, 'bodySite')
    if(bodySite){
      this.body_site = bodySite.map((body:any) => new CodableConceptModel(body))
    }
  };
  dstu2DTO(fhirResource:any){
    this.clinical_status = _.get(fhirResource, 'clinicalStatus');
    this.date_recorded = _.get(fhirResource, 'dateRecorded');
  };

  stu3DTO(fhirResource:any){
    this.clinical_status = _.get(fhirResource, 'clinicalStatus');
    this.date_recorded = _.get(fhirResource, 'assertedDate');
  };

  r4DTO(fhirResource:any){
    // Non-US-Core hardening (#54): clinical/verification status may arrive as a US Core
    // CodeableConcept, a text-only concept (no coding), or a loose plain-string code (Veradigm/FMH).
    // Resolve all shapes so the status always displays. clinical_status stays code-first (e.g. 'active').
    this.clinical_status = resolveStatus(_.get(fhirResource, 'clinicalStatus'));
    this.verification_status = resolveStatus(_.get(fhirResource, 'verificationStatus'), true);
    // category[] distinguishes problem-list-item vs health-concern (US Core required slice)
    this.categories = _.get(fhirResource, 'category', [])
      .map((c:any) => _.get(c, 'coding.0.display') || _.get(c, 'text') || _.get(c, 'coding.0.code'))
      .filter(Boolean);
    this.subject = _.get(fhirResource, 'subject');
    this.date_recorded = _.get(fhirResource, 'recordedDate');
    this.note = _.get(fhirResource, 'note.0.text');
  };

  resourceDTO(fhirResource:any, fhirVersion:fhirVersions){
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
