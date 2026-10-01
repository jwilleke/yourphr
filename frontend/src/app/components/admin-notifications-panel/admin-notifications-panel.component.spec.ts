import {ComponentFixture, TestBed} from '@angular/core/testing';
import {RouterTestingModule} from '@angular/router/testing';
import {of} from 'rxjs';
import {AdminNotificationsPanelComponent} from './admin-notifications-panel.component';
import {FastenApiService} from '../../services/fasten-api.service';
import {AppNotification} from '../../models/fasten/app-notification';

const STALE: AppNotification = {id: 'n2', type: 'system', title: 'Search index out of date — rebuild needed', message: 'Records stored before the upgrade are not found by name.', level: 'warning', created_at: '2026-10-01T12:00:00Z', expires_at: null, link: '/admin/database'};
const OLDER: AppNotification = {id: 'n1', type: 'maintenance', title: 'Maintenance Mode Disabled', message: 'Back to normal.', level: 'success', created_at: '2026-09-30T12:00:00Z', expires_at: null};

// #854: the admin home says what needs the operator, first, and links straight to where it is fixed.
describe('AdminNotificationsPanelComponent', () => {
  let fixture: ComponentFixture<AdminNotificationsPanelComponent>;
  let api: jasmine.SpyObj<FastenApiService>;

  function setup(list: AppNotification[]): HTMLElement {
    api = jasmine.createSpyObj('FastenApiService', ['getNotifications', 'dismissNotification', 'dismissAllNotifications']);
    api.getNotifications.and.returnValue(of(list));
    api.dismissNotification.and.returnValue(of(true));
    api.dismissAllNotifications.and.returnValue(of(list.length));
    TestBed.configureTestingModule({imports: [AdminNotificationsPanelComponent, RouterTestingModule], providers: [{provide: FastenApiService, useValue: api}]});
    fixture = TestBed.createComponent(AdminNotificationsPanelComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('lists every notification newest first, with a link to where it is dealt with', () => {
    const el = setup([OLDER, STALE]);
    const titles = Array.from(el.querySelectorAll('strong')).map((s) => s.textContent);
    expect(titles).toEqual([STALE.title, OLDER.title]);
    const link = el.querySelector('a[href="/admin/database"]');
    expect(link?.textContent).toContain('Go to Admin → Database');
    expect(el.querySelectorAll('a.btn').length).toBe(1); // the one without a link has no button
  });

  it('says so when nothing needs attention', () => {
    expect(setup([]).textContent).toContain('Nothing needs your attention.');
  });

  it('dismisses one, and all only after confirming', () => {
    setup([OLDER, STALE]);
    fixture.componentInstance.dismiss(STALE);
    expect(api.dismissNotification).toHaveBeenCalledWith('n2');
    spyOn(window, 'confirm').and.returnValues(false, true);
    fixture.componentInstance.dismissAll();
    expect(api.dismissAllNotifications).not.toHaveBeenCalled();
    fixture.componentInstance.dismissAll();
    expect(api.dismissAllNotifications).toHaveBeenCalled();
    expect(fixture.componentInstance.notifications.length).toBe(0);
  });
});
