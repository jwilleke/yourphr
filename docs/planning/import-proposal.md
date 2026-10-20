# One import for ngdpbase — notes for the operator to edit

> __Status: brainstorm notes, 2026-10-19/20, for the operator to edit.__ Nothing here is decided until the operator says so, and nothing goes to ngdpbase before that. Points already decided by the operator are marked __(decided)__. Once settled, the decisions move into [`ngdp-move.md`](ngdp-move.md) and the core parts become ngdpbase issues.

## The idea

__Most of the code lives in ngdpbase.__ One `ImportManager` brings files in, stores the originals where the caller says, and hands each file to registered __file parsers__ (the manager–provider pattern), which turn it into something. Add-ons register parsers for their own formats. yourPHR's `phr` add-on is one caller and one set of parsers.

What exists today: `ImportManager` behind `/admin/import`, with a registry of converters (JSPWiki, HTML, Markdown, DOCX). Each says which files it handles (`fileExtensions`, `canHandle(content, filename)`) and converts them to a page. It's admin-only, and its output is always wiki pages.

## The model

```text
files in: upload, folder pick, zip, or admin import
  → files layer stores each original, if the caller asked, where the system-category says
  → ImportManager runs it as a job: unpack, fingerprint, skip unchanged, per-file status, audit
  → each file is auto-detected (extension and content) and handed to the parsers that can take it
  → parsers chain: each adds to what the file produced
  → outputs are saved by whoever owns them: pages by core, records by the add-on that registered the parser
```

## Points

1. __One `ImportManager` (decided).__ The same manager for wiki-page import and for file and record import. Many files are recognised automatically and handed to a parser.
2. __Keeping the original is the caller's option (decided).__
   - PHR: keep it, stored by system-category (`phr` means the person's PHR vault).
   - Conversion to NCM: no stored copy, but the page keeps a footnote or link to its source (filename, date, fingerprint).
3. __Parsers return results; they never write (decided, option b).__ A parser turns a file into pages, text, or records. Core saves pages. Records go to the add-on that registered the parser, which saves them through its own door (`PhrManager` for phr). Parsers stay pure and testable, and every write stays behind its owner's door.
4. __Parsers chain (decided).__ One file can produce several things. A scanned lab report is kept as the original, then OCR'd into text, then mined for lab values, each step adding to the last.
5. __PHR import is for profiles, not admins (decided, in general).__ phr has its own import page for the person, which calls core's `ImportManager` with "keep the original" and "store by system-category `phr`". `/admin/import` stays admin-only, and phr's health-record parsers don't run from it.
6. __General parsers in core, domain parsers in add-ons.__ Core holds zip unpacking, PDF text, OCR, and image and DICOM metadata. phr registers FHIR (JSON and NDJSON), C-CDA, CCR and Blue Button text.
7. __The bookkeeping lives in core, once.__ Fingerprints, "skip unchanged", per-file status, "flag missing, never delete", and the audit record. phr's own copy from yourphr#939's first slice (`phr_source_files`) is temporary and goes once core's exists.
8. __Imports are checkpointed and resumable__ ([ngdpbase#1716](https://github.com/jwilleke/ngdpbase/issues/1716)). Into an encrypted vault, the job runs on the owner's short-lived, one-job pass ([ngdpbase#1920](https://github.com/jwilleke/ngdpbase/issues/1920), decided 2026-10-20): it pauses at sign-out and resumes at the next sign-in, and a banner shows it's running.
9. __Uploads are files in their own right__ ([ngdpbase#1852](https://github.com/jwilleke/ngdpbase/issues/1852), [#1855](https://github.com/jwilleke/ngdpbase/issues/1855)), not attachments, which are being retired (#1851). That means several files at once, a folder picked in the browser with each file's sub-folder path kept, and an event to the owning add-on when a file of its category is written, so "upload, then it imports" needs no polling.

## The system-category describes all its storage

`ngdpbase.system-category` is where vaults are defined (`storageLocation.defaultstore` and `privatestore`, `encrypt`, `defaultPrivate`). Proposed: let each category's `storageLocation` say where __everything__ stored for it lives (pages, files, import originals, footnotes, comments), each with its own index:

```json
"phr": {
  "storageLocation": {
    "defaultstore": "pages/",
    "privatestore": "pages/vaults/{user}/phr/",
    "files": "…the same vault…",
    "footnotes": "…the same vault…",
    "comments": "…the same vault…"
  }
}
```

- Footnotes and comments for shared pages (`pages/`) are shared. For `phr`, they're per person, inside each person's vault, encrypted with it (decided, same for comments). Today public footnotes and comments sit in one folder for every category (`${SLOW_STORAGE}/footnotes`, `/comments`), and vault pages keep theirs inside the vault ([ngdpbase#1839](https://github.com/jwilleke/ngdpbase/issues/1839)).
- A category whose vault is encrypted can't put any of its things somewhere unencrypted. That closes the class of gap found three times on 2026-10-16/17 (#1834, #1839, #1842).
- A category that says nothing keeps today's behaviour.

## Open

- How the per-person import page is reached: a page in the add-on, or a section of `/profile`.
- Whether a parser chain can stop part-way (OCR text low-confidence, so fact extraction is skipped) and how that's shown.
- What phr shows for files no parser can read yet: they're kept and listed today.
