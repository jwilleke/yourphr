import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';

@Component({
    selector: 'app-utilities-sidebar',
    templateUrl: './utilities-sidebar.component.html',
    styleUrls: ['./utilities-sidebar.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class UtilitiesSidebarComponent implements OnInit {

  constructor() { }

  ngOnInit() {
  }

}
