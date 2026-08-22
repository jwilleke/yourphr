import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { GetEndpointAbsolutePath } from '../../lib/utils/endpoint_absolute_path';

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  private settings: any = null;

  constructor(private http: HttpClient) {}

  public load() {
    const settingsEndpoint = `${GetEndpointAbsolutePath(globalThis.location, environment.fasten_api_endpoint_base)}/settings`;
    return this.http.get(settingsEndpoint)
      .toPromise()
      .then(settings => {
        this.settings = settings;
      })
      .catch(err => {
        // This runs inside an APP_INITIALIZER (app.module.ts). An unhandled rejection here blocks
        // Angular bootstrap entirely — the app never renders anything, not even the router — which
        // is exactly what happens on a fresh install: the backend is in standby mode (no
        // encryption key yet) and doesn't register GET /settings at all, so every first boot 404s
        // here and the user sees a permanently blank page instead of the setup wizard. Swallowing
        // the error and defaulting to {} lets bootstrap continue; EncryptionStatusGuard is what
        // actually detects standby mode (via /health) and redirects to the wizard.
        console.error('Failed to load settings, continuing with defaults:', err);
        this.settings = {};
      });
  }

  public get(key: string): any {
    return this.settings ? this.settings[key] : null;
  }
}
