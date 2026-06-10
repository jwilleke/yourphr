import {ChangeDetectorRef, Component, Input, OnInit} from '@angular/core';
import {NgbCollapseModule} from '@ng-bootstrap/ng-bootstrap';
import {CommonModule} from '@angular/common';
import {Router, RouterModule} from '@angular/router';
import * as _ from 'lodash';
import {BadgeComponent} from '../../common/badge/badge.component';
import {TableComponent} from '../../common/table/table.component';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {FhirCardComponentInterface} from '../../fhir-card/fhir-card-component-interface';
import {RelatedPersonModel} from '../../../../../lib/models/resources/related-person-model';

@Component({
    imports: [NgbCollapseModule, CommonModule, BadgeComponent, TableComponent, RouterModule],
    selector: 'fhir-related-person',
    templateUrl: './related-person.component.html',
    styleUrls: ['./related-person.component.scss']
})
export class RelatedPersonComponent implements OnInit, FhirCardComponentInterface {
  @Input() displayModel: RelatedPersonModel | null
  @Input() showDetails = true
  @Input() isCollapsed = false

  tableData: TableRowItem[] = []

  constructor(public changeRef: ChangeDetectorRef, public router: Router) {}

  ngOnInit(): void {
    const addr = this.displayModel?.address as any
    const address = addr
      ? (addr.text || [(addr.line || []).join(', '), addr.city, addr.state, addr.postalCode].filter(Boolean).join(', '))
      : ''
    const phones = ((this.displayModel?.related_person_telecom as any) || [])
      .map((t: any) => t?.value)
      .filter(Boolean)
      .join(', ')

    this.tableData = [
      {
        // US Core MS: patient (the patient this person is related to)
        label: 'Patient',
        data: this.displayModel?.patient,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.patient,
      },
      {
        label: 'Gender',
        data: this.displayModel?.gender,
        enabled: !!this.displayModel?.gender,
      },
      {
        label: 'Birth date',
        data: this.displayModel?.birthdate,
        enabled: !!this.displayModel?.birthdate,
      },
      {
        label: 'Phone',
        data: phones,
        enabled: phones.length > 0,
      },
      {
        label: 'Address',
        data: address,
        enabled: address.length > 0,
      },
    ]

    // US Core MS: relationship (array of CodeableConcept)
    for (const rel of (this.displayModel?.relationship || [])) {
      this.tableData.push({
        label: 'Relationship',
        data: rel,
        data_type: TableRowItemDataType.CodableConcept,
        enabled: true,
      })
    }
  }

  markForCheck(){
    this.changeRef.markForCheck()
  }
}
