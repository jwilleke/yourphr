import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';


@Component({
    selector: 'confirmation-modal',
    imports: [],
    templateUrl: './confirmation-modal.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./confirmation-modal.component.scss']
})
export class ConfirmationModalComponent {
  @Input() message = 'Are you sure?';
  @Input() title = 'Confirm Action';

  constructor(public activeModal: NgbActiveModal) { }

  confirm(): void {
    this.activeModal.close(true);
  }

  cancel(): void {
    this.activeModal.dismiss();
  }
}