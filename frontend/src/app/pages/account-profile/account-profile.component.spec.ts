import {ComponentFixture, TestBed} from '@angular/core/testing';
import {CommonModule} from '@angular/common';
import {of} from 'rxjs';
import {RouterTestingModule} from '@angular/router/testing';

import {AccountProfileComponent} from './account-profile.component';
import {FastenApiService} from '../../services/fasten-api.service';
import {ReportHeaderComponent} from 'src/app/components/report-header/report-header.component';

describe('AccountProfileComponent', () => {
  let component: AccountProfileComponent;
  let fixture: ComponentFixture<AccountProfileComponent>;
  let api: jasmine.SpyObj<FastenApiService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj('FastenApiService', ['getCurrentUser', 'deleteAccount', 'getSummary', 'getResources']);
    api.getCurrentUser.and.returnValue(of({username: 'jim', full_name: 'Jim Willeke', email: 'jim@example.com', role: 'admin'}));
    api.deleteAccount.and.returnValue(of(true));
    // ReportHeaderComponent (rendered via <report-header>) calls these on init.
    api.getSummary.and.returnValue(of({sources: []} as any));
    api.getResources.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      declarations: [AccountProfileComponent, ReportHeaderComponent],
      imports: [CommonModule, RouterTestingModule],
      providers: [{provide: FastenApiService, useValue: api}],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountProfileComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates and loads the current user', () => {
    expect(component).toBeTruthy();
    expect(api.getCurrentUser).toHaveBeenCalled();
    expect(component.user.username).toBe('jim');
    expect(component.loading.page).toBeFalse();
  });

  it('computes initials from the full name', () => {
    expect(component.initials).toBe('JW');
  });

  it('falls back to the first two letters when there is only one name part', () => {
    component.user = {username: 'jim'};
    expect(component.initials).toBe('JI');
  });

  it('delegates account deletion to the API', () => {
    component.deleteAccount();
    expect(api.deleteAccount).toHaveBeenCalled();
  });
});
