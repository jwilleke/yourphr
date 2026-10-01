import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { RouterTestingModule } from '@angular/router/testing';
import { AdminDatabaseComponent } from './admin-database.component';
import { FastenApiService } from '../../services/fasten-api.service';

describe('AdminDatabaseComponent', () => {
  let component: AdminDatabaseComponent;
  let fixture: ComponentFixture<AdminDatabaseComponent>;
  let mockApi: any;

  beforeEach(async () => {
    mockApi = jasmine.createSpyObj('FastenApiService', ['getDatabaseInfo', 'backupDatabase', 'getSearchIndex', 'rebuildSearchIndex']);
    mockApi.getDatabaseInfo.and.returnValue(of({
      location: '/opt/yourphr/data/records.db', encryption_enabled: false, size_bytes: 1048576, users: 2, sources: 4, integrity_ok: true, integrity_detail: 'ok', integrity_checked_at: '2026-10-01T12:00:00Z', integrity_running: false, backup_destination: '/opt/yourphr/data/backups', backups: [], schedule: {enabled:false, time:'02:00', days:'daily', destination:'', max_backups:7},
      backup_health: {ok: true, schedule_enabled: false, consecutive_failures: 0, failing_stale: false, summary: 'Scheduled backups disabled'},
      allowed_backup_roots: ['/opt/yourphr/data'],
    }));
    mockApi.getSearchIndex.and.returnValue(of({builtWith: 0, current: 1, stale: true, rebuild: {state: 'idle'}}));
    mockApi.rebuildSearchIndex.and.returnValue(of({state: 'running', progress: 'account 1 of 2'}));
    await TestBed.configureTestingModule({
      imports: [AdminDatabaseComponent, RouterTestingModule],
      providers: [{ provide: FastenApiService, useValue: mockApi }],
    }).compileComponents();
    fixture = TestBed.createComponent(AdminDatabaseComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads and shows database info', () => {
    expect(component).toBeTruthy();
    expect(component.info?.sources).toBe(4);
    expect(component.loading).toBeFalse();
  });

  it('formats sizes human-readably', () => {
    expect(component.humanSize(0)).toBe('0 B');
    expect(component.humanSize(1048576)).toBe('1.0 MB');
  });

  it('surfaces backup health from the API', () => {
    expect(component.info?.backup_health?.summary).toBe('Scheduled backups disabled');
    expect(component.info?.backup_health?.ok).toBeTrue();
  });

  // #713: an index built by an older version says so, and the operator can rebuild it here.
  it('shows a stale search index and offers the rebuild', () => {
    expect(component.searchIndex?.stale).toBeTrue();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Needs rebuilding');
    expect(text).toContain('Rebuild search index');
  });

  it('starts the rebuild only after the operator confirms', () => {
    spyOn(window, 'confirm').and.returnValues(false, true);
    component.rebuildSearchIndex();
    expect(mockApi.rebuildSearchIndex).not.toHaveBeenCalled();
    component.rebuildSearchIndex();
    expect(mockApi.rebuildSearchIndex).toHaveBeenCalled();
    component.ngOnDestroy();
  });

  // #856: the integrity row shows the background check's real result and when, not "Not checked".
  it('shows the integrity check result and when it ran', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Passed');
    expect(text).toContain('Runs again daily');
    expect(text).not.toContain('Not checked');
  });
});
