import {Component, OnDestroy, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {ActivatedRoute, NavigationStart, Router} from '@angular/router';
import {AuthService} from '../../services/auth.service';
import {UserRegisteredClaims} from '../../models/fasten/user-registered-claims';
import {FastenApiService} from '../../services/fasten-api.service';
import {BackgroundJob} from '../../models/fasten/background-job';
import {NgbModal} from '@ng-bootstrap/ng-bootstrap';
import {SupportRequest} from '../../models/fasten/support-request';
import {environment} from '../../../environments/environment';
import {versionInfo} from '../../../environments/versions';
import {Subscription} from 'rxjs';
import {ToastNotification, ToastType} from '../../models/fasten/toast';
import {ThemeService} from '../../theme.service';

@Component({
    selector: 'app-header',
    templateUrl: './header.component.html',
    styleUrls: ['./header.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class HeaderComponent implements OnInit, OnDestroy {
  // default to an empty object so the template renders before the async /me resolves (#103 Phase 2a)
  current_user_claims: UserRegisteredClaims = new UserRegisteredClaims()
  backgroundJobs: BackgroundJob[] = []

  // Initials of the current login, shown as the profile avatar.
  get userInitials(): string {
    const name = (this.current_user_claims.full_name || '').trim()
    if (name) {
      const parts = name.split(/\s+/).filter(Boolean)
      const initials = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)
      return initials.toUpperCase()
    }
    const fallback = (this.current_user_claims.sub || this.current_user_claims.email || '?').trim()
    return fallback.slice(0, 2).toUpperCase()
  }

  newSupportRequest: SupportRequest = null
  loading = false
  errorMsg = ""
  submitSuccess = false

  routerSubscription: Subscription = null
  isDarkModeSubscription: Subscription = null

  is_environment_desktop: boolean = environment.environment_desktop

  isAdmin = false;

  // True only for the public demo's read-only admin (#516). Drives the banner below the header.
  isReadOnlyDemoAdmin = false;
  isDarkMode = false;

  constructor(
    private authService: AuthService,
    private router: Router,
    private fastenApi: FastenApiService,
    private modalService: NgbModal,
    private themeService: ThemeService) {
    }

  ngOnInit() {
    // current-user + admin now resolve from the server (#103 Phase 2a); handle async.
    this.authService.GetCurrentUser()
      .then((claims) => this.current_user_claims = claims)
      .catch(() => this.current_user_claims = new UserRegisteredClaims())

    this.authService.IsAdmin().then((isAdmin) => this.isAdmin = isAdmin);

    // Say on every screen that this session cannot change anything (#516), rather than letting a
    // visitor find out by pressing Save and reading a 403. Presentation only — the API enforces it.
    this.fastenApi.getInstanceInfo().subscribe({
      next: (info) => this.isReadOnlyDemoAdmin = info?.demo_admin_session === true,
      error: () => this.isReadOnlyDemoAdmin = false,
    })

    this.fastenApi.getBackgroundJobs().subscribe((data) => {
      this.backgroundJobs = data.filter((job) => {
        return job.data?.checkpoint_data?.summary?.UpdatedResources?.length > 0
      })
    })

    this.resetSupportRequestForm()
    this.routerSubscription = this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.newSupportRequest.current_page = event.url.toString()
      }
    })

    this.isDarkModeSubscription = this.themeService.isDarkMode$.subscribe(darkMode => {
      this.isDarkMode = darkMode;
    });
  }

  ngOnDestroy() {
    if(this.routerSubscription){
      this.routerSubscription.unsubscribe()
    }
    if (this.isDarkModeSubscription) {
      this.isDarkModeSubscription.unsubscribe();
    }
  }

  closeMenu(e) {
    e.target.closest('.dropdown').classList.remove('show');
    e.target.closest('.dropdown .dropdown-menu').classList.remove('show');
  }

  toggleHeaderMenu(event) {
    event.preventDefault();
    document.querySelector('body').classList.toggle('az-header-menu-show');
  }
  
  toggleTheme() {
    this.themeService.setDarkMode(!this.isDarkMode);
  }

  signOut(e) {
    this.authService.Logout()
      .then(() => this.router.navigate(['auth/signin']))
  }

  //support Form

  openSupportForm(content) {
    this.modalService.open(content, { size: 'lg' });
  }

  resetSupportRequestForm() {
    this.submitSuccess = false
    const newSupportRequest = new SupportRequest()
    newSupportRequest.dist_type = environment.environment_desktop ? 'desktop' : 'docker'
    newSupportRequest.flavor = environment.environment_name
    newSupportRequest.version = versionInfo.version
    newSupportRequest.current_page = this.router.url.toString()

    this.newSupportRequest = newSupportRequest
  }
  submitSupportForm() {
    this.loading = false

    this.fastenApi.supportRequest(this.newSupportRequest).subscribe((resp: any) => {
        this.loading = false
        this.submitSuccess = true
      },
      (err)=>{
        this.loading = false
        console.error("an error occurred during support request submission",err)
        this.errorMsg = err || "An error occurred while submitting your support request. Please try again later."
      })
  }
}