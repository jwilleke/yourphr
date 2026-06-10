import { ProcedureModel } from './procedure-model';

describe('ProcedureModel', () => {
  it('should create an instance', () => {
    expect(new ProcedureModel({})).toBeTruthy();
  });

  // US Core 9.0.0 Must-Support: subject (Patient), performed[x] (incl. period), reasonCode.
  it('should capture US Core Must-Support elements (period-performed procedure)', () => {
    const model = new ProcedureModel({
      resourceType: 'Procedure',
      status: 'completed',
      code: { coding: [{ system: 'http://snomed.info/sct', code: '80146002', display: 'Appendectomy' }], text: 'Appendectomy' },
      subject: { reference: 'Patient/example' },
      performedPeriod: { start: '2023-02-13', end: '2023-02-13' },
      reasonCode: [{ text: 'Acute appendicitis' }],
    })
    expect(model.display).toEqual('Appendectomy')
    expect(model.status).toEqual('completed')
    expect(model.subject).toEqual({ reference: 'Patient/example' })
    expect(model.performed_period_start).toEqual('2023-02-13')
    expect(model.has_reason_code).toEqual(true)
    expect(model.reason_code).toEqual([{ text: 'Acute appendicitis' }])
  });

  // Non-US-Core (FollowMyHealth): code is text-only (no coding[]) and the date is a
  // performedDateTime. The title must fall back to code.text.
  it('should title a FollowMyHealth text-only procedure from code.text', () => {
    const model = new ProcedureModel({
      resourceType: 'Procedure',
      status: 'completed',
      code: { text: 'Skin Biopsy (central low back)' },
      subject: { reference: 'Patient/example' },
      performedDateTime: '2010-10-29',
    })
    expect(model.display).toEqual('Skin Biopsy (central low back)')
    expect(model.has_coding).toEqual(false)
    expect(model.performed_datetime).toEqual('2010-10-29')
  });
});
