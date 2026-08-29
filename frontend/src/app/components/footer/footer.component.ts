import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import {FastenApiService} from '../../services/fasten-api.service';

@Component({
    selector: 'app-footer',
    templateUrl: './footer.component.html',
    styleUrls: ['./footer.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class FooterComponent implements OnInit {
  // Shows "<env>-<semver>" of the RUNNING backend, e.g. "demo-1.18.2" / "willeke-1.18.2".
  //
  // The label comes from the BACKEND ONLY (yourphr.web.environment-name, supplied by
  // YOURPHR_WEB_ENVIRONMENT_NAME). It is a property of the instance, not of the bundle: one image
  // serves every instance, so a name compiled into the bundle can only ever be a guess, and on
  // yourphr#673 that guess told a production instance it was a sandbox. Empty renders the version
  // alone — an instance that has not named itself has no name to show (the no-guessing rule).
  appVersion = '';
  currentYear: number = new Date().getFullYear();

  constructor(private fastenApi: FastenApiService) {}

  ngOnInit() {
    this.fastenApi.getVersion().subscribe({
      next: ({ version, environment_name }) => {
        this.appVersion = environment_name ? `${environment_name}-${version}` : version;
      },
      error: () => { /* the backend could not be asked; the footer shows no version rather than a wrong one */ },
    });
  }

}
