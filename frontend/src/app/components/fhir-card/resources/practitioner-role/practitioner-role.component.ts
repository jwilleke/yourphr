import {ChangeDetectorRef, Component, Input, OnInit} from '@angular/core';
import {NgbCollapseModule} from '@ng-bootstrap/ng-bootstrap';
import {CommonModule} from '@angular/common';
import {Router, RouterModule} from '@angular/router';
import {BadgeComponent} from '../../common/badge/badge.component';
import {TableComponent} from '../../common/table/table.component';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {FhirCardComponentInterface} from '../../fhir-card/fhir-card-component-interface';
import {PractitionerRoleModel} from '../../../../../lib/models/resources/practitioner-role-model';

@Component({
    imports: [NgbCollapseModule, CommonModule, BadgeComponent, TableComponent, RouterModule],
    selector: 'fhir-practitioner-role',
    templateUrl: './practitioner-role.component.html',
    styleUrls: ['./practitioner-role.component.scss']
})
export class PractitionerRoleComponent implements OnInit, FhirCardComponentInterface {
  @Input() displayModel: PractitionerRoleModel | null
  @Input() showDetails = true
  @Input() isCollapsed = false

  tableData: TableRowItem[] = []

  constructor(public changeRef: ChangeDetectorRef, public router: Router) {}

  ngOnInit(): void {
    const locations = (this.displayModel?.locations || []).map((l) => l?.display || l?.reference).filter(Boolean).join(', ')
    const phones = (this.displayModel?.telecom || []).map((t) => t?.value).filter(Boolean).join(', ')
    const endpoints = (this.displayModel?.endpoints || []).map((e) => e?.display || e?.reference).filter(Boolean).join(', ')

    this.tableData = [
      {
        // US Core MS: practitioner
        label: 'Practitioner',
        data: this.displayModel?.practitioner,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.practitioner,
      },
      {
        // US Core MS: organization
        label: 'Organization',
        data: this.displayModel?.organization,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.organization,
      },
      {
        // US Core MS: location
        label: 'Location',
        data: locations,
        enabled: locations.length > 0,
      },
      {
        // US Core MS: telecom
        label: 'Phone',
        data: phones,
        enabled: phones.length > 0,
      },
      {
        // US Core MS: endpoint
        label: 'Endpoint',
        data: endpoints,
        enabled: endpoints.length > 0,
      },
    ]

    // US Core MS: code (role) + specialty — one row each
    for (const code of (this.displayModel?.codes || [])) {
      this.tableData.push({ label: 'Role', data: code, data_type: TableRowItemDataType.CodableConcept, enabled: true })
    }
    for (const specialty of (this.displayModel?.specialties || [])) {
      this.tableData.push({ label: 'Specialty', data: specialty, data_type: TableRowItemDataType.CodableConcept, enabled: true })
    }
  }

  markForCheck(){
    this.changeRef.markForCheck()
  }
}
