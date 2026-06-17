import {ComponentFixture, TestBed} from '@angular/core/testing';
import {of, throwError} from 'rxjs';
import {RouterTestingModule} from '@angular/router/testing';

import {ServerLogsComponent} from './server-logs.component';
import {FastenApiService} from '../../services/fasten-api.service';

describe('ServerLogsComponent', () => {
  let component: ServerLogsComponent;
  let fixture: ComponentFixture<ServerLogsComponent>;
  let api: jasmine.SpyObj<FastenApiService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj('FastenApiService', ['getServerLogs']);
    api.getServerLogs.and.returnValue(of({configured: true, path: '/var/log/fasten.log', lines: ['a', 'b']}));

    await TestBed.configureTestingModule({
      imports: [ServerLogsComponent, RouterTestingModule],
      providers: [{provide: FastenApiService, useValue: api}],
    }).compileComponents();

    fixture = TestBed.createComponent(ServerLogsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads logs on init and has a back-to-admin link', () => {
    expect(api.getServerLogs).toHaveBeenCalled();
    expect(component.loading).toBeFalse();
    expect(component.logs?.lines.length).toBe(2);
    const hrefs = Array.from(fixture.nativeElement.querySelectorAll('a[href]')).map((a: any) => a.getAttribute('href'));
    expect(hrefs).toContain('/admin');
  });

  it('flags an error when the logs request fails', () => {
    api.getServerLogs.and.returnValue(throwError(() => new Error('boom')));
    component.load();
    expect(component.errored).toBeTrue();
    expect(component.loading).toBeFalse();
  });

  // When log.file is unset the backend reports configured=false — the page explains how to enable it.
  it('shows the not-configured message when logs are STDOUT-only', () => {
    api.getServerLogs.and.returnValue(of({configured: false, lines: []}));
    component.load();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('STDOUT only');
  });
});
