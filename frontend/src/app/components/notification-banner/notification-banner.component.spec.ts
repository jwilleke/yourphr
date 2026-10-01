import {ComponentFixture, TestBed, waitForAsync} from '@angular/core/testing';
import {Router, NavigationEnd} from '@angular/router';
import {of, Subject, throwError} from 'rxjs';
import {NotificationBannerComponent} from './notification-banner.component';
import {AuthService} from '../../services/auth.service';
import {FastenApiService} from '../../services/fasten-api.service';
import {AppNotification} from '../../models/fasten/app-notification';

describe('NotificationBannerComponent', () => {
  let fixture: ComponentFixture<NotificationBannerComponent>;
  let component: NotificationBannerComponent;
  let api: jasmine.SpyObj<FastenApiService>;
  let events: Subject<unknown>;

  const note = (over: Partial<AppNotification> = {}): AppNotification => ({
    id: 'notification_1', type: 'system', title: 'No backup in over 26 hours', message: 'The last one succeeded on 2026-09-27.',
    level: 'error', created_at: '2026-09-28T12:00:00Z', expires_at: null, ...over,
  });

  beforeEach(waitForAsync(() => {
    api = jasmine.createSpyObj('FastenApiService', ['getNotifications', 'dismissNotification']);
    api.getNotifications.and.returnValue(of([note(), note({id: 'notification_2', title: 'Heads up', message: '', level: 'info'})]));
    api.dismissNotification.and.returnValue(of(true));
    events = new Subject();
    TestBed.configureTestingModule({
      imports: [NotificationBannerComponent],
      providers: [{provide: FastenApiService, useValue: api}, {provide: Router, useValue: {events}}, {provide: AuthService, useValue: {IsAdmin: () => Promise.resolve(false)}}],
    }).compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(NotificationBannerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  const alerts = () => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.alert')) as HTMLElement[];

  it('shows each notification, an error as a danger alert with the role alert', () => {
    expect(alerts().length).toBe(2);
    expect(alerts()[0]!.textContent).toContain('No backup in over 26 hours');
    expect(alerts()[0]!.textContent).toContain('The last one succeeded on 2026-09-27.');
    expect(alerts()[0]!.classList).toContain('alert-danger');
    expect(alerts()[0]!.getAttribute('role')).toBe('alert');
    expect(alerts()[1]!.classList).toContain('alert-info');
    expect(alerts()[1]!.getAttribute('role')).toBe('status');
  });

  it('dismisses one for this person, through the server', () => {
    (alerts()[0]!.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(api.dismissNotification).toHaveBeenCalledWith('notification_1');
    expect(alerts().length).toBe(1);
  });

  it('shows nothing when the server cannot be asked (signed out, or away)', () => {
    api.getNotifications.and.returnValue(throwError(() => ({status: 401})));
    fixture = TestBed.createComponent(NotificationBannerComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="notification-banner"]')).toBeNull();
  });

  it('re-asks on navigation, but not more than once a minute', () => {
    expect(api.getNotifications).toHaveBeenCalledTimes(1);
    events.next(new NavigationEnd(1, '/a', '/a'));
    expect(api.getNotifications).toHaveBeenCalledTimes(1);
    (component as unknown as {lastFetch: number}).lastFetch = Date.now() - 61_000;
    events.next(new NavigationEnd(2, '/b', '/b'));
    expect(api.getNotifications).toHaveBeenCalledTimes(2);
  });
});
