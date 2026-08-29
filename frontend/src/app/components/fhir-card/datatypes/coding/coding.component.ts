import {Component, Input, OnInit} from '@angular/core';
import {CodingModel} from '../../../../../lib/models/datatypes/coding-model';


@Component({
    imports: [],
    selector: 'fhir-coding',
    templateUrl: './coding.component.html',
    styleUrls: ['./coding.component.scss']
})
export class CodingComponent implements OnInit {
  @Input() coding: CodingModel
  has_additional_info = false
  constructor() { }


  ngOnInit(): void {
    this.has_additional_info = !!(this.coding?.code || this.coding?.system)
  }

}
