import {ComponentFixture, TestBed} from '@angular/core/testing';
import {RouterTestingModule} from '@angular/router/testing';

import {AdminDashboardComponent} from './admin-dashboard.component';

describe('AdminDashboardComponent', () => {
  let component: AdminDashboardComponent;
  let fixture: ComponentFixture<AdminDashboardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminDashboardComponent, RouterTestingModule],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminDashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // Regression guard: the cards are routerLinks; without RouterModule they render as dead <a> with no
  // href (the bug Jim hit). Assert each admin card link resolves to a real href.
  it('renders working router links for every admin card', () => {
    const hrefs = Array.from(fixture.nativeElement.querySelectorAll('a[href]')).map((a: any) => a.getAttribute('href'));
    expect(hrefs).toContain('/sandbox');
    expect(hrefs).toContain('/admin/provider-catalog');
    expect(hrefs).toContain('/admin/logs');
  });
});
