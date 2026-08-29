import {Component, Input, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {BinaryModel} from '../../../../../lib/models/resources/binary-model';


@Component({
    imports: [],
    selector: 'fhir-img',
    templateUrl: './img.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./img.component.scss']
})
export class ImgComponent implements OnInit {
  @Input() displayModel: BinaryModel

  constructor() { }

  ngOnInit(): void {
  }

}
