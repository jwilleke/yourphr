import {ComponentFixture, TestBed} from '@angular/core/testing';
import {of, throwError} from 'rxjs';

import {AdminDashboardComponent} from './admin-dashboard.component';
import {FastenApiService} from '../../services/fasten-api.service';

describe('AdminDashboardComponent', () => {
  let component: AdminDashboardComponent;
  let fixture: ComponentFixture<AdminDashboardComponent>;
  let api: jasmine.SpyObj<FastenApiService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj('FastenApiService', ['getServerLogs']);
    api.getServerLogs.and.returnValue(of({configured: true, path: '/var/log/fasten.log', lines: ['a', 'b']}));

    await TestBed.configureTestingModule({
      imports: [AdminDashboardComponent],
      providers: [{provide: FastenApiService, useValue: api}],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminDashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates and loads logs on init', () => {
    expect(component).toBeTruthy();
    expect(api.getServerLogs).toHaveBeenCalled();
    expect(component.logsLoading).toBeFalse();
    expect(component.logs?.lines.length).toBe(2);
  });

  it('flags an error when the logs request fails', () => {
    api.getServerLogs.and.returnValue(throwError(() => new Error('boom')));
    component.loadLogs();
    expect(component.logsErrored).toBeTrue();
    expect(component.logsLoading).toBeFalse();
  });
});
