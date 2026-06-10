import { Component, OnInit } from '@angular/core';
import {versionInfo} from '../../../environments/versions';

@Component({
    selector: 'app-footer',
    templateUrl: './footer.component.html',
    styleUrls: ['./footer.component.scss'],
    standalone: false
})
export class FooterComponent implements OnInit {
  appVersion: string;
  currentYear: number = new Date().getFullYear();

  constructor() {
    this.appVersion = versionInfo.version
  }

  ngOnInit() {
  }

}
