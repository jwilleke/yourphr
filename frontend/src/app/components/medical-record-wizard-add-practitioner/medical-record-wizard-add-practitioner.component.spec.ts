import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MedicalRecordWizardAddPractitionerComponent } from './medical-record-wizard-add-practitioner.component';
import {NgbActiveModal, NgbModal} from '@ng-bootstrap/ng-bootstrap';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {HTTP_CLIENT_TOKEN} from '../../dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';

describe('MedicalRecordWizardAddPractitionerComponent', () => {
  let component: MedicalRecordWizardAddPractitionerComponent;
  let fixture: ComponentFixture<MedicalRecordWizardAddPractitionerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
    imports: [MedicalRecordWizardAddPractitionerComponent],
    providers: [NgbActiveModal, NgbModal, {
            provide: HTTP_CLIENT_TOKEN,
            useClass: HttpClient,
        }, provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting()]
})
    .compileComponents();

    fixture = TestBed.createComponent(MedicalRecordWizardAddPractitionerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
