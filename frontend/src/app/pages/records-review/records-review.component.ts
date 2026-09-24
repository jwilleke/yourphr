import {Component, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {RouterModule} from '@angular/router';
import {FastenApiService, RecordAwaitingReview, SourceIdentity} from '../../services/fasten-api.service';
import {LoadingSpinnerComponent} from '../../components/loading-spinner/loading-spinner.component';
import {extractErrorFromResponse} from '../../../lib/utils/error_extract';

/**
 * What you wrote that is waiting on you (#762).
 *
 * A record you entered is never discarded, but one this instance could not fully understand is kept
 * out of your chart until you say what it should be: it does not appear in your record lists, your
 * counts, search, or a summary you share. This is where you see those, and where you say "yes, that
 * is right as written" — which is the only thing that puts one back.
 *
 * Confirming fills nothing in. A record with no date stays undated; correcting it is an edit, not
 * this. That is deliberate: the screen exists so that nothing is ever guessed on your behalf.
 *
 * The same screen asks the one question about identity (#761): each provider you connect sent a
 * record of a person, and a portal can be one you read on someone else's behalf. You say which are
 * about you. The answer is preselected from what is known — you signed in there yourself — so it is
 * a confirmation, not a puzzle, and nothing about your chart moves either way.
 */
@Component({
  standalone: true,
  imports: [RouterModule, LoadingSpinnerComponent],
  selector: 'app-records-review',
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './records-review.component.html',
})
export class RecordsReviewComponent implements OnInit {
  items: RecordAwaitingReview[] = [];
  loading = true;
  error = '';
  /**
   * The one record currently being confirmed, so a second click cannot send a second request.
   * A plain field rather than a Set the template has to interrogate: a binding that calls a method
   * runs on every check, and one click confirms one record.
   */
  confirmingId = '';
  confirmedTitle = '';
  /**
   * The record whose delete has been asked for but not yet agreed to, and the one being deleted.
   * Deleting leaves no trace (#762, decided 2026-09-23), so it is asked in two steps — in the page,
   * where the warning can say plainly what "gone" means, rather than in a browser dialog.
   */
  pendingDiscardId = '';
  discardingId = '';
  discardedTitle = '';
  /** The identity question (#761): one per connected source, answered once. */
  identities: SourceIdentity[] = [];
  answeringSourceId = '';

  constructor(private api: FastenApiService) {}

  ngOnInit(): void {
    this.load();
    this.loadIdentities();
  }

  loadIdentities(): void {
    // A failure here costs the identity question, not the record queue: they are separate answers
    // to separate questions, and one being unavailable must not hide the other.
    this.api.getSourceIdentities().subscribe({next: (identities) => this.identities = identities, error: () => this.identities = []});
  }

  /** The ones still to answer, preselected where the evidence says something. */
  get unanswered(): SourceIdentity[] {
    return this.identities.filter((i) => i.answer === '');
  }

  /** Answered, and carrying a disagreement between sources that nobody has looked at. */
  get answeredWithConflicts(): SourceIdentity[] {
    return this.identities.filter((i) => i.answer !== '' && i.conflicts.length > 0);
  }

  answer(identity: SourceIdentity, answer: 'self' | 'not-self'): void {
    if (this.answeringSourceId !== '') {
      return;
    }
    this.error = '';
    this.answeringSourceId = identity.sourceId;
    this.api.assertSourceIdentity(identity.sourceId, answer).subscribe({
      next: () => {
        this.answeringSourceId = '';
        // Re-read rather than patch: answering changes what other identities conflict about.
        this.loadIdentities();
      },
      error: (err) => {
        this.answeringSourceId = '';
        this.error = extractErrorFromResponse(err) || `Could not record your answer about ${identity.display}.`;
      },
    });
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.api.getRecordsAwaitingReview().subscribe({
      next: (items) => {
        this.items = items;
        this.loading = false;
      },
      error: (err) => {
        this.error = extractErrorFromResponse(err) || 'Could not load the records waiting for you.';
        this.loading = false;
      },
    });
  }

  confirm(item: RecordAwaitingReview): void {
    if (this.confirmingId !== '') {
      return;
    }
    this.error = '';
    this.pendingDiscardId = '';
    this.confirmingId = item.source_resource_id;
    this.api.confirmRecordReview(item.source_resource_id).subscribe({
      next: () => {
        this.confirmingId = '';
        this.items = this.items.filter((i) => i.source_resource_id !== item.source_resource_id);
        this.confirmedTitle = item.title;
      },
      error: (err) => {
        this.confirmingId = '';
        this.error = extractErrorFromResponse(err) || `Could not confirm ${item.title}.`;
      },
    });
  }

  /** First click on Delete: ask. Nothing is sent until the person says yes. */
  askDiscard(item: RecordAwaitingReview): void {
    this.error = '';
    this.pendingDiscardId = item.source_resource_id;
  }

  keepIt(): void {
    this.pendingDiscardId = '';
  }

  /** The person said yes. The record is deleted outright — no copy is kept anywhere. */
  discard(item: RecordAwaitingReview): void {
    if (this.discardingId !== '') {
      return;
    }
    this.error = '';
    this.discardingId = item.source_resource_id;
    this.api.discardRecordReview(item.source_resource_id).subscribe({
      next: () => {
        this.discardingId = '';
        this.pendingDiscardId = '';
        this.items = this.items.filter((i) => i.source_resource_id !== item.source_resource_id);
        this.discardedTitle = item.title;
        this.confirmedTitle = '';
      },
      error: (err) => {
        this.discardingId = '';
        this.error = extractErrorFromResponse(err) || `Could not delete ${item.title}.`;
      },
    });
  }
}
