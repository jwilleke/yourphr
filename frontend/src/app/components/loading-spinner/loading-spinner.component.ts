import {Component, Input, OnInit, ChangeDetectionStrategy} from '@angular/core';

@Component({
  standalone: true,
  selector: 'app-loading-spinner',
  templateUrl: './loading-spinner.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./loading-spinner.component.scss']
})
export class LoadingSpinnerComponent implements OnInit {
  @Input() loadingTitle = "Please wait, loading..."
  @Input() loadingSubTitle = ""

  constructor() { }

  ngOnInit(): void {
  }

}
