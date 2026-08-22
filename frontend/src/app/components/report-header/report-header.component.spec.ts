import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ReportHeaderComponent } from './report-header.component';
import {FastenApiService} from '../../services/fasten-api.service';
import {of, throwError} from 'rxjs';
import { RouterTestingModule } from '@angular/router/testing';
import { NgbModal, NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { HttpClientTestingModule } from '@angular/common/http/testing';

describe('ReportHeaderComponent', () => {
  let component: ReportHeaderComponent;
  let fixture: ComponentFixture<ReportHeaderComponent>;
  let mockedFastenApiService

  beforeEach(async () => {
    mockedFastenApiService = jasmine.createSpyObj('FastenApiService', ['getResources', 'getSummary', 'getIPSExport'])

    await TestBed.configureTestingModule({
      imports: [ RouterTestingModule, NgbModule, HttpClientTestingModule ],
      declarations: [ ReportHeaderComponent ],
      providers: [{
        provide: FastenApiService,
        useValue: mockedFastenApiService
      }]
    })
    .compileComponents();
    mockedFastenApiService.getResources.and.returnValue(of({}));
    mockedFastenApiService.getSummary.and.returnValue(of({sources: []}));

    fixture = TestBed.createComponent(ReportHeaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Save Report (#523)', () => {
    // The button used to be inert AND carried routerLink="/", so pressing it threw you off the page.
    it('should not download until the warning is accepted', () => {
      component.saveReport(new MouseEvent('click'));

      expect(mockedFastenApiService.getIPSExport).not.toHaveBeenCalled();
    });

    it('should download the web-page report once accepted', async () => {
      const modal = TestBed.inject(NgbModal);
      spyOn(modal, 'open').and.returnValue({result: Promise.resolve('download')} as any);

      component.saveReport(new MouseEvent('click'));
      await Promise.resolve();
      await Promise.resolve();

      expect(mockedFastenApiService.getIPSExport).toHaveBeenCalledWith('html');
    });

    // Downloading an importable bundle matters as much as emailing one: it is the form another
    // system can actually read (#523).
    it('should download the FHIR bundle when that format is chosen', async () => {
      const modal = TestBed.inject(NgbModal);
      spyOn(modal, 'open').and.callFake(() => {
        // The choice is made inside the dialog, before it resolves.
        component.saveFormat = 'json';
        return {result: Promise.resolve('download')} as any;
      });

      component.saveReport(new MouseEvent('click'));
      await Promise.resolve();
      await Promise.resolve();

      expect(mockedFastenApiService.getIPSExport).toHaveBeenCalledWith('json');
    });

    // Dismissing must be a real cancel, not a delayed yes.
    it('should download nothing when the warning is dismissed', async () => {
      const modal = TestBed.inject(NgbModal);
      spyOn(modal, 'open').and.returnValue({result: Promise.reject('dismissed')} as any);

      component.saveReport(new MouseEvent('click'));
      await Promise.resolve();
      await Promise.resolve();

      expect(mockedFastenApiService.getIPSExport).not.toHaveBeenCalled();
    });

    it('should leave Export to PDF on the PDF format', () => {
      component.getIPSExport(new MouseEvent('click'));

      expect(mockedFastenApiService.getIPSExport).toHaveBeenCalledWith('pdf');
    });
  });

  describe('Send to Email (#524)', () => {
    beforeEach(() => {
      mockedFastenApiService.sendIPSExportByEmail = jasmine.createSpy('sendIPSExportByEmail');
    });

    it('should not send without a recipient', () => {
      component.emailRecipient = '   ';

      component.confirmSendEmail();

      expect(mockedFastenApiService.sendIPSExportByEmail).not.toHaveBeenCalled();
      expect(component.emailError).toContain('Enter the address');
    });

    it('should send the trimmed address, defaulting to PDF', () => {
      mockedFastenApiService.sendIPSExportByEmail.and.returnValue(of({sent_to: 'doc@example.org'}));
      component.emailRecipient = '  doc@example.org  ';

      component.confirmSendEmail();

      expect(mockedFastenApiService.sendIPSExportByEmail).toHaveBeenCalledWith('doc@example.org', 'pdf');
      expect(component.emailSentTo).toEqual('doc@example.org');
      expect(component.emailSending).toBeFalse();
    });

    // A PDF is for a person to read; the FHIR bundle is what a receiving system can import, which is
    // usually the actual goal of sending records to a new provider.
    it('should send the FHIR bundle when that format is chosen', () => {
      mockedFastenApiService.sendIPSExportByEmail.and.returnValue(of({sent_to: 'clinic@example.org'}));
      component.emailRecipient = 'clinic@example.org';
      component.emailFormat = 'json';

      component.confirmSendEmail();

      expect(mockedFastenApiService.sendIPSExportByEmail).toHaveBeenCalledWith('clinic@example.org', 'json');
    });

    // The relay's own reason is the only thing that tells somebody whether to fix the address, wait,
    // or ask their administrator. A generic "failed" is #527 all over again.
    it('should surface the server error rather than a generic failure', () => {
      mockedFastenApiService.sendIPSExportByEmail.and.returnValue(
        throwError(() => ({error: {error: 'email is not enabled on this instance'}}))
      );
      component.emailRecipient = 'doc@example.org';

      component.confirmSendEmail();

      expect(component.emailError).toEqual('email is not enabled on this instance');
      expect(component.emailSending).toBeFalse();
      expect(component.emailSentTo).toEqual('');
    });

    it('should fall back to a plain message when the server sends none', () => {
      mockedFastenApiService.sendIPSExportByEmail.and.returnValue(throwError(() => ({})));
      component.emailRecipient = 'doc@example.org';

      component.confirmSendEmail();

      expect(component.emailError).toEqual('The report could not be sent.');
    });
  });
});
