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
    api = jasmine.createSpyObj('FastenApiService', ['getServerLogs', 'setServerLogLevel']);
    api.getServerLogs.and.returnValue(of({level: 'info', valid_levels: ['trace', 'debug', 'info', 'warn', 'error'], lines: ['a', 'b']}));
    api.setServerLogLevel.and.returnValue(of({level: 'debug'}));

    await TestBed.configureTestingModule({
      imports: [ServerLogsComponent, RouterTestingModule],
      providers: [{provide: FastenApiService, useValue: api}],
    }).compileComponents();

    fixture = TestBed.createComponent(ServerLogsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    component.ngOnDestroy(); // stop the live-tail interval so it doesn't leak between tests
  });

  it('loads logs + level on init and has a back-to-admin link', () => {
    expect(api.getServerLogs).toHaveBeenCalled();
    expect(component.loading).toBeFalse();
    expect(component.level).toBe('info');
    expect(component.logs?.lines.length).toBe(2);
    const hrefs = Array.from(fixture.nativeElement.querySelectorAll('a[href]')).map((a: any) => a.getAttribute('href'));
    expect(hrefs).toContain('/admin');
  });

  it('changes the running log level and reloads', () => {
    // after the change, the reload reflects the new running level (as the server would report)
    api.getServerLogs.and.returnValue(of({level: 'debug', valid_levels: ['trace', 'debug', 'info', 'warn', 'error'], lines: ['a', 'b', 'c']}));
    component.onLevelChange('debug');
    expect(api.setServerLogLevel).toHaveBeenCalledWith('debug');
    expect(api.getServerLogs).toHaveBeenCalledTimes(2); // init + reload
    expect(component.level).toBe('debug');
  });

  it('flags an error when the logs request fails', () => {
    api.getServerLogs.and.returnValue(throwError(() => new Error('boom')));
    component.load();
    expect(component.errored).toBeTrue();
    expect(component.loading).toBeFalse();
  });

  it('live tail can be paused and resumed', () => {
    expect(component.live).toBeTrue();
    component.toggleLive();
    expect(component.live).toBeFalse();
    component.toggleLive();
    expect(component.live).toBeTrue();
  });
});
