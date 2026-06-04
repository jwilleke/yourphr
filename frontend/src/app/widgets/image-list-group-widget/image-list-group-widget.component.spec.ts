import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ImageListGroupWidgetComponent } from './image-list-group-widget.component';
import {FastenApiService} from '../../services/fasten-api.service';
import {HTTP_CLIENT_TOKEN} from '../../dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

describe('ImageListGroupWidgetComponent', () => {
  let component: ImageListGroupWidgetComponent;
  let fixture: ComponentFixture<ImageListGroupWidgetComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
    imports: [ImageListGroupWidgetComponent],
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

    fixture = TestBed.createComponent(ImageListGroupWidgetComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
