import {Component, Input, OnInit, ChangeDetectionStrategy} from '@angular/core';

import {CodingComponent} from '../coding/coding.component';
import {CodingModel} from '../../../../../lib/models/datatypes/coding-model';
import {CodableConceptModel} from '../../../../../lib/models/datatypes/codable-concept-model';

@Component({
    imports: [],
    selector: 'fhir-codable-concept',
    templateUrl: './codable-concept.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./codable-concept.component.scss']
})
export class CodableConceptComponent implements OnInit {
  @Input() codableConcept: CodableConceptModel

  constructor() { }

  ngOnInit(): void {
  }

}
