import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';

@Component({
    selector: 'app-components-sidebar',
    templateUrl: './components-sidebar.component.html',
    styleUrls: ['./components-sidebar.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class ComponentsSidebarComponent implements OnInit {

  constructor() { }

  ngOnInit() {
  }

}
