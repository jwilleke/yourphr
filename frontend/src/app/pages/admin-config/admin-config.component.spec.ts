import {ComponentFixture, TestBed, waitForAsync} from '@angular/core/testing';
import {RouterTestingModule} from '@angular/router/testing';
import {of, throwError} from 'rxjs';

import {AdminConfigComponent} from './admin-config.component';
import {FastenApiService} from '../../services/fasten-api.service';
import {AdminConfig, ConfigEntry} from '../../models/fasten/admin-config';

describe('AdminConfigComponent', () => {
  let component: AdminConfigComponent;
  let fixture: ComponentFixture<AdminConfigComponent>;
  let apiSpy: jasmine.SpyObj<FastenApiService>;

  const entry = (over: Partial<ConfigEntry>): ConfigEntry => ({
    key: 'operator.name',
    value: 'YourPHR',
    masked: false,
    source: 'default',
    public: true,
    promoted: false,
    default: '',
    from_env: false,
    env_var: 'YOURPHR_OPERATOR_NAME',
    ...over,
  });

  const config = (over: Partial<AdminConfig> = {}): AdminConfig => ({
    entries: [
      entry({}),
      entry({key: 'jwt.issuer.key', value: '••••••••', masked: true, public: false, default: '••••••••'}),
      entry({key: 'metrics.port', value: 9091, masked: true, public: false, default: 9091}),
    ],
    custom_config_path: '/opt/yourphr/data/config/app-custom-config.json',
    warnings: [],
    ...over,
  });

  beforeEach(waitForAsync(() => {
    apiSpy = jasmine.createSpyObj('FastenApiService', [
      'getAdminConfig', 'revealAdminConfigValue', 'setAdminConfigValue', 'resetAdminConfigValue',
    ]);
    apiSpy.getAdminConfig.and.returnValue(of(config()));
    apiSpy.revealAdminConfigValue.and.returnValue(of({key: 'jwt.issuer.key', value: 'real-secret', default: ''}));
    apiSpy.setAdminConfigValue.and.returnValue(of(true));
    apiSpy.resetAdminConfigValue.and.returnValue(of(true));

    TestBed.configureTestingModule({
      imports: [AdminConfigComponent, RouterTestingModule],
      providers: [{provide: FastenApiService, useValue: apiSpy}],
    }).compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(AdminConfigComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('lists every setting with its source', () => {
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('operator.name');
    expect(text).toContain('jwt.issuer.key');
    expect(text).toContain('/opt/yourphr/data/config/app-custom-config.json');
  });

  // #921/#624: a key the server reads only at startup says so, and the page no longer promises
  // that every change applies without a restart.
  it('marks settings that take effect only after a restart, and nothing else', () => {
    apiSpy.getAdminConfig.and.returnValue(of(config({entries: [
      entry({}),
      entry({key: 'yourphr.auth.password.min-length', value: 12, default: 12, public: false}),
    ]})));
    fixture.detectChanges();
    const rows = Array.from(fixture.nativeElement.querySelectorAll('tbody tr')) as HTMLElement[];
    const row = (key: string) => rows.find((r) => r.textContent?.includes(key))?.textContent ?? '';
    expect(row('yourphr.auth.password.min-length')).toContain('after a restart');
    expect(row('operator.name')).not.toContain('after a restart');
    expect(fixture.nativeElement.textContent).not.toContain('no restart');
  });

  // A read-only admin (the demo tour) is refused the snapshot by design (#751): the page explains
  // that, rather than reporting a failure.
  it('explains a 403 instead of showing it as an error', () => {
    apiSpy.getAdminConfig.and.returnValue(throwError(() => ({status: 403, error: {success: false, error: 'forbidden'}})));
    fixture.detectChanges();
    expect(component.restricted).toBeTrue();
    expect(component.error).toBe('');
    expect(fixture.nativeElement.querySelector('.alert-danger')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('needs full administrator access');
  });

  it('still reports a real failure as an error', () => {
    apiSpy.getAdminConfig.and.returnValue(throwError(() => ({status: 500, error: {success: false, error: 'boom'}})));
    fixture.detectChanges();
    expect(component.restricted).toBeFalse();
    expect(component.error).toBe('boom');
  });

  // The masked placeholder is what the server sent — the real value is not in the page until the
  // eye is clicked, which is the whole point of reveal-on-demand.
  it('does not have the real value before revealing', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('real-secret');
    expect(apiSpy.revealAdminConfigValue).not.toHaveBeenCalled();
  });

  it('fetches one key when revealing, and hides it again on a second click', () => {
    fixture.detectChanges();
    const masked = component.entries.find((e) => e.key === 'jwt.issuer.key');

    component.reveal(masked);
    expect(apiSpy.revealAdminConfigValue).toHaveBeenCalledWith('jwt.issuer.key');
    expect(component.isRevealed(masked)).toBeTrue();
    expect(component.displayValue(masked)).toBe('real-secret');

    component.reveal(masked);
    expect(component.isRevealed(masked)).toBeFalse();
  });

  // Seeding the edit field with "••••••••" and saving would overwrite a real secret with the mask.
  it('starts an unrevealed masked field blank rather than with the placeholder', () => {
    fixture.detectChanges();
    const masked = component.entries.find((e) => e.key === 'jwt.issuer.key');

    component.startEdit(masked);
    expect(component.editingValue).toBe('');
    expect(component.editingValue).not.toBe('••••••••');
  });

  it('edits against the real value once revealed', () => {
    fixture.detectChanges();
    const masked = component.entries.find((e) => e.key === 'jwt.issuer.key');

    component.reveal(masked);
    component.startEdit(masked);
    expect(component.editingValue).toBe('real-secret');
  });

  it('sends numbers as numbers, not strings', () => {
    fixture.detectChanges();
    const port = component.entries.find((e) => e.key === 'metrics.port');

    component.startEdit(port);
    component.editingValue = '9999';
    component.save(port);

    expect(apiSpy.setAdminConfigValue).toHaveBeenCalledWith('metrics.port', 9999);
  });

  it('surfaces a server rejection instead of failing silently', () => {
    fixture.detectChanges();
    apiSpy.setAdminConfigValue.and.returnValue(
      throwError(() => ({error: {error: 'metrics.port: expected a number'}})));

    const port = component.entries.find((e) => e.key === 'metrics.port');
    component.startEdit(port);
    component.save(port);

    expect(component.error).toBe('metrics.port: expected a number');
  });

  it('resets an override back to the shipped default', () => {
    fixture.detectChanges();
    component.reset(entry({key: 'log.level', source: 'custom'}));
    expect(apiSpy.resetAdminConfigValue).toHaveBeenCalledWith('log.level');
  });

  it('filters by key', () => {
    fixture.detectChanges();
    component.filter = 'jwt';
    expect(component.entries.length).toBe(1);
    expect(component.entries[0].key).toBe('jwt.issuer.key');
  });

  it('shows only overrides on the custom tab', () => {
    apiSpy.getAdminConfig.and.returnValue(of(config({
      entries: [entry({}), entry({key: 'log.level', source: 'custom', value: 'DEBUG'})],
    })));
    component.load();

    component.activeTab = 'custom';
    expect(component.entries.length).toBe(1);
    expect(component.entries[0].key).toBe('log.level');
    expect(component.customCount).toBe(1);
  });

  // Widening the public array is allowed, so this banner is the only place an operator is likely
  // to notice it — the startup log line is read approximately never.
  it('shows a warning when a key is published beyond the shipped set', () => {
    apiSpy.getAdminConfig.and.returnValue(of(config({
      warnings: ['"relay.secret" is served to callers with NO login'],
    })));
    component.load();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Published without a login');
    expect(fixture.nativeElement.textContent).toContain('relay.secret');
  });

  it('reports a failed load rather than showing an empty table', () => {
    apiSpy.getAdminConfig.and.returnValue(throwError(() => ({error: {error: 'nope'}})));
    component.load();
    fixture.detectChanges();

    expect(component.loading).toBeFalse();
    expect(component.error).toBe('nope');
  });

  // Env outranks the config store on restart, so an edit here would take effect and then quietly
  // revert. The row says where to change it instead of offering a button that lies.
  it('offers no Edit for a key governed by the environment', () => {
    apiSpy.getAdminConfig.and.returnValue(of(config({
      entries: [entry({key: 'log.level', from_env: true, env_var: 'YOURPHR_LOG_LEVEL', source: 'environment'})],
    })));
    component.load();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('set by environment');
    expect(text).toContain('environment');
    expect(fixture.nativeElement.textContent).not.toContain('Edit');
  });
});
