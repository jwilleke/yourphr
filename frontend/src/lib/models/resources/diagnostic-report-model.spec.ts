import { DiagnosticReportModel } from './diagnostic-report-model';
import {DeviceModel} from './device-model';
import {CodableConceptModel} from '../datatypes/codable-concept-model';
import example1Fixture from "../../fixtures/r4/resources/diagnosticReport/example1.json"


describe('DiagnosticReportModel', () => {
  it('should create an instance', () => {
    expect(new DiagnosticReportModel({})).toBeTruthy();
  });

  describe('with r4', () => {

    it('should parse example1.json', () => {
      const expected = new DiagnosticReportModel({})

      expected.title = 'Complete blood count (hemogram) panel - Blood by Automated count'
      expected.status = 'final'
      // US Core MS: subject (Patient) + result (lab-result Observation references)
      expected.subject = { reference: 'Patient/f001', display: 'P. van den Heuvel' }
      expected.result = [
        { reference: 'Observation/f001' },
        { reference: 'Observation/f002' },
        { reference: 'Observation/f003' },
        { reference: 'Observation/f004' },
        { reference: 'Observation/f005' },
      ]
      // expected.effectiveDateTime: string | undefined
      expected.category_coding = [
        {
          coding: [
            {
              "system": "http://snomed.info/sct",
              "code": "252275004",
              "display": "Haematology test"
            },
            {
              "system": "http://hl7.org/fhir/v2/0074",
              "code": "HM"
            }
          ]
        }
      ]
      expected.code_coding =  [
        { system: 'http://loinc.org', code: '58410-2', display: 'Complete blood count (hemogram) panel - Blood by Automated count' }
      ]
      expected.has_category_coding = true
      expected.has_performer = true
      expected.conclusion = 'Core lab'
      expected.performer = { reference: 'Organization/f001', display: 'Burgers University Medical Centre' }
      expected.issued = '2013-05-15T19:32:52+01:00'
      expected.code = { coding: [{ system: 'http://loinc.org', code: '58410-2', display: 'Complete blood count (hemogram) panel - Blood by Automated count' } ] }

      expect(new DiagnosticReportModel(example1Fixture)).toEqual(expected);
    });

    // US Core MS: effective[x] can be a Period (not just effectiveDateTime).
    it('should capture effectivePeriod', () => {
      const model = new DiagnosticReportModel({
        resourceType: 'DiagnosticReport',
        status: 'final',
        code: { text: 'Sleep study' },
        subject: { reference: 'Patient/example' },
        effectivePeriod: { start: '2023-02-13', end: '2023-02-14' },
      })
      expect(model.title).toEqual('Sleep study')
      expect(model.effective_period_start).toEqual('2023-02-13')
      expect(model.effective_period_end).toEqual('2023-02-14')
    });

    // it('should parse example2.json', () => {
    //   let fixture = require("../../fixtures/r4/resources/device/example2.json")
    //   let expected = new DeviceModel({})
    //   expected.status = 'active'
    //
    //
    //   expect(new DeviceModel(fixture)).toEqual(expected);
    // });
  })

});
