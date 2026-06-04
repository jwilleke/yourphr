import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MedicalRecordWizardEditOrganizationComponent } from './medical-record-wizard-edit-organization.component';
import {NgbActiveModal, NgbModal, NgbModalModule} from '@ng-bootstrap/ng-bootstrap';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {HTTP_CLIENT_TOKEN} from '../../dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';

describe('MedicalRecordWizardEditOrganizationComponent', () => {
  let component: MedicalRecordWizardEditOrganizationComponent;
  let fixture: ComponentFixture<MedicalRecordWizardEditOrganizationComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
    imports: [MedicalRecordWizardEditOrganizationComponent],
    providers: [NgbModal, NgbActiveModal, {
            provide: HTTP_CLIENT_TOKEN,
            useClass: HttpClient,
        }, provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting()]
})
    .compileComponents();

    fixture = TestBed.createComponent(MedicalRecordWizardEditOrganizationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
