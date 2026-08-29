import {Component, Input, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {BinaryModel} from '../../../../../lib/models/resources/binary-model';


@Component({
    imports: [],
    selector: 'fhir-markdown',
    templateUrl: './markdown.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./markdown.component.scss']
})
export class MarkdownComponent implements OnInit {
  @Input() displayModel: BinaryModel

  constructor() { }

  ngOnInit(): void {
  }

}
