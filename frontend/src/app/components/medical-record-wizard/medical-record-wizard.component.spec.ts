import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MedicalRecordWizardComponent } from './medical-record-wizard.component';
import {NgbActiveModal, NgbModal} from '@ng-bootstrap/ng-bootstrap';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {HTTP_CLIENT_TOKEN} from '../../dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';

describe('MedicalRecordWizardComponent', () => {
  let component: MedicalRecordWizardComponent;
  let fixture: ComponentFixture<MedicalRecordWizardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
    imports: [MedicalRecordWizardComponent],
    providers: [NgbActiveModal, NgbModal, {
            provide: HTTP_CLIENT_TOKEN,
            useClass: HttpClient,
        }, provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting()]
})
    .compileComponents();

    fixture = TestBed.createComponent(MedicalRecordWizardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
