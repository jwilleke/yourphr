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
}
