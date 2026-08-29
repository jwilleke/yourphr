import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';


@Component({
    imports: [],
    selector: 'loading-widget',
    templateUrl: './loading-widget.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./loading-widget.component.scss']
})
export class LoadingWidgetComponent implements OnInit {

  constructor() { }

  ngOnInit(): void {
  }

}
