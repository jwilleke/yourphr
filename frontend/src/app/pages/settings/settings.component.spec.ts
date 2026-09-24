import {ComponentFixture, TestBed, waitForAsync} from '@angular/core/testing';
import {FormsModule} from '@angular/forms';
import {of, throwError} from 'rxjs';

import {SettingsComponent} from './settings.component';
import {AgentTokenPage, FastenApiService} from '../../services/fasten-api.service';

/**
 * The page had no spec at all, which is how four unrouted endpoints survived a whole stack
 * replacement (#719). These are about what the person is told, not about the HTTP.
 */
describe('SettingsComponent', () => {
  let component: SettingsComponent;
  let fixture: ComponentFixture<SettingsComponent>;
  let api: jasmine.SpyObj<FastenApiService>;

  const page: AgentTokenPage = {
    tokens: [
      {
        id: 't-1', name: 'My AI assistant', prefix: 'yphr_ab', scopes: ['Medications', 'Conditions'],
        createdAt: '2026-09-24T10:00:00Z', expiresAt: '2026-09-25T10:00:00Z', lastUsedAt: '', revokedAt: '',
        expiresInSeconds: 86_400, live: true,
      },
    ],
    available_scopes: ['Summary', 'Medications', 'Conditions', 'Allergies'],
    max_ttl_hours: 24, default_ttl_hours: 24, max_per_user: 2,
    renewable: true, renew_window_hours: 4, read_only: true,
  };

  const instance = (agentTokens: boolean) => of({
    name: '', contact_email: '', contact_url: '', theme: '',
    demo_enabled: false, demo_admin_enabled: false, demo_admin_session: false,
    password_min_length: 8, password_max_length: 69, password_deny_common: true, password_deny_username: true,
    username_min_length: 3, signup_enabled: true, agent_token_enabled: agentTokens,
  });

  beforeEach(waitForAsync(() => {
    api = jasmine.createSpyObj('FastenApiService', [
      'getCurrentUser', 'getPublicInstanceInfo', 'getAgentTokens', 'mintAgentToken', 'revokeAgentToken', 'renewAgentToken',
    ]);
    api.getCurrentUser.and.returnValue(of({username: 'jane', role: 'user'} as never));
    api.getPublicInstanceInfo.and.returnValue(instance(true));
    api.getAgentTokens.and.returnValue(of(page));
    api.mintAgentToken.and.returnValue(of({token: 'yphr_secret_value', record: page.tokens[0]!}));
    api.revokeAgentToken.and.returnValue(of({revoked: true}));
    api.renewAgentToken.and.returnValue(of({token: 'yphr_rotated_value', record: page.tokens[0]!}));

    TestBed.configureTestingModule({
      declarations: [SettingsComponent],
      imports: [FormsModule],
      providers: [{provide: FastenApiService, useValue: api}],
    }).compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(SettingsComponent);
    component = fixture.componentInstance;
  });

  /**
   * Buttons are pressed through the DOM, as a person does — inside Angular's event handling.
   * Calling the method directly mutates state mid-check and throws
   * ExpressionChangedAfterItHasBeenCheckedError, which says more about the test than the page.
   */
  /** Types into a field the way a person does, so ngModel and the template agree on when it changed. */
  const type = (selector: string, value: string): void => {
    const input = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  /** Ticks a scope checkbox through the DOM. */
  const tick = (scope: string): void => {
    (fixture.nativeElement.querySelector(`#scope-${scope}`) as HTMLInputElement).click();
    fixture.detectChanges();
  };

  const press = (label: string): void => {
    const button = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent!.includes(label));
    if (!button) {
      throw new Error(`no button saying "${label}"`);
    }
    button.click();
    fixture.detectChanges();
  };

  it('lists the keys with what each may read and when it stops', () => {
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('My AI assistant');
    expect(text).toContain('Medications, Conditions');
    expect(text).toContain('in 24 hours'); // from the seconds the SERVER computed, not a local clock
  });

  // The defect #695 was filed against, and it was still in the shipped template: a "No Expiration"
  // option that resolved to the year 2099.
  it('offers no never-expires option, and nothing beyond the instance ceiling', () => {
    fixture.detectChanges();
    const options = Array.from(fixture.nativeElement.querySelectorAll('#token-ttl option') as NodeListOf<HTMLOptionElement>);
    expect(options.length).toBeGreaterThan(0);
    expect(options.map((o) => o.textContent!.trim()).join(' ')).not.toMatch(/no expiration|never/i);
  });

  it('will not mint without a name and at least one thing to read', () => {
    fixture.detectChanges();
    expect(component.canMint).toBe(false);

    component.newName = 'My AI assistant';
    // A name alone is not enough: empty scopes is not "everything", it is nothing.
    expect(component.canMint).toBe(false);

    component.toggleScope('Medications');
    expect(component.canMint).toBe(true);
  });

  it('shows the secret once and says so, because nothing can show it again', () => {
    fixture.detectChanges();
    type('#token-name', 'My AI assistant');
    tick('Medications');
    press('Make this key');

    expect(api.mintAgentToken).toHaveBeenCalledWith('My AI assistant', ['Medications'], 24);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('yphr_secret_value');
    expect(text).toContain('shown once');

    press('I have copied it');
    expect(fixture.nativeElement.textContent).not.toContain('yphr_secret_value');
  });

  it('renewing shows the new secret too, because renewing rotates rather than extends', () => {
    fixture.detectChanges();
    press('Renew');
    expect(api.renewAgentToken).toHaveBeenCalledWith('t-1');
    expect(fixture.nativeElement.textContent).toContain('yphr_rotated_value');
  });

  it('revokes, then re-reads rather than guessing what the list now says', () => {
    fixture.detectChanges();
    press('Revoke');
    expect(api.revokeAgentToken).toHaveBeenCalledWith('t-1');
    expect(api.getAgentTokens).toHaveBeenCalledTimes(2);
  });

  it('says when the person already holds as many keys as the instance allows', () => {
    api.getAgentTokens.and.returnValue(of({...page, max_per_user: 1}));
    fixture.detectChanges();
    expect(component.atLimit).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('which is all this instance allows');
  });

  it('hides the whole section on an instance that does not offer keys, rather than offering a refusal', () => {
    api.getPublicInstanceInfo.and.returnValue(instance(false));
    fixture.detectChanges();
    expect(api.getAgentTokens).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('does not offer keys');
    expect(fixture.nativeElement.textContent).not.toContain('Make a key');
  });

  it('says why when the server refuses, and keeps the form', () => {
    fixture.detectChanges();
    api.mintAgentToken.and.returnValue(throwError(() => ({error: {error: 'choose at least one thing this agent may read'}})));
    type('#token-name', 'My AI assistant');
    tick('Medications');
    press('Make this key');
    expect(fixture.nativeElement.textContent).toContain('choose at least one thing this agent may read');
  });
});
