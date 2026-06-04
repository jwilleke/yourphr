import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DatatableGenericResourceComponent } from './datatable-generic-resource.component';
import {HTTP_CLIENT_TOKEN} from '../../../dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { NgxDatatableModule } from '@swimlane/ngx-datatable';

describe('ListGenericResourceComponent', () => {
  let component: DatatableGenericResourceComponent;
  let fixture: ComponentFixture<DatatableGenericResourceComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
    declarations: [DatatableGenericResourceComponent],
    imports: [NgxDatatableModule],
    providers: [
        {
            provide: HTTP_CLIENT_TOKEN,
            useClass: HttpClient,
        },
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
    ]
})
    .compileComponents();

    fixture = TestBed.createComponent(DatatableGenericResourceComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
