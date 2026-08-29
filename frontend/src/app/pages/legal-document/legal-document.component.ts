import {Component, OnDestroy, OnInit, ChangeDetectionStrategy} from '@angular/core';

import {ActivatedRoute, RouterModule} from '@angular/router';
import {Subscription} from 'rxjs';
import {FastenApiService} from '../../services/fasten-api.service';
import {LegalDocument} from '../../models/fasten/legal-document';

// Privacy Policy / Terms of Service, served by THIS instance (#463).
//
// Not a link to yourphr.org: an offline instance must still show its own policy, and the
// operator — who is the data controller — may have published their own text. The page says which
// it is, because "whose policy is this" is a fair question to be able to answer.
//
// Unauthenticated by design. Someone deciding whether to sign up reads the terms first, and the
// sign-in page links here.
@Component({
  standalone: true,
  imports: [RouterModule],
  selector: 'app-legal-document',
  templateUrl: './legal-document.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./legal-document.component.scss'],
})
export class LegalDocumentComponent implements OnInit, OnDestroy {
  document: LegalDocument | null = null;
  loading = true;
  error = '';

  private sub?: Subscription;

  constructor(private route: ActivatedRoute, private fastenApi: FastenApiService) {}

  ngOnInit() {
    // Subscribe to the param rather than reading it once: /privacy and /terms use the same
    // component, so navigating between them reuses the instance without re-running ngOnInit.
    this.sub = this.route.data.subscribe((data) => this.load(data['kind']));
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  get title(): string {
    return this.document?.kind === 'terms' ? 'Terms of Service' : 'Privacy Policy';
  }

  private load(kind: string) {
    this.loading = true;
    this.error = '';
    this.fastenApi.getLegalDocument(kind).subscribe({
      next: (document) => {
        this.document = document;
        this.loading = false;
      },
      error: (err) => {
        // A broken operator override is reported, not papered over with the shipped text — the
        // user would otherwise read a document their operator deliberately replaced.
        this.error = err?.error?.error || 'This document could not be loaded.';
        this.loading = false;
      },
    });
  }
}
