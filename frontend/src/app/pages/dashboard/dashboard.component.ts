import {Component, OnDestroy, OnInit} from '@angular/core';
import {Router} from '@angular/router';
import {CdkDragDrop, moveItemInArray} from '@angular/cdk/drag-drop';
import {Subject, Subscription, of} from 'rxjs';
import {debounceTime, distinctUntilChanged, switchMap, catchError} from 'rxjs/operators';
import {FastenApiService} from '../../services/fasten-api.service';
import {AuthService} from '../../services/auth.service';
import {DashboardPreferencesService} from '../../services/dashboard-preferences.service';
import {Summary} from '../../models/fasten/summary';
import {ClassifiedCondition} from '../../models/fasten/classified-condition';
import {ClassifiedAllergy} from '../../models/fasten/classified-allergy';
import {ResourceListItem} from '../../models/fasten/resource-list-item';

// The palette a patient can pick a tile color from (matches the SCSS .tile-color-* classes).
export const TILE_PALETTE = ['amber', 'blue', 'red', 'green', 'teal', 'purple', 'pink', 'gray']

// A large-icon category tile. Labels pair plain language (label) with the
// standardized clinical term (clinicalLabel) so the record stays legible to
// the patient and useful to providers (#262). color is the default palette
// hue (patient-overridable); unit is the noun in the count sub-line.
export interface DashboardTile {
  id: string
  label: string
  clinicalLabel: string
  icon: string
  route: string
  resourceTypes: string[]
  count: number
  color: string
  unit: string
  // countKey tiles get their count from a classifier (not the summary resource counts): concerns/profile
  // from the condition classifier, allergies from the allergy classifier (so "no known allergy"
  // negations are excluded — #290).
  countKey?: 'concerns' | 'profile' | 'allergies'
}

export const DEFAULT_TILES: DashboardTile[] = [
  {id: 'concerns', label: 'Medical Concerns', clinicalLabel: 'Active health problems', icon: 'fa-solid fa-heart-pulse', route: '/medical-concerns', resourceTypes: [], count: 0, color: 'red', unit: 'active', countKey: 'concerns'},
  {id: 'patient-profile', label: 'Patient Profile', clinicalLabel: 'Personal & social info', icon: 'fa-solid fa-id-card', route: '/patient-profile', resourceTypes: [], count: 0, color: 'gray', unit: 'items', countKey: 'profile'},
  {id: 'medications', label: 'Medications', clinicalLabel: 'Prescriptions & medication statements', icon: 'fa-solid fa-pills', route: '/medications', resourceTypes: ['MedicationRequest', 'MedicationStatement', 'Medication', 'MedicationAdministration', 'MedicationDispense'], count: 0, color: 'amber', unit: 'records'},
  {id: 'allergies', label: 'Allergies', clinicalLabel: 'Allergies & intolerances', icon: 'fa-solid fa-triangle-exclamation', route: '/allergies', resourceTypes: ['AllergyIntolerance'], count: 0, color: 'pink', unit: 'recorded', countKey: 'allergies'},
  {id: 'lab-results', label: 'Lab Results', clinicalLabel: 'Observations & diagnostic reports', icon: 'fa-solid fa-flask', route: '/labs', resourceTypes: ['Observation', 'DiagnosticReport'], count: 0, color: 'blue', unit: 'results'},
  {id: 'immunizations', label: 'Immunizations', clinicalLabel: 'Vaccinations', icon: 'fa-solid fa-syringe', route: '/immunizations', resourceTypes: ['Immunization'], count: 0, color: 'green', unit: 'on file'},
  {id: 'visits', label: 'Visits & Notes', clinicalLabel: 'Encounters', icon: 'fa-solid fa-notes-medical', route: '/medical-history', resourceTypes: ['Encounter'], count: 0, color: 'teal', unit: 'encounters'},
  {id: 'procedures', label: 'Procedures', clinicalLabel: 'Procedures & surgeries', icon: 'fa-solid fa-user-nurse', route: '/procedures', resourceTypes: ['Procedure'], count: 0, color: 'purple', unit: 'procedures'},
  {id: 'documents', label: 'Documents', clinicalLabel: 'Clinical documents & files', icon: 'fa-solid fa-file-medical', route: '/medical-history', resourceTypes: ['DocumentReference', 'Media', 'Binary'], count: 0, color: 'gray', unit: 'documents'},
  {id: 'care-team', label: 'Care Team', clinicalLabel: 'Practitioners & organizations', icon: 'fa-solid fa-user-doctor', route: '/practitioners', resourceTypes: ['Practitioner', 'Organization', 'CareTeam'], count: 0, color: 'teal', unit: 'practitioners'},
]

@Component({
    selector: 'app-dashboard',
    templateUrl: './dashboard.component.html',
    styleUrls: ['./dashboard.component.scss'],
    standalone: false
})
export class DashboardComponent implements OnInit, OnDestroy {
  loading = false

  lastUpdated: Date = null
  sourceCount = 0

  greeting = 'Welcome'
  patientName = ''       // full name of the record being viewed
  patientFirstName = ''

  recentActivity: ResourceListItem[] = []

  searchQuery = ''
  searchResults: ResourceListItem[] = []
  searching = false

  tiles: DashboardTile[] = []
  customizing = false
  hasCustomOrder = false
  hasCustomColors = false
  palette = TILE_PALETTE

  private userId: string = undefined
  private searchInput$ = new Subject<string>()
  private searchSub: Subscription

  constructor(
    private fastenApi: FastenApiService,
    private authService: AuthService,
    private dashboardPreferences: DashboardPreferencesService,
    private router: Router,
  ) { }

  ngOnInit() {
    this.loading = true
    this.greeting = this.timeOfDayGreeting()
    this.loadPatientName()
    this.loadRecentActivity()
    this.wireSearch()

    // paint immediately with the default order; re-apply the saved order once
    // the user id arrives (preferences are scoped per user)
    this.tiles = DEFAULT_TILES.map((tile) => ({...tile}))

    this.authService.GetCurrentUser().then((claims) => {
      this.userId = claims?.sub
    }).catch(() => {
      this.userId = undefined
    }).finally(() => {
      this.tiles = this.applySavedOrder(this.tiles)
      this.applySavedColors(this.tiles)
      this.hasCustomOrder = this.dashboardPreferences.hasCustomTileOrder(this.userId)
      this.hasCustomColors = this.dashboardPreferences.hasCustomTileColors(this.userId)
    })

    this.fastenApi.getSummary().subscribe({
      next: (summary: Summary) => {
        this.loading = false
        this.populateTileCounts(summary)

        this.sourceCount = summary.sources?.length || 0
        if (summary.sources && summary.sources.length > 0) {
          this.lastUpdated = summary.sources.reduce((latest, source) => {
            const sourceDate = new Date(source.updated_at);
            return sourceDate > latest ? sourceDate : latest;
          }, new Date(0));
        }
      },
      error: () => { this.loading = false }
    })

    // The backend classifier synthesizes Condition.category + display state and separates real
    // health problems from social/administrative "Personal Health Conditions". The Medical Concerns
    // and Patient Profile tiles are counted from it (not the raw Condition count).
    this.fastenApi.getReconciledConditions().subscribe({
      next: (rows: ClassifiedCondition[]) => {
        const problems = (rows || []).filter((r) => r.category === 'problem-list-item')
        // Concerns = Active + Remission (still tracked) + Unknown (shown, never assumed); RuledOut is
        // excluded, Resolved is past, and entered-in-error never reaches the client.
        const concerns = problems.filter((r) => r.state === 'Active' || r.state === 'Remission' || r.state === 'Unknown')
        const profile = (rows || []).filter((r) => r.category === 'sdoh' || r.category === 'health-concern')
        this.setTileCount('concerns', concerns.length)
        this.setTileCount('profile', profile.length)
      },
    })

    // The Allergies tile counts REAL allergies only — the allergy classifier flags "no known allergy"
    // negation assertions (noKnown), which must not inflate the count (#290). RuledOut (refuted) is
    // also excluded; everything else the record states is counted.
    this.fastenApi.getClassifiedAllergies().subscribe({
      next: (rows: ClassifiedAllergy[]) => {
        const real = (rows || []).filter((r) => !r.noKnown && r.state !== 'RuledOut')
        this.setTileCount('allergies', real.length)
      },
    })
  }

  ngOnDestroy() {
    this.searchSub?.unsubscribe()
  }

  private timeOfDayGreeting(): string {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 18) return 'Good afternoon'
    return 'Good evening'
  }

  // The record being viewed is identified by its Patient resource (a family PHR may hold several).
  private loadPatientName() {
    this.fastenApi.getResources('Patient').subscribe({
      next: (patients) => {
        const raw = (patients && patients[0]?.resource_raw) as any
        const name = raw?.name?.find((n) => n?.use === 'official') || raw?.name?.[0]
        if (!name) return
        const given = (name.given || []).join(' ')
        this.patientFirstName = (name.given && name.given[0]) || ''
        this.patientName = (name.text || `${given} ${name.family || ''}`).trim()
      },
      error: () => { /* greeting falls back to a generic welcome */ },
    })
  }

  private loadRecentActivity() {
    this.fastenApi.getRecentResources(5).subscribe({
      next: (items) => { this.recentActivity = items || [] },
      error: () => { this.recentActivity = [] },
    })
  }

  private wireSearch() {
    this.searchSub = this.searchInput$.pipe(
      debounceTime(250),
      distinctUntilChanged(),
      switchMap((q) => {
        const query = (q || '').trim()
        if (query.length < 2) { this.searching = false; return of([] as ResourceListItem[]) }
        this.searching = true
        return this.fastenApi.searchResources(query).pipe(catchError(() => of([] as ResourceListItem[])))
      }),
    ).subscribe((results) => {
      this.searching = false
      this.searchResults = results
    })
  }

  onSearchInput(value: string) {
    this.searchQuery = value
    this.searchInput$.next(value)
  }

  clearSearch() {
    this.searchQuery = ''
    this.searchResults = []
    this.searching = false
  }

  openResource(item: ResourceListItem) {
    this.router.navigate(['/explore', item.source_id, 'resource', item.source_resource_id])
  }

  // map a FHIR resource type to a Font Awesome icon for the recent/search lists
  iconForType(resourceType: string): string {
    const map: Record<string, string> = {
      Condition: 'fa-heart-pulse',
      MedicationRequest: 'fa-pills', MedicationStatement: 'fa-pills', MedicationDispense: 'fa-pills', Medication: 'fa-pills', MedicationAdministration: 'fa-pills',
      AllergyIntolerance: 'fa-triangle-exclamation',
      Observation: 'fa-flask', DiagnosticReport: 'fa-flask',
      Immunization: 'fa-syringe',
      Encounter: 'fa-notes-medical',
      Procedure: 'fa-user-nurse',
      DocumentReference: 'fa-file-medical', Media: 'fa-file-medical', Binary: 'fa-file-medical',
      Practitioner: 'fa-user-doctor', Organization: 'fa-hospital', CareTeam: 'fa-user-doctor',
    }
    return 'fa-solid ' + (map[resourceType] || 'fa-file-lines')
  }

  private setTileCount(countKey: NonNullable<DashboardTile['countKey']>, count: number) {
    const tile = this.tiles.find((t) => t.countKey === countKey)
    if (tile) tile.count = count
  }

  private populateTileCounts(summary: Summary) {
    const countsByType: Record<string, number> = {}
    for (const typeCount of (summary.resource_type_counts || [])) {
      countsByType[typeCount.resource_type] = typeCount.count
    }
    for (const tile of this.tiles) {
      if (tile.countKey) continue // counted from the classifier, not summary resource counts
      tile.count = tile.resourceTypes.reduce((sum, resourceType) => sum + (countsByType[resourceType] || 0), 0)
    }
  }

  private applySavedOrder(tiles: DashboardTile[]): DashboardTile[] {
    const savedOrder = this.dashboardPreferences.getTileOrder(this.userId)
    if (!savedOrder?.length) return tiles
    // saved ids first (in saved order), then any tiles added since the save
    const byId = new Map(tiles.map((tile) => [tile.id, tile]))
    const ordered = savedOrder.map((id) => byId.get(id)).filter((tile) => !!tile)
    const remaining = tiles.filter((tile) => !savedOrder.includes(tile.id))
    return [...ordered, ...remaining]
  }

  private applySavedColors(tiles: DashboardTile[]): void {
    const savedColors = this.dashboardPreferences.getTileColors(this.userId)
    for (const tile of tiles) {
      const color = savedColors[tile.id]
      if (color && this.palette.includes(color)) tile.color = color
    }
  }

  setTileColor(tile: DashboardTile, color: string) {
    tile.color = color
    this.dashboardPreferences.setTileColor(tile.id, color, this.userId)
    this.hasCustomColors = true
  }

  openTile(tile: DashboardTile) {
    if (this.customizing) return
    this.router.navigate([tile.route])
  }

  toggleCustomizing() {
    this.customizing = !this.customizing
  }

  onTileDrop(event: CdkDragDrop<DashboardTile[]>) {
    moveItemInArray(this.tiles, event.previousIndex, event.currentIndex)
    this.dashboardPreferences.setTileOrder(this.tiles.map((tile) => tile.id), this.userId)
    this.hasCustomOrder = true
  }

  resetTileOrder() {
    this.dashboardPreferences.resetTileOrder(this.userId)
    this.dashboardPreferences.resetTileColors(this.userId)
    this.hasCustomOrder = false
    this.hasCustomColors = false
    const countsById = new Map(this.tiles.map((tile) => [tile.id, tile.count]))
    this.tiles = DEFAULT_TILES.map((tile) => ({...tile, count: countsById.get(tile.id) ?? 0}))
  }
}
