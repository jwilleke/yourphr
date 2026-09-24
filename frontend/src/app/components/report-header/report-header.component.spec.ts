import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ReportHeaderComponent } from './report-header.component';
import {FastenApiService} from '../../services/fasten-api.service';
import {of, throwError} from 'rxjs';
import { RouterTestingModule } from '@angular/router/testing';
import { NgbModal, NgbModule } from '@ng-bootstrap/ng-bootstrap';

describe('ReportHeaderComponent', () => {
  let component: ReportHeaderComponent;
  let fixture: ComponentFixture<ReportHeaderComponent>;
  let mockedFastenApiService

  beforeEach(async () => {
    mockedFastenApiService = jasmine.createSpyObj('FastenApiService', ['getResources', 'getSummary', 'getIPSExport'])

    await TestBed.configureTestingModule({
      imports: [ RouterTestingModule, NgbModule ],
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

    // Was "Export to PDF", which saved a .pdf holding the API's JSON envelope — the endpoint has
    // never been able to render a PDF (#687).
    it('exports the summary as a web page a person can read or print', () => {
      component.getIPSExport(new MouseEvent('click'));

      expect(mockedFastenApiService.getIPSExport).toHaveBeenCalledWith('html');
    });
  });

  describe('Send to Email (#524, #687)', () => {
    // #687: the instance has no mail transport, so rather than a button that 404s, the dialog hands
    // the person the file and the warning and they attach it themselves. Same outcome as #524
    // settled — their data, sent by them — with nothing in the middle pretending to send it.
    it('downloads the summary to attach, rather than asking the server to send it', async () => {
      const modal = TestBed.inject(NgbModal);
      spyOn(modal, 'open').and.returnValue({result: Promise.resolve('download')} as any);

      component.sendToEmail(new MouseEvent('click'));
      await Promise.resolve();
      await Promise.resolve();

      expect(mockedFastenApiService.getIPSExport).toHaveBeenCalledWith('html');
    });

    it('downloads nothing when the dialog is dismissed', async () => {
      const modal = TestBed.inject(NgbModal);
      spyOn(modal, 'open').and.returnValue({result: Promise.reject('dismissed')} as any);

      component.sendToEmail(new MouseEvent('click'));
      await Promise.resolve();
      await Promise.resolve();

      expect(mockedFastenApiService.getIPSExport).not.toHaveBeenCalled();
    });

    it('offers the FHIR bundle for a system that will import it', async () => {
      const modal = TestBed.inject(NgbModal);
      spyOn(modal, 'open').and.returnValue({result: Promise.resolve('download')} as any);

      component.sendToEmail(new MouseEvent('click'));
      component.emailFormat = 'json';
      await Promise.resolve();
      await Promise.resolve();

      expect(mockedFastenApiService.getIPSExport).toHaveBeenCalledWith('json');
    });
  });
});
