import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { SettingsService } from '../services/settings.service';

@Injectable({
  providedIn: 'root'
})
export class ChatFeatureGuard implements CanActivate {

  constructor(
    private settingsService: SettingsService,
    private router: Router
  ) {}

  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {

    // search.chat.* keys always exist with defaults, so the section itself is never falsy —
    // chat needs search enabled AND a conversation collection actually configured.
    const search = this.settingsService.get('search');
    const chatEnabled = !!search?.enabled && !!search?.chat?.conversation_collection_name;

    if (chatEnabled) {
      return true;
    } else {
      // Redirect to a default page if the feature is disabled
      return this.router.parseUrl('/dashboard');
    }
  }
}
