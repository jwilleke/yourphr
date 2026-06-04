import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DesktopCallbackComponent } from './desktop-callback.component';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {RouterTestingModule} from '@angular/router/testing';
import { LoadingSpinnerComponent } from 'src/app/components/loading-spinner/loading-spinner.component';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';

describe('DesktopCallbackComponent', () => {
  let component: DesktopCallbackComponent;
  let fixture: ComponentFixture<DesktopCallbackComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
    declarations: [DesktopCallbackComponent],
    imports: [RouterTestingModule, LoadingSpinnerComponent],
    providers: [provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting()]
})
    .compileComponents();

    fixture = TestBed.createComponent(DesktopCallbackComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
