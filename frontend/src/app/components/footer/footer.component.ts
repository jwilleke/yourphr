import { Component, OnInit } from '@angular/core';
import {environment} from '../../../environments/environment';
import {FastenApiService} from '../../services/fasten-api.service';

@Component({
    selector: 'app-footer',
    templateUrl: './footer.component.html',
    styleUrls: ['./footer.component.scss'],
    standalone: false
})
export class FooterComponent implements OnInit {
  // Shows "<channel>-<semver>" of the RUNNING backend, e.g. "dev-1.9.0" / "prod-1.9.0", so the footer
  // reflects what's actually deployed (fetched from the public /api/version endpoint).
  appVersion: string = environment.environment_name;
  currentYear: number = new Date().getFullYear();

  constructor(private fastenApi: FastenApiService) {}

  ngOnInit() {
    this.fastenApi.getVersion().subscribe({
      next: (version) => { this.appVersion = `${environment.environment_name}-${version}`; },
      error: () => { /* keep the channel-only fallback */ },
    });
  }

}
