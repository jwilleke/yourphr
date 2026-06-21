import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { FooterComponent } from './footer.component';
import { FastenApiService } from '../../services/fasten-api.service';

describe('FooterComponent', () => {
  let component: FooterComponent;
  let fixture: ComponentFixture<FooterComponent>;

  beforeEach(waitForAsync(() => {
    const apiSpy = jasmine.createSpyObj('FastenApiService', ['getVersion']);
    apiSpy.getVersion.and.returnValue(of('1.9.0'));
    TestBed.configureTestingModule({
      declarations: [ FooterComponent ],
      providers: [ { provide: FastenApiService, useValue: apiSpy } ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(FooterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
