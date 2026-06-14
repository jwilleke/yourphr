import { DocumentReferenceModel } from './document-reference-model';
import {AdverseEventModel} from './adverse-event-model';
import {CodableConceptModel} from '../datatypes/codable-concept-model';
import * as example1Fixture from "../../fixtures/r4/resources/documentReference/example1.json"
import * as exampleFmhFixture from "../../fixtures/r4/resources/documentReference/example-followmyhealth.json"
import {AttachmentModel} from '../datatypes/attachment-model';


describe('DocumentReferenceModel', () => {
  it('should create an instance', () => {
    expect(new DocumentReferenceModel({})).toBeTruthy();
  });

  describe('with r4', () => {

    it('should parse example1.json', () => {
      const expected = new DocumentReferenceModel({})
      expected.description = 'Physical'
      expected.status =  'current'
      // expected.docStatus: string | undefined
      expected.type_coding = { system: 'http://loinc.org', code: '34108-1', display: 'Outpatient Note' }
      // expected.classCoding: string | undefined
      expected.category = new CodableConceptModel({
          "coding": [
            {
              "system": "http://ihe.net/xds/connectathon/classCodes",
              "code": "History and Physical",
              "display": "History and Physical"
            }
          ]
        })
      expected.content = [
        new AttachmentModel({
          "contentType": "application/hl7-v3+xml",
          "language": "en-US",
          "url": "http://example.org/xds/mhd/Binary/07a6483f-732b-461e-86b6-edb665c45510",
          "size": 3654,
          "hash": "2jmj7l5rSw0yVb/vlWAYkK/YBwk=",
          "title": "Physical",
          "creation": "2005-12-24T09:35:00+11:00"
        })
      ]
      expected.created_at = '2005-12-24T09:43:41+11:00'
      expected.security_label_coding = { system: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality', code: 'V', display: 'very restricted' }
      expected.context = {
        eventCoding: { system: 'http://ihe.net/xds/connectathon/eventCodes', code: 'T-D8200', display: 'Arm' },
        facilityTypeCoding: { system: 'http://www.ihe.net/xds/connectathon/healthcareFacilityTypeCodes', code: 'Outpatient', display: 'Outpatient' },
        practiceSettingCoding: { system: 'http://www.ihe.net/xds/connectathon/practiceSettingCodes', code: 'General Medicine', display: 'General Medicine' },
        periodStart: '2004-12-23T08:00:00+11:00',
        periodEnd: '2004-12-23T08:01:00+11:00',
        encounter: { reference: 'Encounter/xcda' }   // US Core MS: context.encounter (#285)
      }
      // expected.context: any | undefined
      expected.code = { coding: [{ system: 'http://loinc.org', code: '34108-1', display: 'Outpatient Note' }] }
      // title now leads with `description` (matches the backend sort_title), so it is 'Physical'
      // rather than the category display 'History and Physical'.
      expected.title = 'Physical'
      // US Core Must-Support (#147)
      expected.subject = { reference: 'Patient/xcda' }
      expected.authors = [{ reference: 'Practitioner/xcda1' }, { reference: '#a2' }]
      expected.content_formats = [{ system: 'urn:oid:1.3.6.1.4.1.19376.1.2.3', code: 'urn:ihe:pcc:handp:2008', display: 'History and Physical Specification' }]

      expect(new DocumentReferenceModel(example1Fixture)).toEqual(expected);
    });

    // Non-US-Core (FollowMyHealth): no description/category, a `type` whose coding carries a
    // meaningful display but no code/system, and a generic `type.text` ("HIPAA"). The title must
    // fall back to the meaningful `type.coding[0].display` (or the attachment title) — never the
    // generic "HIPAA", and never blank.
    it('should title a FollowMyHealth document from its meaningful type display, not the generic text', () => {
      const model = new DocumentReferenceModel(exampleFmhFixture);
      expect(model.title).toEqual('Release of Information Authorization, Example Hospital');
      expect(model.title).not.toEqual('HIPAA');
      expect(model.status).toEqual('current');
      expect(model.created_at).toEqual('2026-03-05T20:21:12.744+00:00');
    });

    it('should never render a blank title (falls back to a generic label)', () => {
      const model = new DocumentReferenceModel({ resourceType: 'DocumentReference' });
      expect(model.title).toEqual('Document');
    });
  })

});
