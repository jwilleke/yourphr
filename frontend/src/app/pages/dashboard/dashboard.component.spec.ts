import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';

import { DashboardComponent, DEFAULT_TILES } from './dashboard.component';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {RouterTestingModule} from '@angular/router/testing';
import {RouterModule} from '@angular/router';
import {HTTP_CLIENT_TOKEN} from '../../dependency-injection';
import { HttpClient, provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { SharedModule } from '../../components/shared.module';
import { DashboardPreferencesService } from '../../services/dashboard-preferences.service';

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;
  let preferences: DashboardPreferencesService;

  beforeEach(waitForAsync(() => {
    localStorage.removeItem('dashboard_tile_order');
    localStorage.removeItem('dashboard_tile_colors');
    TestBed.configureTestingModule({
    declarations: [DashboardComponent],
    imports: [RouterTestingModule, RouterModule, DragDropModule, SharedModule],
    providers: [
        {
            provide: HTTP_CLIENT_TOKEN,
            useClass: HttpClient,
        },
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClientTesting(),
    ]
})
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    preferences = TestBed.inject(DashboardPreferencesService);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem('dashboard_tile_order');
    localStorage.removeItem('dashboard_tile_colors');
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the default tiles in default order', () => {
    expect(component.tiles.map((tile) => tile.id)).toEqual(DEFAULT_TILES.map((tile) => tile.id));
    expect(component.tiles[0].label).toEqual('Medical Concerns');
  });

  it('should persist the new order on tile drop', () => {
    component.onTileDrop({previousIndex: 0, currentIndex: 2} as CdkDragDrop<any>);

    expect(component.tiles[2].id).toEqual(DEFAULT_TILES[0].id);
    expect(component.hasCustomOrder).toBeTrue();
    expect(preferences.getTileOrder()).toEqual(component.tiles.map((tile) => tile.id));
  });

  it('should restore the default order on reset and keep counts', () => {
    component.tiles[0].count = 42;
    component.onTileDrop({previousIndex: 0, currentIndex: 3} as CdkDragDrop<any>);

    component.resetTileOrder();

    expect(component.tiles.map((tile) => tile.id)).toEqual(DEFAULT_TILES.map((tile) => tile.id));
    expect(component.tiles[0].count).toEqual(42);
    expect(component.hasCustomOrder).toBeFalse();
    expect(preferences.getTileOrder()).toBeNull();
  });

  it('should not navigate from a tile while customizing', () => {
    spyOn((component as any).router, 'navigate');
    component.customizing = true;

    component.openTile(component.tiles[0]);

    expect((component as any).router.navigate).not.toHaveBeenCalled();
  });

  it('should set and persist a tile color', () => {
    const tile = component.tiles[0];
    component.setTileColor(tile, 'green');

    expect(tile.color).toEqual('green');
    expect(component.hasCustomColors).toBeTrue();
    expect(preferences.getTileColors()[tile.id]).toEqual('green');
  });

  it('should restore default colors on reset', () => {
    const tile = component.tiles[0];
    const defaultColor = DEFAULT_TILES[0].color;
    component.setTileColor(tile, 'pink');

    component.resetTileOrder();

    expect(component.tiles[0].color).toEqual(defaultColor);
    expect(component.hasCustomColors).toBeFalse();
    expect(preferences.getTileColors()).toEqual({});
  });

  // A tile's number is a promise about what the page behind it contains. The practitioners tile used
  // to sum Practitioner + Organization + CareTeam while /practitioners lists practitioners only, so
  // it read "4 practitioners" and delivered two rows (#525).
  it('should count only Practitioner on the practitioners tile, matching the page it opens', () => {
    const tile = DEFAULT_TILES.find((t) => t.id === 'care-team');

    expect(tile.route).toEqual('/practitioners');
    expect(tile.resourceTypes).toEqual(['Practitioner']);
  });

  it('should not inflate the practitioners count with organizations', () => {
    component['populateTileCounts']({
      resource_type_counts: [
        {resource_type: 'Practitioner', count: 2},
        {resource_type: 'Organization', count: 2},
        {resource_type: 'CareTeam', count: 1},
      ],
    } as any);

    const tile = component.tiles.find((t) => t.id === 'care-team');
    expect(tile.count).toEqual(2);
  });
});
