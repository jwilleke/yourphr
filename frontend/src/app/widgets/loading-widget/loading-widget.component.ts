import { Component, OnInit } from '@angular/core';
import {CommonModule} from '@angular/common';

@Component({
    imports: [CommonModule],
    selector: 'loading-widget',
    templateUrl: './loading-widget.component.html',
    styleUrls: ['./loading-widget.component.scss']
})
export class LoadingWidgetComponent implements OnInit {

  constructor() { }

  ngOnInit(): void {
  }

}
