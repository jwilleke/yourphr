import { EncounterModel } from './encounter-model';
import {DocumentReferenceModel} from './document-reference-model';
import * as example1Fixture from "../../fixtures/r4/resources/encounter/example1.json"
import * as example2Fixture from "../../fixtures/r4/resources/encounter/example2.json"
import * as example3Fixture from "../../fixtures/r4/resources/encounter/example3.json"
import * as exampleFmhFixture from "../../fixtures/r4/resources/encounter/example-followmyhealth.json"


describe('EncounterModel', () => {
  it('should create an instance', () => {
    expect(new EncounterModel({})).toBeTruthy();
  });
  describe('with r4', () => {

    it('should parse example1.json', () => {
      const expected = new EncounterModel({})
      // periodEnd: string | undefined
      // periodStart: string | undefined
      // hasParticipant: boolean | undefined
      // locationDisplay: string | undefined
      // encounterType: string | undefined
      expected.resource_class = 'inpatient encounter'
      expected.resource_status = 'in-progress'
      // no type/serviceType → title falls back to class.display
      expected.display = 'inpatient encounter'
      // participant

      expect(new EncounterModel(example1Fixture)).toEqual(expected);
    });

    it('should parse example2.json', () => {
      const expected = new EncounterModel({})
      expected.period_end = '2015-01-17T16:30:00Z'
      expected.period_start = '2015-01-17T16:00:00Z'
      expected.has_participant = true
      expected.location_display = 'Client\'s home'
      // example2.json has no encounter-level `type`; encounter_type stays undefined (we no longer
      // synthesise it from location — that duplicated the Location row). The title instead falls
      // back through class.display below.
      expected.resource_class =  'home health'
      expected.resource_status = 'finished'
      expected.display = 'home health'
      expected.participant = [
        {
          display: 'Dr Adam Careful',
          reference: { reference: 'Practitioner/example', display: 'Dr Adam Careful' },
          text: undefined,
          periodStart: '2015-01-17T16:00:00+10:00',
          role: undefined,
        }
      ]

      expect(new EncounterModel(example2Fixture)).toEqual(expected);
    });

    it('should parse example3.json', () => {
      const expected = new EncounterModel({})
      // expected.periodEnd = '2015-01-17T16:30:00+10:00'
      // expected.periodStart = '2015-01-17T16:00:00+10:00'
      expected.has_participant = true
      // no location in example3 → location_display undefined (we dropped the 'Encounter' default)
      expected.encounter_type = [ { coding: [ Object({ system: 'http://snomed.info/sct', code: '11429006', display: 'Consultation' }) ] } ]
      expected.resource_class = 'ambulatory'
      expected.resource_status = 'finished'
      expected.display = 'Consultation' // title from type.coding.display
      expected.reasonCode = [
        {
          text: 'The patient had fever peaks over the last couple of days. He is worried about these peaks.'
        }
      ]
      expected.participant = [
        { display: undefined,
          reference: Object({ reference: 'Practitioner/f201' }),
          text: undefined,
          periodStart: undefined,
          role: undefined
        }
      ]
      expected.code = { coding: [{ system: 'http://snomed.info/sct', code: '11429006', display: 'Consultation' }] }

      expect(new EncounterModel(example3Fixture)).toEqual(expected);
    });

    // Non-US-Core (FollowMyHealth): no type/serviceType, a class with a system but no code/display,
    // only a location. The title must fall back to the location (not render blank), and the location
    // is not duplicated into a synthesised type.
    it('should title a FollowMyHealth encounter from its location', () => {
      const model = new EncounterModel(exampleFmhFixture);
      expect(model.display).toEqual('Department of Primary Care - Family Medicine, Example');
      expect(model.location_display).toEqual('Department of Primary Care - Family Medicine, Example');
      expect(model.encounter_type).toBeUndefined();
      expect(model.resource_status).toEqual('unknown');
      expect(model.period_start).toEqual('2026-03-05');
    });

  })

});
