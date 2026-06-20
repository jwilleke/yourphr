package smart

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"golang.org/x/oauth2"
)

const (
	// maxBinaryResponseBytes caps a single fetched Binary response. A Binary comes back as FHIR JSON
	// with the document base64-encoded in `data` (~1.37x the raw size), so ~14 MiB covers a ~10 MB
	// document. Larger attachments are skipped (and logged) so one huge file can't bloat the encrypted
	// SQLite DB or exhaust memory. #342.
	maxBinaryResponseBytes = 14 << 20

	// binaryFetchConcurrency bounds how many Binary GETs run at once. Kept small because providers like
	// Cerner are slow and return intermittent 5xx under load — the network fetch is parallelized, but
	// the DB upsert (onBinary) stays serial to avoid SQLite write contention. #342.
	binaryFetchConcurrency = 4
)

// FetchBinaries fetches the given Binary attachment URLs concurrently (bounded) and hands each
// fetched Binary's raw FHIR JSON to onBinary for upsert. It is BEST-EFFORT: an attachment that 403s,
// times out, exceeds maxBinaryResponseBytes, or is not a same-host Binary reference is logged and
// skipped — never failing the whole pass, since documents are supplementary to the metadata already
// imported. The token is auto-refreshed if expired; a non-nil refreshed token must be persisted by the
// caller. onBinary is invoked SERIALLY (safe for a single DB connection); only the network fetches run
// in parallel. #342 (Cerner DocumentReference/DiagnosticReport → Binary).
func (c Config) FetchBinaries(ctx context.Context, ep Endpoints, tok *oauth2.Token, urls []string, onBinary PageFunc) (refreshed *oauth2.Token, err error) {
	if len(urls) == 0 {
		return nil, nil
	}
	base, err := c.safeBaseURL()
	if err != nil {
		return nil, err
	}
	ctx = context.WithValue(ctx, oauth2.HTTPClient, c.httpClient())
	ts := c.oauth2Config(ep).TokenSource(ctx, tok)
	// Surface a refreshed token on every exit so the caller persists it even if the pass aborts.
	defer func() {
		if t, terr := ts.Token(); terr == nil && t.AccessToken != tok.AccessToken {
			refreshed = t
		}
	}()
	httpClient := oauth2.NewClient(ctx, ts)

	sem := make(chan struct{}, binaryFetchConcurrency)
	results := make(chan []byte, binaryFetchConcurrency)
	var wg sync.WaitGroup

	go func() {
		for _, u := range urls {
			select {
			case <-ctx.Done():
			case sem <- struct{}{}:
			}
			if ctx.Err() != nil {
				break
			}
			wg.Add(1)
			go func(rawURL string) {
				defer wg.Done()
				defer func() { <-sem }()
				resolved, ok := c.resolveBinaryURL(base, rawURL)
				if !ok {
					c.logf("skipping attachment URL (not a same-host Binary reference): %s", rawURL)
					return
				}
				body, oversized, ferr := fetchBinaryRetry(ctx, httpClient, resolved)
				if oversized {
					c.logf("skipping oversized Binary (> %d bytes): %s", maxBinaryResponseBytes, resolved)
					return
				}
				if ferr != nil {
					c.logf("skipping Binary %s: %v", resolved, ferr)
					return
				}
				select {
				case results <- body:
				case <-ctx.Done():
				}
			}(u)
		}
		wg.Wait()
		close(results)
	}()

	// Serial consumer: upsert each fetched Binary as it arrives (bounded memory, no SQLite write race).
	for body := range results {
		if perr := onBinary(body); perr != nil {
			err = perr // best-effort: record but keep draining so workers don't block on a full channel
		}
	}
	return refreshed, err
}

// resolveBinaryURL turns an attachment URL into a safe, absolute URL to fetch, or reports !ok to skip
// it. A relative reference ("Binary/{id}" or "/Binary/{id}") is joined onto the already-validated FHIR
// base. An absolute URL is followed ONLY when it targets a `/Binary/` path on the SAME host as the
// FHIR base and passes the SSRF internal-host guard — so a provider-controlled attachment URL cannot
// be aimed at another host or an internal address. #342.
func (c Config) resolveBinaryURL(base, rawURL string) (string, bool) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return "", false
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", false
	}
	if u.Scheme == "" && u.Host == "" { // relative reference
		p := strings.TrimPrefix(u.Path, "/")
		if !strings.HasPrefix(p, "Binary/") {
			return "", false
		}
		return base + "/" + p, true
	}
	if !strings.Contains(u.Path, "/Binary/") {
		return "", false
	}
	bu, berr := url.Parse(base)
	if berr != nil || !strings.EqualFold(u.Host, bu.Host) {
		return "", false
	}
	if _, verr := validateBaseURL(rawURL, c.AllowInternalHosts); verr != nil {
		return "", false
	}
	return rawURL, true
}

// fetchBinaryRetry wraps fetchBinaryOnce with the same transient-failure retry as bundle pages
// (gateway 5xx / client timeout), so a flaky Cerner blip recovers. #341/#342.
func fetchBinaryRetry(ctx context.Context, client *http.Client, reqURL string) (body []byte, oversized bool, err error) {
	const maxAttempts = 2
	for attempt := 1; ; attempt++ {
		body, oversized, err = fetchBinaryOnce(ctx, client, reqURL)
		if err == nil || attempt >= maxAttempts || !isRetryable(err) {
			return body, oversized, err
		}
		select {
		case <-ctx.Done():
			return nil, false, ctx.Err()
		case <-time.After(time.Duration(attempt) * 2 * time.Second):
		}
	}
}

// fetchBinaryOnce GETs a Binary as a FHIR resource (Accept: application/fhir+json → JSON with base64
// `data`, so it stores uniformly via UpsertRawResource). The body is read through a size-capped reader;
// a response over maxBinaryResponseBytes returns oversized=true (no body) for the caller to skip.
func fetchBinaryOnce(ctx context.Context, client *http.Client, reqURL string) (body []byte, oversized bool, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, false, err
	}
	req.Header.Set("Accept", "application/fhir+json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = resp.Body.Close() }()
	body, err = io.ReadAll(io.LimitReader(resp.Body, maxBinaryResponseBytes+1))
	if err != nil {
		return nil, false, err
	}
	if len(body) > maxBinaryResponseBytes {
		return nil, true, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, false, &httpStatusError{StatusCode: resp.StatusCode, Body: truncate(body, 500)}
	}
	return body, false, nil
}
