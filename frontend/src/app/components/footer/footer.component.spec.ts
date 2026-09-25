import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { FooterComponent } from './footer.component';
import { FastenApiService } from '../../services/fasten-api.service';

describe('FooterComponent', () => {
  let component: FooterComponent;
  let fixture: ComponentFixture<FooterComponent>;

  let apiSpy: jasmine.SpyObj<FastenApiService>;

  beforeEach(waitForAsync(() => {
    apiSpy = jasmine.createSpyObj('FastenApiService', ['getVersion', 'getPublicInstanceInfo']);
    apiSpy.getVersion.and.returnValue(of({ version: '1.9.0', environment_name: '' }));
    apiSpy.getPublicInstanceInfo.and.returnValue(of({ name: '', contact_email: '', contact_url: '', demo_enabled: false, demo_admin_enabled: false, demo_admin_session: false, password_min_length: 8, password_max_length: 69, password_deny_common: true, password_deny_username: true, username_min_length: 3, signup_enabled: true, agent_token_enabled: false }));
    TestBed.configureTestingModule({
      declarations: [ FooterComponent ],
      providers: [ { provide: FastenApiService, useValue: apiSpy } ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(FooterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('uses runtime environment_name from /api/version when set', () => {
    apiSpy.getVersion.and.returnValue(of({ version: '1.18.2', environment_name: 'demo' }));
    component.ngOnInit();
    expect(component.appVersion).toBe('demo-1.18.2');
  });

  // yourphr#673: the old behaviour here was to fall back to the name compiled into the bundle,
  // and then to the literal 'prod'. Both are guesses about an instance the bundle knows nothing
  // about — one image serves every instance — and the first of them put "sandbox-3.1.0" on a
  // production PHR. An unnamed instance shows its version and nothing else.
  it('shows the version alone when the instance has not named itself — never a guessed label', () => {
    apiSpy.getVersion.and.returnValue(of({ version: '1.18.2', environment_name: '' }));
    component.ngOnInit();
    expect(component.appVersion).toBe('1.18.2');
  });

  it('never reports a name the backend did not give it', () => {
    apiSpy.getVersion.and.returnValue(of({ version: '1.18.2', environment_name: '' }));
    component.ngOnInit();
    expect(component.appVersion).not.toContain('sandbox');
    expect(component.appVersion).not.toContain('prod');
  });

  it('links to the Contact Us page', () => {
    fixture.detectChanges();
    const link = fixture.nativeElement.querySelector('a[routerLink="/contact"]');
    expect(link).not.toBeNull();
    expect(link.textContent.trim()).toBe('Contact Us');
  });

  // The footer no longer renders operator details inline (#454) — they live on /contact, which is
  // three fields and needs room. A regression here would put an address back in the chrome.
  it('does not render operator contact details inline', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Operated by');
    expect(fixture.nativeElement.querySelector('a[href^="mailto:"]')).toBeNull();
  });
});
