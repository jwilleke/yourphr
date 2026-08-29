import { Component, OnInit } from '@angular/core';

import {RouterModule} from '@angular/router';

@Component({
    imports: [RouterModule],
    selector: 'empty-widget',
    templateUrl: './empty-widget.component.html',
    styleUrls: ['./empty-widget.component.scss']
})
export class EmptyWidgetComponent implements OnInit {

  constructor() { }

  ngOnInit(): void {
  }

}
