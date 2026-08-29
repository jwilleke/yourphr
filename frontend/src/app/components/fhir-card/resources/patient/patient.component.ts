import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, Input, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { NgbCollapseModule } from '@ng-bootstrap/ng-bootstrap';
import { PatientModel } from '../../../../../lib/models/resources/patient-model';
import { BadgeComponent } from '../../common/badge/badge.component';
import { TableComponent } from '../../common/table/table.component';
import { FhirCardComponentInterface } from '../../fhir-card/fhir-card-component-interface';

@Component({
    imports: [NgbCollapseModule, CommonModule, BadgeComponent, TableComponent, RouterModule],
    selector: 'fhir-patient',
    templateUrl: './patient.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./patient.component.scss']
})
export class PatientComponent implements OnInit, FhirCardComponentInterface {
  @Input() displayModel: PatientModel;
  @Input() showDetails = true;
  @Input() isCollapsed = false;

  constructor(public changeRef: ChangeDetectorRef, public router: Router) { }

  ngOnInit(): void {
  }

  markForCheck(){
    this.changeRef.markForCheck()
  }

}
