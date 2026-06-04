import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { HTTP_CLIENT_TOKEN } from '../../dependency-injection';

import { FormRequestHealthSystemComponent } from './form-request-health-system.component';

describe('FormRequestHealthSystemComponent', () => {
  let component: FormRequestHealthSystemComponent;
  let fixture: ComponentFixture<FormRequestHealthSystemComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
    declarations: [FormRequestHealthSystemComponent],
    imports: [FormsModule],
    providers: [
        NgbActiveModal,
        {
            provide: HTTP_CLIENT_TOKEN,
            useClass: HttpClient,
        },
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
    ]
})
    .compileComponents();

    fixture = TestBed.createComponent(FormRequestHealthSystemComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
