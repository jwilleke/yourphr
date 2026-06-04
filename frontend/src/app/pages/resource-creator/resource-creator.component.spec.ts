import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ResourceCreatorComponent } from './resource-creator.component';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {RouterTestingModule} from '@angular/router/testing';
import {NgbCollapseModule, NgbDatepickerModule} from '@ng-bootstrap/ng-bootstrap';
import {HTTP_CLIENT_TOKEN} from '../../dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';

describe('ResourceCreatorComponent', () => {
  let component: ResourceCreatorComponent;
  let fixture: ComponentFixture<ResourceCreatorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
    declarations: [ResourceCreatorComponent],
    imports: [RouterTestingModule, NgbDatepickerModule, NgbCollapseModule],
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

    fixture = TestBed.createComponent(ResourceCreatorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
