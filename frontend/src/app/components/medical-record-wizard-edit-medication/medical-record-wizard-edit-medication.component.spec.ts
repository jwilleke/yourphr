import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MedicalRecordWizardEditMedicationComponent } from './medical-record-wizard-edit-medication.component';
import {NgbActiveModal, NgbModal} from '@ng-bootstrap/ng-bootstrap';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {HTTP_CLIENT_TOKEN} from '../../dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';

describe('MedicalRecordWizardEditMedicationComponent', () => {
  let component: MedicalRecordWizardEditMedicationComponent;
  let fixture: ComponentFixture<MedicalRecordWizardEditMedicationComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
    imports: [MedicalRecordWizardEditMedicationComponent],
    providers: [NgbModal, NgbActiveModal, {
            provide: HTTP_CLIENT_TOKEN,
            useClass: HttpClient,
        }, provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting()]
})
    .compileComponents();

    fixture = TestBed.createComponent(MedicalRecordWizardEditMedicationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
