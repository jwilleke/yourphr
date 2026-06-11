import { classifyObservationProfile, observationProfileLabel, observationKindDisplay } from './observation-profile-registry';

describe('observation profile classification', () => {
  it('classifies by a declared meta.profile (not inferred)', () => {
    const c = classifyObservationProfile({
      resourceType: 'Observation',
      meta: { profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-blood-pressure'] },
    });
    expect(c.inferred).toBe(false);
    expect(c.kind).toEqual('blood-pressure');
    expect(observationProfileLabel(c)).toEqual('Blood Pressure'); // named, no "(inferred)"
  });

  it('classifies a version-pinned meta.profile canonical as declared (#248)', () => {
    // Conformant exports / the US Core IG examples version-pin the profile, e.g. "...|9.0.0".
    const c = classifyObservationProfile({
      resourceType: 'Observation',
      meta: { profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-observation-lab|9.0.0'] },
    });
    expect(c.inferred).toBe(false);
    expect(c.kind).toEqual('laboratory');
    expect(c.canonical).toEqual('http://hl7.org/fhir/us/core/StructureDefinition/us-core-observation-lab');
  });

  it('infers vital-signs from category when meta.profile is absent', () => {
    const c = classifyObservationProfile({
      resourceType: 'Observation',
      category: [{ coding: [{ code: 'vital-signs' }] }],
      code: { coding: [{ system: 'http://loinc.org', code: '8867-4' }] },
    });
    expect(c.inferred).toBe(true);
    expect(c.kind).toEqual('vital-signs');
    expect(observationProfileLabel(c)).toEqual('Vital Signs (inferred)'); // qualified
  });

  it('infers blood-pressure from component LOINC codes (no meta.profile)', () => {
    const c = classifyObservationProfile({
      resourceType: 'Observation',
      component: [
        { code: { coding: [{ code: '8480-6' }] } },
        { code: { coding: [{ code: '8462-4' }] } },
      ],
    });
    expect(c.kind).toEqual('blood-pressure');
    expect(c.inferred).toBe(true);
    expect(observationProfileLabel(c)).toEqual('Blood Pressure (inferred)');
  });

  it('shows nothing for an unclassifiable (inferred "other") observation', () => {
    const c = classifyObservationProfile({ resourceType: 'Observation', code: { text: 'Something' } });
    expect(c.kind).toEqual('other');
    expect(c.inferred).toBe(true);
    expect(observationProfileLabel(c)).toBeUndefined();
  });

  it('observationKindDisplay maps kinds to labels', () => {
    expect(observationKindDisplay('laboratory')).toEqual('Laboratory');
    expect(observationKindDisplay('social-history')).toEqual('Social History');
  });
});
