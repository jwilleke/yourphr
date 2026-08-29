import {Component, Input, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {BinaryModel} from '../../../../../lib/models/resources/binary-model';
import {DomSanitizer, SafeHtml} from '@angular/platform-browser';


@Component({
    imports: [],
    selector: 'fhir-html',
    templateUrl: './html.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./html.component.scss']
})
export class HtmlComponent implements OnInit {
  @Input() displayModel: BinaryModel
  contentMarkup:SafeHtml;
  constructor(private sanitized: DomSanitizer) { }

  ngOnInit(): void {
    //TODO: safely display html content
    this.contentMarkup = this.sanitized.bypassSecurityTrustHtml(this.displayModel?.content);

  }

}
