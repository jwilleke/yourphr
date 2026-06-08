import * as _ from "lodash";
import { FORMATTERS } from 'src/app/components/fhir-datatable/datatable-generic-resource/utils';
import { fhirVersions, ResourceType } from '../constants';
import { FastenDisplayModel } from '../fasten/fasten-display-model';
import { FastenOptions } from '../fasten/fasten-options';

export class PatientModel extends FastenDisplayModel {

  id: string|undefined
  patient_name: string|undefined
  patient_birthdate: string|undefined
  patient_age: number|undefined
  patient_gender: string|undefined
  patient_contact: string|undefined
  patient_address: string[]|undefined
  patient_phones: any[]|undefined
  communication_languages: any[]|undefined
  has_communication_language: boolean|undefined
  has_patient_phones: boolean|undefined
  active: string|undefined
  active_status: string|undefined
  is_deceased: boolean|undefined
  deceased_date: string|undefined
  birth_sex: string|undefined
  individual_sex: string|undefined
  marital_status: string|undefined
  race: string|undefined
  ethnicity: string|undefined
  tribal_affiliation: string|undefined
  tribal_enrolled: boolean|undefined
  interpreter_needed: string|undefined
  mothers_maiden_name: string|undefined
  birth_place: string|undefined
  multiple_birth: boolean|undefined
  identifiers: any[]|undefined
  extensions: any[]|undefined
  ssn: string|undefined
  mrn: string|undefined

  constructor(fhirResource: any, fhirVersion?: fhirVersions, fastenOptions?: FastenOptions) {
    super(fastenOptions)
    this.source_resource_type = ResourceType.Patient

    this.id = _.get(fhirResource, 'id');
    this.patient_name = FORMATTERS.humanName(_.get(fhirResource, 'name.0', null));
    this.patient_birthdate = _.get(fhirResource, 'birthDate');
    this.patient_age = FORMATTERS.age(this.patient_birthdate)
    this.patient_gender = _.get(fhirResource, 'gender');
    this.patient_contact = _.get(fhirResource, 'contact[0]');
    this.patient_address = FORMATTERS.address(_.get(fhirResource, 'address[0]'));
    this.patient_phones = this.getTelecom(fhirResource);
    this.communication_languages = this.getCommunicationLanguages(fhirResource);
    this.has_communication_language = !_.isEmpty(this.communication_languages);
    this.has_patient_phones = !_.isEmpty(this.patient_phones);
    this.active = _.get(fhirResource, 'active', false);
    this.active_status = this.active ? 'active' : 'inactive';
    const deceasedBoolean = _.get(fhirResource, 'deceasedBoolean', false);
    this.deceased_date = _.get(fhirResource, 'deceasedDateTime');
    this.is_deceased = deceasedBoolean || this.deceased_date;
    this.birth_sex = this.getBirthSex(fhirResource);
    this.individual_sex = this.getIndividualSex(fhirResource);
    this.marital_status = _.get(fhirResource, 'maritalStatus.text');
    this.race = this.getRace(fhirResource);
    this.ethnicity = this.getEthnicity(fhirResource);
    this.tribal_affiliation = this.getTribalAffiliation(fhirResource);
    this.tribal_enrolled = this.getTribalEnrolled(fhirResource);
    this.interpreter_needed = this.getInterpreterNeeded(fhirResource);
    this.mothers_maiden_name = this.getMothersMaidenName(fhirResource);
    this.birth_place = this.getBirthPlace(fhirResource);
    this.multiple_birth = _.get(fhirResource, 'multipleBirthBoolean', false);

    this.identifiers = [];
    this.parseIdentifiers(fhirResource);
    this.extensions = this.getExtensions(fhirResource);
    this.ssn = this.ssn || this.getSSN(fhirResource);
    this.mrn = this.mrn || this.getMRN(fhirResource);
  }

  getTelecom(fhirResource: any) {
    return _.get(fhirResource, 'telecom', []).map((telecom: any) => ({
      system: telecom.system,
      value: telecom.value,
      use: telecom.use
    }));
  }

  getCommunicationLanguages(fhirResource: any) {
    return _.get(fhirResource, 'communication', [])
      .filter((item: any) => Boolean(_.get(item, 'language.coding', null)))
      .map((item: any) => item.language.coding[0]);
  }

  getBirthSex(fhirResource: any) {
    const extension = fhirResource.extension?.find((ext: any) =>
      ext.url === "http://hl7.org/fhir/us/core/StructureDefinition/us-core-birthsex"
    );
    return extension?.valueCode;
  }

  // US Core 9.0.0 "Sex" element via the us-core-individual-sex extension (value[x] is a Coding).
  // This supersedes the deprecated us-core-birthsex / us-core-sex extensions (#142).
  getIndividualSex(fhirResource: any) {
    const extension = fhirResource.extension?.find((ext: any) =>
      ext.url === "http://hl7.org/fhir/us/core/StructureDefinition/us-core-individual-sex"
    );
    return extension?.valueCoding?.display || extension?.valueCoding?.code;
  }

  getRace(fhirResource: any) {
    const extension = fhirResource.extension?.find((ext: any) =>
      ext.url === "http://hl7.org/fhir/us/core/StructureDefinition/us-core-race"
    );
    return extension?.extension?.find((ext: any) => ext.url === "text")?.valueString;
  }

  getEthnicity(fhirResource: any) {
    const extension = fhirResource.extension?.find((ext: any) =>
      ext.url === "http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity"
    );
    return extension?.extension?.find((ext: any) => ext.url === "text")?.valueString;
  }

  // US Core 9.0.0 Tribal Affiliation — complex extension: tribalAffiliation (CodeableConcept, 1..1)
  // + isEnrolled (boolean, 0..1). Returns the affiliated tribe's display text. (#142)
  getTribalAffiliation(fhirResource: any) {
    const extension = fhirResource.extension?.find((ext: any) =>
      ext.url === "http://hl7.org/fhir/us/core/StructureDefinition/us-core-tribal-affiliation"
    );
    const affiliation = extension?.extension?.find((ext: any) => ext.url === "tribalAffiliation")?.valueCodeableConcept;
    return affiliation?.text || affiliation?.coding?.[0]?.display || affiliation?.coding?.[0]?.code;
  }

  // Companion to getTribalAffiliation: whether the individual is enrolled in the tribe (0..1). (#142)
  getTribalEnrolled(fhirResource: any) {
    const extension = fhirResource.extension?.find((ext: any) =>
      ext.url === "http://hl7.org/fhir/us/core/StructureDefinition/us-core-tribal-affiliation"
    );
    return extension?.extension?.find((ext: any) => ext.url === "isEnrolled")?.valueBoolean;
  }

  // US Core 9.0.0 Interpreter Needed — simple extension, value[x] is a Coding (Yes/No/Unknown). (#142)
  getInterpreterNeeded(fhirResource: any) {
    const extension = fhirResource.extension?.find((ext: any) =>
      ext.url === "http://hl7.org/fhir/us/core/StructureDefinition/us-core-interpreter-needed"
    );
    return extension?.valueCoding?.display || extension?.valueCoding?.code;
  }

  getMothersMaidenName(fhirResource: any) {
    const extension = fhirResource.extension?.find((ext: any) =>
      ext.url === "http://hl7.org/fhir/StructureDefinition/patient-mothersMaidenName"
    );
    return extension?.valueString;
  }

  getBirthPlace(fhirResource: any) {
    const extension = fhirResource.extension?.find((ext: any) =>
      ext.url === "http://hl7.org/fhir/StructureDefinition/patient-birthPlace"
    );
    if (extension?.valueAddress) {
      const address = extension.valueAddress;
      return `${address.city}, ${address.state}, ${address.country}`;
    }
    return undefined;
  }

  parseIdentifiers(fhirResource: any) {
    const identifiers = _.get(fhirResource, 'identifier', []);
    identifiers.forEach((identifier: any) => {
      if (identifier.system === "http://hl7.org/fhir/sid/us-ssn") {
        this.ssn = identifier.value;
      } else if (identifier.type?.coding?.some((coding: any) => coding.code === "MR")) {
        this.mrn = identifier.value;
      } else if (identifier.type) {
        this.identifiers.push({
          type: identifier.type.text || identifier.type.coding[0].display,
          system: identifier.system,
          value: identifier.value
        });
      }
    });
  }

  getExtensions(fhirResource: any) {
    return fhirResource.extension?.map((ext: any) => ({
      url: ext.url,
      value: ext.valueDecimal || ext.valueString || ext.valueCode || JSON.stringify(ext.extension)
    }));
  }

  getSSN(fhirResource: any) {
    const extension = fhirResource.extension?.find((ext: any) =>
      ext.url === "http://hl7.org/fhir/StructureDefinition/us-core-ssn"
    );
    return extension?.valueString;
  }

  getMRN(fhirResource: any) {
    const extension = fhirResource.extension?.find((ext: any) =>
      ext.url === "http://hl7.org/fhir/StructureDefinition/patient-mrn"
    );
    return extension?.valueString;
  }
}
