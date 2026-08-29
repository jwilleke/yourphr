import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';

import {RouterModule} from '@angular/router';

@Component({
    imports: [RouterModule],
    selector: 'empty-widget',
    templateUrl: './empty-widget.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./empty-widget.component.scss']
})
export class EmptyWidgetComponent implements OnInit {

  constructor() { }

  ngOnInit(): void {
  }

}
