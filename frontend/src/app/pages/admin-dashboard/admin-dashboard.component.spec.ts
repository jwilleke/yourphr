import {ComponentFixture, TestBed} from '@angular/core/testing';
import {RouterTestingModule} from '@angular/router/testing';
import {of, throwError} from 'rxjs';

import {AdminDashboardComponent} from './admin-dashboard.component';
import {FastenApiService} from '../../services/fasten-api.service';
import {RelayConfig} from '../../models/fasten/relay-config';
import {InstanceSettings} from '../../models/fasten/instance-settings';

// A fully-configured relay: both URLs set explicitly, secret present.
const READY_RELAY: RelayConfig = {
  callback_url: 'https://relay.example.org/callback',
  configured: true,
  ready: true,
  public_url: {value: 'https://relay.example.org', source: 'configured', config_key: 'relay.public_url', env_var: 'YOURPHR_RELAY_PUBLIC_URL'},
  poll_url: {value: 'http://yourphr-relay.yourphr.svc:8080', source: 'configured', config_key: 'relay.url', env_var: 'YOURPHR_RELAY_URL'},
  secret: {value: '', source: 'configured', config_key: 'relay.secret', env_var: 'YOURPHR_RELAY_SECRET'},
};

// Nothing configured: everything fell back to the project default and no secret is set.
const DEFAULTED_RELAY: RelayConfig = {
  callback_url: 'https://relay.nerdsbythehour.com/callback',
  configured: false,
  ready: false,
  public_url: {value: 'https://relay.nerdsbythehour.com', source: 'default'},
  poll_url: {value: 'https://relay.nerdsbythehour.com', source: 'default'},
  secret: {value: '', source: 'unset', config_key: 'relay.secret', env_var: 'YOURPHR_RELAY_SECRET'},
};

const EMPTY_INSTANCE: InstanceSettings = {name: '', contact_email: '', contact_url: ''};
const SAMPLE_INSTANCE: InstanceSettings = {
  name: 'Hosted Ops',
  contact_email: 'ops@example.org',
  contact_url: 'https://example.org/help',
};

function setup(
  relay: any,
  opts: {
    relayFail?: boolean;
    instance?: InstanceSettings;
    instanceFail?: boolean;
    backupHealth?: {ok: boolean; summary: string; last_error?: string; schedule_enabled?: boolean; consecutive_failures?: number; failing_stale?: boolean};
    dbFail?: boolean;
  } = {},
): ComponentFixture<AdminDashboardComponent> {
  TestBed.resetTestingModule();
  const instance = opts.instance ?? EMPTY_INSTANCE;
  const health = opts.backupHealth ?? {
    ok: true,
    schedule_enabled: false,
    consecutive_failures: 0,
    failing_stale: false,
    summary: 'Scheduled backups disabled',
  };
  TestBed.configureTestingModule({
    imports: [AdminDashboardComponent, RouterTestingModule],
    providers: [{
      provide: FastenApiService,
      useValue: {
        getRelayConfig: () => opts.relayFail ? throwError(() => new Error('boom')) : of(relay),
        getInstanceSettings: () => opts.instanceFail ? throwError(() => new Error('boom')) : of(instance),
        setInstanceSettings: (s: InstanceSettings) => of(s),
        getDatabaseInfo: () => opts.dbFail
          ? throwError(() => new Error('boom'))
          : of({backup_health: health}),
        getAdminMetrics: () => of({
          scrape_enabled: false,
          scrape_path: '/metrics',
          scrape_note: 'test',
          process: {jobs_total: {}, resources_total: {}, duration_count: 0, duration_sum_seconds: 0},
          recent_jobs: [],
        }),
      },
    }],
  });
  const fixture = TestBed.createComponent(AdminDashboardComponent);
  fixture.detectChanges();
  // Second pass so *ngIf cards (Instance form after load) bind ngModel values into inputs.
  fixture.detectChanges();
  return fixture;
}

// Clicks the relay card header to toggle it. The card is collapsed by default, so any test that
// asserts on its CONTENT has to open it first.
function expandRelay(fixture: ComponentFixture<AdminDashboardComponent>): void {
  const header = fixture.nativeElement.querySelector('[aria-controls="relay-card-body"]');
  expect(header).withContext('relay card header should be present').not.toBeNull();
  header.click();
  fixture.detectChanges();
}

describe('AdminDashboardComponent', () => {
  it('should create', () => {
    expect(setup(READY_RELAY).componentInstance).toBeTruthy();
  });

  // Regression guard: the cards are routerLinks; without RouterModule they render as dead <a> with no
  // href (the bug Jim hit). Assert each admin card link resolves to a real href.
  it('renders working router links for every admin card', () => {
    const fixture = setup(READY_RELAY);
    const hrefs = Array.from(fixture.nativeElement.querySelectorAll('a[href]')).map((a: any) => a.getAttribute('href'));
    expect(hrefs).toContain('/sandbox');
    expect(hrefs).toContain('/admin/provider-catalog');
    expect(hrefs).toContain('/admin/logs');
    expect(hrefs).toContain('/admin/database');
  });

  it('shows backup health badge on the Database card', () => {
    const fixture = setup(READY_RELAY, {
      backupHealth: {
        ok: false,
        schedule_enabled: true,
        consecutive_failures: 3,
        failing_stale: true,
        summary: 'Scheduled backup failing',
        last_error: 'destination outside allowed roots',
      },
    });
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Scheduled backup failing');
    expect(fixture.componentInstance.backupHealth?.ok).toBeFalse();
  });

  it('shows the Instance card with loaded operator contact', () => {
    const fixture = setup(READY_RELAY, {instance: SAMPLE_INSTANCE});
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Instance');
    expect(text).toContain('Operator name');
    expect(fixture.componentInstance.instance.name).toBe('Hosted Ops');
    expect(fixture.componentInstance.instance.contact_email).toBe('ops@example.org');
    expect(fixture.nativeElement.querySelector('#operatorEmail')).withContext('email input').not.toBeNull();
  });

  it('saves instance settings from the card', () => {
    const fixture = setup(READY_RELAY, {instance: SAMPLE_INSTANCE});
    const api = TestBed.inject(FastenApiService) as any;
    spyOn(api, 'setInstanceSettings').and.returnValue(of({
      name: 'New Name',
      contact_email: 'new@example.org',
      contact_url: '',
    }));
    fixture.componentInstance.instance.name = 'New Name';
    fixture.componentInstance.instance.contact_email = 'new@example.org';
    fixture.componentInstance.instance.contact_url = '';
    fixture.componentInstance.saveInstance();
    // markForCheck(): the fields above and saveInstance()'s result are set straight on the
    // instance, outside change detection. Angular 22's detectChanges() no longer marks the fixture
    // dirty implicitly, so the first pass renders the old name and the verification pass reports
    // NG0100 (yourphr#482).
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(api.setInstanceSettings).toHaveBeenCalled();
    expect(fixture.componentInstance.instanceSaved).toBeTrue();
    expect(fixture.componentInstance.instance.name).toBe('New Name');
  });

  // #402: the callback URL is what the operator must register with each FHIR vendor, so it has to
  // be visible verbatim.
  it('shows the effective callback URL once expanded', () => {
    const fixture = setup(READY_RELAY);
    expandRelay(fixture);
    expect(fixture.nativeElement.textContent).toContain('https://relay.example.org/callback');
  });

  // The whole point of #402: a value that silently fell back must NOT look like a configured one.
  it('flags defaulted values as not using your configuration', () => {
    const fixture = setup(DEFAULTED_RELAY);
    expandRelay(fixture);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('built-in default');
    expect(text).toContain('NOT in use');
  });

  // The status badge must be readable WITHOUT expanding — collapsing must never hide the one
  // signal that tells you something is wrong.
  it('shows the Not ready badge while still collapsed', () => {
    const fixture = setup(DEFAULTED_RELAY);
    expect(fixture.componentInstance.relayExpanded).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('Not ready');
  });

  it('names the variable to set when no relay secret is configured', () => {
    const fixture = setup(DEFAULTED_RELAY);
    expandRelay(fixture);
    expect(fixture.nativeElement.textContent).toContain('YOURPHR_RELAY_SECRET');
  });

  it('collapses by default and toggles open and shut', () => {
    const fixture = setup(READY_RELAY);
    // Collapsed: the detail table is not in the DOM at all.
    expect(fixture.nativeElement.querySelector('#relay-card-body')).toBeNull();

    expandRelay(fixture);
    expect(fixture.nativeElement.querySelector('#relay-card-body')).not.toBeNull();

    expandRelay(fixture); // toggle shut again
    expect(fixture.nativeElement.querySelector('#relay-card-body')).toBeNull();
  });

  // The secret must never be rendered, even though the backend reports its presence.
  it('never renders a secret value, even when expanded', () => {
    const withSecret = {...READY_RELAY, secret: {...READY_RELAY.secret, value: 'super-secret-value'}};
    const fixture = setup(withSecret);
    expandRelay(fixture);
    expect(fixture.nativeElement.textContent).not.toContain('super-secret-value');
  });

  // A relay-config failure must not take the whole admin dashboard down with it.
  it('still renders the admin cards when the relay lookup fails', () => {
    const fixture = setup(null, {relayFail: true});
    expandRelay(fixture);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Could not load the relay configuration');
    const hrefs = Array.from(fixture.nativeElement.querySelectorAll('a[href]')).map((a: any) => a.getAttribute('href'));
    expect(hrefs).toContain('/admin/database');
  });
});
