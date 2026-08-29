import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import {User} from '../../models/fasten/user';
import {Router} from '@angular/router';
import {ToastNotification, ToastType} from '../../models/fasten/toast';
import {ToastService} from '../../services/toast.service';
import {AuthService} from '../../services/auth.service';
import {FastenApiService} from '../../services/fasten-api.service';
import {DEFAULT_PASSWORD_POLICY, PasswordPolicy} from '../../models/fasten/password-policy';

@Component({
    selector: 'app-auth-signup',
    templateUrl: './auth-signup.component.html',
    styleUrls: ['./auth-signup.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class AuthSignupComponent implements OnInit {
  loading = false

  submitted = false
  newUser: User = new User()
  errorMsg = ""

  // Read from the instance rather than hardcoded (#506), so this form validates exactly what the
  // server enforces. Starts at the shipped defaults so the form is usable before the request lands.
  policy: PasswordPolicy = {...DEFAULT_PASSWORD_POLICY}

  constructor(
    private authService: AuthService,
    private router: Router,
    private toastService: ToastService,
    private fastenApi: FastenApiService
  ) { }

  ngOnInit(): void {
    // On error keep the shipped defaults: a form that cannot reach the instance should still be
    // usable, and the server is the real check either way.
    this.fastenApi.getPublicInstanceInfo().subscribe({
      next: (info) => this.policy = {
        password_min_length: info?.password_min_length ?? DEFAULT_PASSWORD_POLICY.password_min_length,
        password_max_length: info?.password_max_length ?? DEFAULT_PASSWORD_POLICY.password_max_length,
        password_deny_common: info?.password_deny_common !== false,
        password_deny_username: info?.password_deny_username !== false,
        username_min_length: info?.username_min_length ?? DEFAULT_PASSWORD_POLICY.username_min_length,
      },
      error: () => this.policy = {...DEFAULT_PASSWORD_POLICY},
    })
  }

  signupSubmit(){
    this.loading = true
    this.submitted = true;

    this.authService.Signup(this.newUser).then((tokenResp: any) => {
        this.loading = false
        this.router.navigateByUrl('/dashboard');
      },
      (err)=>{
        this.loading = false
        console.error("an error occured while signup",err)
        if(err.name === 'conflict') {
          // "batman" already exists, choose another username
          this.errorMsg = "username already exists"
        } else if (err.name === 'forbidden') {
          // invalid username
          this.errorMsg = "invalid username"
        } else if (err.status === 400 && err.error?.error) {
          // The server rejected the INPUT and said why — a reserved username, most often, because
          // `admin` is the first thing anyone tries. Showing its sentence beats "unknown error",
          // which is what this used to say for the one case that has a clear explanation.
          this.errorMsg = err.error.error
        } else {
          this.errorMsg = "an unknown error occurred during sign-up"
        }

        const toastNotificaiton = new ToastNotification()
        toastNotificaiton.type = ToastType.Error
        toastNotificaiton.message = this.errorMsg
        this.toastService.show(toastNotificaiton)
    })
  }

}
