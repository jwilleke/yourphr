import {Component, OnInit, TemplateRef, ChangeDetectionStrategy} from '@angular/core';
import {ToastService} from '../../services/toast.service';
import {AuthService} from '../../services/auth.service';
import {FastenApiService} from '../../services/fasten-api.service';
import {Subscription} from 'rxjs';
import {NavigationEnd, Router} from '@angular/router';

@Component({
    selector: 'app-toast',
    templateUrl: './toast.component.html',
    styleUrls: ['./toast.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class ToastComponent implements OnInit {

  constructor(
    public toastService: ToastService,
  ) {}

  ngOnInit(): void {

  }

}
