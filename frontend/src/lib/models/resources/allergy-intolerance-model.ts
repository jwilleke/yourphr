import {CodingModel} from '../datatypes/coding-model';
import * as _ from "lodash";
import {fhirVersions, ResourceType} from '../constants'
import {ReferenceModel} from '../datatypes/reference-model';
import {FastenDisplayModel} from '../fasten/fasten-display-model';
import {FastenOptions} from '../fasten/fasten-options';
import {CodableConceptModel} from '../datatypes/codable-concept-model';
import {resolveStatus} from '../datatypes/resolve-status';

export class AllergyIntoleranceModel extends FastenDisplayModel {
  code: CodableConceptModel | undefined

  title: string | undefined
  status: string | undefined
  // initialized (not just declared) so they're consistent own-properties across all FHIR versions,
  // since they're only populated in r4DTO (US Core is R4).
  clinical_status: string | undefined = undefined
  criticality: string | undefined = undefined
  recorded_date: string | undefined
  substance_coding: CodingModel[] | undefined
  // US Core 9.0.0 Must-Support: reaction (BackboneElement) with manifestation (CodeableConcept, 1..*);
  // severity (mild|moderate|severe) and description are additional, not MS. (#145)
  reactions: { manifestation: string[]; severity?: string; description?: string }[] = []
  asserter: ReferenceModel | undefined
  note: { text: string }[] | undefined
  type: string | undefined
  category: string[] | undefined
  patient: ReferenceModel | undefined

  constructor(fhirResource: any, fhirVersion?: fhirVersions, fastenOptions?: FastenOptions) {
    super(fastenOptions)
    this.source_resource_type = ResourceType.AllergyIntolerance
    this.resourceDTO(fhirResource, fhirVersion || fhirVersions.R4);
  }


  commonDTO(fhirResource: any) {
    this.code = _.get(fhirResource, 'code');
    // this.reaction = _.get(fhirResource, 'reaction', []);
    this.asserter = _.get(fhirResource, 'asserter');
    this.type = _.get(fhirResource, 'type');
    this.category = _.get(fhirResource, 'category');
    this.patient = _.get(fhirResource, 'patient');
  };

  dstu2DTO(fhirResource: any) {
    this.title =
      _.get(fhirResource, 'substance.coding[0].display') ||
      _.get(fhirResource, 'substance.text', '');
    this.status = _.get(fhirResource, 'status', '');
    this.recorded_date = _.get(fhirResource, 'recordedDate');
    this.substance_coding = _.get(fhirResource, 'substance.coding', []);
    this.asserter = _.get(fhirResource, 'reporter');
    this.note = []
    this.category = _.get(fhirResource, 'category') ? [_.get(fhirResource, 'category')] : [];
    const patientRef = _.get(fhirResource, 'patient.reference')
    if(patientRef){
      this.patient = {"reference": patientRef};
    }
  };

  stu3DTO(fhirResource: any) {
    this.title = _.get(fhirResource, 'code.coding.0.display');
    this.status = _.get(fhirResource, 'verificationStatus');
    this.recorded_date = _.get(fhirResource, 'assertedDate');
    const substanceCoding = _.get(fhirResource, 'reaction', []).filter((item: any) =>
      _.get(item, 'substance.coding'),
    );
    this.substance_coding = _.get(substanceCoding, '0.substance.coding', []);

    this.note = _.get(fhirResource, 'note');
  };

  r4DTO(fhirResource: any) {
    this.title = _.get(fhirResource, 'code.coding.0.display') || _.get(fhirResource, 'code.text')
    // Non-US-Core hardening (#54): verificationStatus / clinicalStatus may be a US Core
    // CodeableConcept, a text-only concept, or a loose plain-string code — resolve all (display-first
    // for human-readable labels) so the status always displays.
    this.status = resolveStatus(_.get(fhirResource, 'verificationStatus'), true);
    // US Core 9.0.0 Must-Support: clinicalStatus (active|inactive|resolved). (#145)
    this.clinical_status = resolveStatus(_.get(fhirResource, 'clinicalStatus'), true);
    this.criticality = _.get(fhirResource, 'criticality');
    this.recorded_date = _.get(fhirResource, 'recordedDate');
    const substanceCoding = _.get(fhirResource, 'reaction', []).filter((item: any) =>
      _.get(item, 'substance.coding'),
    );
    this.substance_coding = _.get(substanceCoding, '0.substance.coding', []);

    // US Core 9.0.0 Must-Support: reaction.manifestation (CodeableConcept, 1..*); plus severity/description.
    this.reactions = _.get(fhirResource, 'reaction', []).map((reaction: any) => ({
      manifestation: _.get(reaction, 'manifestation', [])
        .map((m: any) => _.get(m, 'coding[0].display') || _.get(m, 'text'))
        .filter(Boolean),
      severity: _.get(reaction, 'severity'),
      description: _.get(reaction, 'description'),
    }));

    this.note = _.get(fhirResource, 'note');
  };

  resourceDTO(fhirResource: any, fhirVersion: fhirVersions) {
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



