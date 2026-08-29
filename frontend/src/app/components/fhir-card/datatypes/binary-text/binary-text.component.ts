import {Component, Input, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {BinaryModel} from '../../../../../lib/models/resources/binary-model';


@Component({
    imports: [],
    selector: 'fhir-binary-text',
    templateUrl: './binary-text.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./binary-text.component.scss']
})
export class BinaryTextComponent implements OnInit {
  @Input() displayModel: BinaryModel

  constructor() { }

  ngOnInit(): void {
  }

}
