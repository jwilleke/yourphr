import {Component, Input, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {FastenApiService} from '../../services/fasten-api.service';
import {DomSanitizer, SafeHtml} from '@angular/platform-browser';
import {LoadingSpinnerComponent} from "../loading-spinner/loading-spinner.component";
import {AuthService} from "../../services/auth.service";

import {DirectivesModule} from '../../directives/directives.module';

@Component({
    imports: [LoadingSpinnerComponent, DirectivesModule],
    providers: [FastenApiService, AuthService],
    selector: 'app-glossary-lookup',
    templateUrl: './glossary-lookup.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./glossary-lookup.component.scss']
})
export class GlossaryLookupComponent implements OnInit {

  @Input() code: string
  @Input() codeSystem: string
  @Input() snippetLength = -1

  description: SafeHtml = ""
  url = ""
  source = ""
  loading = true

  constructor(private fastenApi: FastenApiService, private sanitized: DomSanitizer) { }

  ngOnInit(): void {
    this.fastenApi.getGlossarySearchByCode(this.code, this.codeSystem).subscribe(result => {
      this.loading = false
      this.url  = result?.url
      this.source = result?.publisher
      this.description = this.sanitized.bypassSecurityTrustHtml(result?.description)
      // this.description = result.description
    }, error => {
      this.loading = false
    })
  }


}
