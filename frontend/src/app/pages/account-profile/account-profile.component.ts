import {Component, OnInit, TemplateRef} from '@angular/core';
import {NgbModal} from '@ng-bootstrap/ng-bootstrap';
import {FastenApiService} from '../../services/fasten-api.service';
import {AccountUser} from '../../models/fasten/account-user';

// Account Profile — the system *user account* (login/identity/lifecycle), distinct from the medical
// "Patient Profile" (the FHIR Patient record). Phase 1: identity (read-only), a link to Connected
// Devices, and Delete Account (moved here off Patient Profile). Change-password (#274 Phase 2) and
// photo/profile-edit (Phase 3) follow once their backend endpoints exist.
@Component({
  selector: 'app-account-profile',
  templateUrl: './account-profile.component.html',
  styleUrls: ['./account-profile.component.scss'],
  standalone: false,
})
export class AccountProfileComponent implements OnInit {
  loading = {page: false, delete: false};
  user: AccountUser = {};

  constructor(
    private fastenApi: FastenApiService,
    private modalService: NgbModal,
  ) {}

  ngOnInit(): void {
    this.loading.page = true;
    this.fastenApi.getCurrentUser().subscribe({
      next: (u) => {
        this.user = u || {};
        this.loading.page = false;
      },
      error: () => {
        this.loading.page = false;
      },
    });
  }

  // Initials avatar fallback (no uploaded photo yet — Phase 3).
  get initials(): string {
    const src = (this.user.full_name || this.user.username || '').trim();
    const parts = src.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  openDeleteModal(content: TemplateRef<any>): void {
    this.modalService.open(content, {ariaLabelledBy: 'delete-account-title'});
  }

  deleteAccount(): void {
    this.loading.delete = true;
    this.fastenApi.deleteAccount().subscribe({
      next: () => {
        this.loading.delete = false;
      },
      error: () => {
        this.loading.delete = false;
      },
    });
  }
}
