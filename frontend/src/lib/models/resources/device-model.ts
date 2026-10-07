import {fhirVersions, ResourceType} from '../constants';
import * as _ from "lodash";
import {CodableConceptModel, hasValue} from '../datatypes/codable-concept-model';
import {ReferenceModel} from '../datatypes/reference-model';
import {FastenDisplayModel} from '../fasten/fasten-display-model';
import {FastenOptions} from '../fasten/fasten-options';
import type {Device, Procedure} from 'fhir/r4';

export class DeviceModel extends FastenDisplayModel {
  code: CodableConceptModel | undefined

  model: string | undefined
  status: string | undefined
  has_expiry: boolean | undefined
  get_expiry: string | undefined
  get_type_coding: string | undefined
  has_type_coding: boolean | undefined
  get_udi: string | undefined
  udi_carrier_aidc: string | undefined
  udi_carrier_hrf: string | undefined
  safety: string | undefined
  has_safety: boolean | undefined
  patient: ReferenceModel | undefined        // US Core MS: patient (1..1)
  distinct_identifier: string | undefined
  lot_number: string | undefined
  serial_number: string | undefined
  manufacture_date: string | undefined
  procedures: {name: string; date: string}[] = []

  constructor(fhirResource: any, fhirVersion?: fhirVersions, fastenOptions?: FastenOptions) {
    super(fastenOptions)
    this.source_resource_type = ResourceType.Device
    this.resourceDTO(fhirResource, fhirVersion || fhirVersions.R4);
  }


  commonDTO(fhirResource:any){
    this.code = _.get(fhirResource, 'type');
    // R4 Device names the kind via `type`; DSTU2 used `code`. Prefer the explicit model, then the
    // R4 `type` (so R4 devices don't all render "Unknown Device"), then the DSTU2 `code`.
    this.model =
      _.get(fhirResource, 'model') ||
      _.get(fhirResource, 'type.text') ||
      _.get(fhirResource, 'type.coding.0.display') ||
      _.get(fhirResource, 'code.text') ||
      _.get(fhirResource, 'code.coding.0.display') ||
      'Unknown Device';
    this.status = _.get(fhirResource, 'status', '');
    this.get_type_coding = _.get(fhirResource, 'type.coding');
    this.has_type_coding = Array.isArray(this.get_type_coding);
    // US Core MS: patient, plus the implantable-device identifiers (R4).
    this.patient = _.get(fhirResource, 'patient');
    this.distinct_identifier = _.get(fhirResource, 'distinctIdentifier');
    this.lot_number = _.get(fhirResource, 'lotNumber');
    this.serial_number = _.get(fhirResource, 'serialNumber');
    this.manufacture_date = _.get(fhirResource, 'manufactureDate');
  };

  dstu2DTO(fhirResource:any){
    this.get_udi = _.get(fhirResource, 'udi');
    this.has_expiry = _.has(fhirResource, 'expiry');
    this.get_expiry = _.get(fhirResource, 'expiry');
  };

  stu3DTO(fhirResource:any){
    this.get_udi = _.get(fhirResource, 'udi.name');
    this.has_expiry = _.has(fhirResource, 'expirationDate');
    this.get_expiry = _.get(fhirResource, 'expirationDate');
    this.safety = _.get(fhirResource, 'safety', []);
    this.has_safety = hasValue(this.safety);
  };

  r4DTO(fhirResource: Device){
    this.procedures = (fhirResource.contained ?? [])
      .filter((resource): resource is Procedure => resource.resourceType === 'Procedure')
      .filter(procedure => procedure.focalDevice?.some(device => device.manipulated.reference === '#')
        && procedure.status === 'completed' && !!procedure.performedDateTime)
      .map(procedure => ({
        name: procedure.code?.text || procedure.code?.coding?.[0]?.display || 'Procedure',
        date: procedure.performedDateTime!,
      }));
    // R4 udiCarrier is 0..* (array). Some fixtures/handlers pass a single object — accept both.
    // Prefer first carrier's deviceIdentifier (US Core Implantable Device MS).
    this.get_udi =
      _.get(fhirResource, 'udiCarrier.0.deviceIdentifier') ||
      _.get(fhirResource, 'udiCarrier.deviceIdentifier') ||
      _.get(fhirResource, 'distinctIdentifier');
    this.has_expiry = _.has(fhirResource, 'expirationDate');
    this.get_expiry = _.get(fhirResource, 'expirationDate');
    this.udi_carrier_aidc =
      _.get(fhirResource, 'udiCarrier.0.carrierAIDC') ||
      _.get(fhirResource, 'udiCarrier.carrierAIDC');
    this.udi_carrier_hrf =
      _.get(fhirResource, 'udiCarrier.0.carrierHRF') ||
      _.get(fhirResource, 'udiCarrier.carrierHRF');
    this.safety = _.get(fhirResource, 'safety', []);
    this.has_safety = hasValue(this.safety);
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
