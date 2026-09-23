import {ComponentFixture, TestBed, waitForAsync} from '@angular/core/testing';
import {RouterTestingModule} from '@angular/router/testing';
import {NEVER, of, throwError} from 'rxjs';

import {RecordsReviewComponent} from './records-review.component';
import {FastenApiService, RecordAwaitingReview} from '../../services/fasten-api.service';

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

  beforeEach(waitForAsync(() => {
    apiSpy = jasmine.createSpyObj('FastenApiService', ['getRecordsAwaitingReview', 'confirmRecordReview', 'discardRecordReview']);
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

  /** The "Right as written" button of the nth waiting record. */
  const confirmButton = (n: number): HTMLButtonElement =>
    fixture.nativeElement.querySelectorAll('button.btn-az-primary')[n] as HTMLButtonElement;

  /** The "Delete" button of the nth waiting record, and the "Yes, delete it" that follows it. */
  const deleteButton = (n: number): HTMLButtonElement =>
    fixture.nativeElement.querySelectorAll('button.btn-outline-danger')[n] as HTMLButtonElement;
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
    (fixture.nativeElement.querySelectorAll('button.btn-outline-secondary')[0] as HTMLButtonElement).click(); // "Keep it"
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

  it('says plainly when nothing is waiting, rather than showing an empty page', () => {
    apiSpy.getRecordsAwaitingReview.and.returnValue(of([]));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Nothing is waiting');
  });
});
