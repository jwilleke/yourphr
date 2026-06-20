import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';

import { BinaryComponent } from './binary.component';
import {NgbCollapseModule} from '@ng-bootstrap/ng-bootstrap';
import {FastenApiService} from '../../../../services/fasten-api.service';
import {RouterTestingModule} from '@angular/router/testing';
import {HTTP_CLIENT_TOKEN} from '../../../../dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { throwError } from 'rxjs';
import { BinaryModel } from '../../../../../lib/models/resources/binary-model';
import { AttachmentModel } from '../../../../../lib/models/datatypes/attachment-model';

describe('BinaryComponent', () => {
  let component: BinaryComponent;
  let fixture: ComponentFixture<BinaryComponent>;
  let mockedFastenApiService

  beforeEach(async () => {
    mockedFastenApiService = jasmine.createSpyObj('FastenApiService', ['getBinaryModel'])

    await TestBed.configureTestingModule({
    imports: [BinaryComponent, NgbCollapseModule, RouterTestingModule],
    providers: [
        {
            provide: HTTP_CLIENT_TOKEN,
            useClass: HttpClient,
        },
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
    ]
})
    // BinaryComponent declares its own component-level providers: [FastenApiService, AuthService],
    // which would shadow a module-level mock — so override the component provider with the spy.
    .overrideComponent(BinaryComponent, {
        remove: { providers: [FastenApiService] },
        add: { providers: [{ provide: FastenApiService, useValue: mockedFastenApiService }] },
    })
    .compileComponents();

    fixture = TestBed.createComponent(BinaryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('flags loadError when the referenced Binary cannot be retrieved', fakeAsync(() => {
    mockedFastenApiService.getBinaryModel.and.returnValue(throwError(() => new Error('404')));
    component.displayModel = undefined;
    component.attachmentSourceId = 'src1';
    component.attachmentModel = { url: 'Binary/missing' } as AttachmentModel;
    component.ngOnInit();
    tick();
    expect(mockedFastenApiService.getBinaryModel).toHaveBeenCalled();
    expect(component.loadError).toBeTrue();
    expect(component.loading).toBeFalse();
  }));

  it('derives a download filename with an extension from the content type', () => {
    component.attachmentModel = { title: 'Discharge Summary' } as AttachmentModel;
    component.displayModel = new BinaryModel({ contentType: 'application/pdf', data: btoa('x') });
    expect(component.downloadFilename).toBe('Discharge_Summary.pdf');
  });

  it('keeps an existing extension in the attachment title', () => {
    component.attachmentModel = { title: 'report.pdf' } as AttachmentModel;
    component.displayModel = new BinaryModel({ contentType: 'application/pdf', data: btoa('x') });
    expect(component.downloadFilename).toBe('report.pdf');
  });

  it('download() builds a Blob and triggers a download when content is present', () => {
    component.attachmentModel = { title: 'note' } as AttachmentModel;
    component.displayModel = new BinaryModel({ contentType: 'text/plain', data: btoa('hello') });
    const createSpy = spyOn(URL, 'createObjectURL').and.returnValue('blob:fake');
    const revokeSpy = spyOn(URL, 'revokeObjectURL').and.stub();
    const clickSpy = jasmine.createSpy('click');
    spyOn(document, 'createElement').and.returnValue({ click: clickSpy, set href(_v) {}, set download(_v) {} } as any);
    spyOn(document.body, 'appendChild').and.stub();
    spyOn(document.body, 'removeChild').and.stub();

    component.download();

    expect(createSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalled();
  });

  it('download() is a no-op when there is no stored content', () => {
    component.displayModel = undefined;
    const createSpy = spyOn(URL, 'createObjectURL');
    component.download();
    expect(createSpy).not.toHaveBeenCalled();
  });
});
