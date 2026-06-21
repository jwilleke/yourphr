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
    mockApi = jasmine.createSpyObj('FastenApiService', ['getDatabaseInfo', 'backupDatabase']);
    mockApi.getDatabaseInfo.and.returnValue(of({
      location: '/opt/fasten/db/fasten.db', encryption_enabled: false, size_bytes: 1048576, users: 2, sources: 4, integrity_ok: true, backup_destination: '/opt/fasten/db/backups', backups: [], backup_interval_hours: 0, backup_retention: 7,
    }));
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
});
