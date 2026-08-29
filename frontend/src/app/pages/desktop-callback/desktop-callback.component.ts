import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import {ActivatedRoute} from '@angular/router';

@Component({
    selector: 'app-desktop-callback',
    templateUrl: './desktop-callback.component.html',
    styleUrls: ['./desktop-callback.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class DesktopCallbackComponent implements OnInit {

  //This component is used to redirect the user to the desktop app after they have authenticated with a source
  constructor(private activatedRoute : ActivatedRoute) { }

  ngOnInit(): void {
    this.activatedRoute.queryParams.subscribe(values => {
      // Guarded: `wails` is a global the desktop shell injects, and it does not exist in a browser.
      // Unguarded this throws ReferenceError for anyone who reaches /desktop-callback outside the
      // desktop app — including the test runner, where it surfaced as an error in afterAll and
      // tore down the whole browser session (yourphr#482).
      const shell = (globalThis as Record<string, any>)['wails'];
      if (!shell?.Events?.Emit) return;
      shell.Events.Emit({
        name: "wails:fasten-lighthouse:response",
        data: values,
      })
    })
  }
}
