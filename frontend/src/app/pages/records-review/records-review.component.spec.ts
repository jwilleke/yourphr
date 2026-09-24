import {ComponentFixture, TestBed, waitForAsync} from '@angular/core/testing';
import {RouterTestingModule} from '@angular/router/testing';
import {NEVER, of, throwError} from 'rxjs';

import {RecordsReviewComponent} from './records-review.component';
import {FastenApiService, RecordAwaitingReview, SourceIdentity} from '../../services/fasten-api.service';

describe('RecordsReviewComponent', () => {
  let component: RecordsReviewComponent;
  let fixture: ComponentFixture<RecordsReviewComponent>;
  let apiSpy: jasmine.SpyObj<FastenApiService>;

  const waiting: RecordAwaitingReview[] = [
    {
      source_id: 'source-1', source_resource_type: 'Observation', source_resource_id: 'o-1',
      title: 'Blood pressure 128 systolic mmHg', date: '2026-09-20',
      reasons: ['only the systolic half of this blood pressure was given'],
    },
    {
      source_id: 'source-1', source_resource_type: 'Observation', source_resource_id: 'o-2',
      title: 'peak flow',
      reasons: ['"peak flow" is not a measurement this release knows how to code, so it is stored as written'],
    },
  ];

  const identities: SourceIdentity[] = [
    {
      sourceId: 'source-2', display: 'Fake Regional Health', patientId: 'pa',
      demographics: {name: 'Jane Doe', birthDate: '1971-04-02', gender: ''},
      answer: '', suggested: 'self',
      evidence: ['You signed in to Fake Regional Health yourself, and the connection was issued for this record.'],
      conflicts: [],
    },
    {
      sourceId: 'source-3', display: 'Old records.xml', patientId: 'px',
      demographics: {name: 'Sam Doe', birthDate: '2014-06-01', gender: ''},
      answer: '', suggested: '',
      evidence: ['This came from a file you uploaded. A file says nothing about whose record it is, so nobody has checked.'],
      conflicts: ['Fake Regional Health has a different date of birth (1971-04-02) from Old records.xml (2014-06-01).'],
    },
  ];

  beforeEach(waitForAsync(() => {
    apiSpy = jasmine.createSpyObj('FastenApiService', ['getRecordsAwaitingReview', 'confirmRecordReview', 'discardRecordReview', 'getSourceIdentities', 'assertSourceIdentity']);
    apiSpy.getSourceIdentities.and.returnValue(of(identities));
    apiSpy.assertSourceIdentity.and.returnValue(of({source_id: 'source-2', answer: 'self'}));
    apiSpy.getRecordsAwaitingReview.and.returnValue(of(waiting));
    apiSpy.confirmRecordReview.and.returnValue(of({id: 'o-1', outcome: 'updated'}));
    apiSpy.discardRecordReview.and.returnValue(of({id: 'o-1'}));

    TestBed.configureTestingModule({
      imports: [RecordsReviewComponent, RouterTestingModule],
      providers: [{provide: FastenApiService, useValue: apiSpy}],
    }).compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(RecordsReviewComponent);
    component = fixture.componentInstance;
  });

  /** Buttons by what they say, not by position: the identity question (#761) shares these styles. */
  const buttonsSaying = (text: string): HTMLButtonElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).filter((b) => b.textContent!.includes(text));

  /** The "Right as written" button of the nth waiting record. */
  const confirmButton = (n: number): HTMLButtonElement => buttonsSaying('Right as written')[n]!;

  /** The "Delete" button of the nth waiting record, and the "Yes, delete it" that follows it. */
  const deleteButton = (n: number): HTMLButtonElement => buttonsSaying('Delete')[n]!;
  const reallyDeleteButton = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('button.btn-danger') as HTMLButtonElement;

  it('shows each waiting record with the reason in the words the person was shown', () => {
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Blood pressure 128 systolic mmHg');
    expect(text).toContain('only the systolic half of this blood pressure was given');
    expect(text).toContain('peak flow');
  });

  // A record with no date must not read as undated-by-accident: the screen says so.
  it('says when a record has no date rather than leaving the line blank', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('no date');
  });

  it('confirming removes that record from the list and names it, leaving the others', () => {
    fixture.detectChanges();
    confirmButton(0).click(); // through the DOM, as a person does — inside Angular's event handling
    fixture.detectChanges();
    expect(apiSpy.confirmRecordReview).toHaveBeenCalledWith('o-1');
    expect(component.items.map((i) => i.source_resource_id)).toEqual(['o-2']);
    expect(fixture.nativeElement.textContent).toContain('Added to your records: Blood pressure 128 systolic mmHg');
  });

  it('cannot confirm the same record twice while the first is in flight', () => {
    fixture.detectChanges();
    apiSpy.confirmRecordReview.and.returnValue(NEVER); // in flight, never settles
    confirmButton(0).click();
    fixture.detectChanges();
    confirmButton(0).click();
    expect(apiSpy.confirmRecordReview).toHaveBeenCalledTimes(1);
  });

  it('keeps the record listed when confirming fails, and says why', () => {
    fixture.detectChanges();
    apiSpy.confirmRecordReview.and.returnValue(throwError(() => ({error: {error: 'this record is not waiting for review'}})));
    confirmButton(0).click();
    fixture.detectChanges();
    expect(component.items.length).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('this record is not waiting for review');
  });

  // yourphr#762, decided 2026-09-23: a discarded record leaves NO trace, so the person is asked
  // first — in the page, where the warning can say what "gone" actually means.
  it('asks before deleting, and sends nothing until the person says yes', () => {
    fixture.detectChanges();
    deleteButton(0).click();
    fixture.detectChanges();
    expect(apiSpy.discardRecordReview).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('no copy is kept');
    expect(component.items.length).toBe(2);
  });

  it('keeps the record when the person backs out of the delete', () => {
    fixture.detectChanges();
    deleteButton(0).click();
    fixture.detectChanges();
    buttonsSaying('Keep it')[0]!.click();
    fixture.detectChanges();
    expect(apiSpy.discardRecordReview).not.toHaveBeenCalled();
    expect(component.pendingDiscardId).toBe('');
  });

  it('deleting removes that record and says nothing was kept', () => {
    fixture.detectChanges();
    deleteButton(0).click();
    fixture.detectChanges();
    reallyDeleteButton().click();
    fixture.detectChanges();
    expect(apiSpy.discardRecordReview).toHaveBeenCalledWith('o-1');
    expect(component.items.map((i) => i.source_resource_id)).toEqual(['o-2']);
    expect(fixture.nativeElement.textContent).toContain('Deleted: Blood pressure 128 systolic mmHg. Nothing was kept.');
  });

  it('keeps the record listed when deleting fails, and says why', () => {
    fixture.detectChanges();
    apiSpy.discardRecordReview.and.returnValue(throwError(() => ({error: {error: 'this record is not waiting for review'}})));
    deleteButton(0).click();
    fixture.detectChanges();
    reallyDeleteButton().click();
    fixture.detectChanges();
    expect(component.items.length).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('this record is not waiting for review');
  });

  // yourphr#761: sameness is asserted by the person, prefilled from the evidence.
  it('asks which records are about the person, and shows what each answer would rest on', () => {
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Which of these records are about you?');
    expect(text).toContain('You signed in to Fake Regional Health yourself');
    expect(text).toContain('A file says nothing about whose record it is');
  });

  it('preselects only the source the person authenticated to — the uploaded file offers nothing', () => {
    fixture.detectChanges();
    // Both sources offer the answer; only the authenticated one offers it as the preselected button.
    expect(buttonsSaying('Yes, this is me').length).toBe(2);
    expect(buttonsSaying('Yes, this is me').filter((b) => b.classList.contains('btn-az-primary')).length).toBe(1);
  });

  it('sends the answer and re-reads, because one answer changes what the others conflict about', () => {
    fixture.detectChanges();
    buttonsSaying('Yes, this is me')[0]!.click();
    fixture.detectChanges();
    expect(apiSpy.assertSourceIdentity).toHaveBeenCalledWith('source-2', 'self');
    expect(apiSpy.getSourceIdentities).toHaveBeenCalledTimes(2);
  });

  it('offers "someone I care for" as an equal answer, not an exception', () => {
    fixture.detectChanges();
    buttonsSaying('No, someone I care for')[0]!.click();
    fixture.detectChanges();
    expect(apiSpy.assertSourceIdentity).toHaveBeenCalledWith('source-2', 'not-self');
  });

  it('shows a disagreement between answered sources without offering to resolve it', () => {
    apiSpy.getSourceIdentities.and.returnValue(of([{...identities[1], answer: 'self' as const}]));
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Your sources disagree about something');
    expect(text).toContain('different date of birth');
    expect(text).toContain('Shown, not settled');
  });

  it('still shows the record queue when the identity read fails', () => {
    apiSpy.getSourceIdentities.and.returnValue(throwError(() => ({error: {error: 'nope'}})));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Blood pressure 128 systolic mmHg');
    expect(component.identities).toEqual([]);
  });

  it('says plainly when nothing is waiting, rather than showing an empty page', () => {
    apiSpy.getRecordsAwaitingReview.and.returnValue(of([]));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Nothing is waiting');
  });
});
