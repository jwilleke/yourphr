import {Component, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {RouterModule} from '@angular/router';
import {FastenApiService, RecordAwaitingReview} from '../../services/fasten-api.service';
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

  constructor(private api: FastenApiService) {}

  ngOnInit(): void {
    this.load();
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
