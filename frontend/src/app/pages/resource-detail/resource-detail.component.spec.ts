import {ComponentFixture, TestBed} from '@angular/core/testing';
import {RouterTestingModule} from '@angular/router/testing';
import {ActivatedRoute, convertToParamMap} from '@angular/router';
import {BehaviorSubject, of, throwError} from 'rxjs';
import {ResourceDetailComponent} from './resource-detail.component';
import {FastenApiService} from '../../services/fasten-api.service';

describe('ResourceDetailComponent', () => {
  let component: ResourceDetailComponent;
  let fixture: ComponentFixture<ResourceDetailComponent>;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let api: jasmine.SpyObj<FastenApiService>;

  beforeEach(async () => {
    params = new BehaviorSubject(convertToParamMap({'source_id': 'source-1', 'resource_id': 'implant#placement'}));
    api = jasmine.createSpyObj('FastenApiService', ['getResourceBySourceId', 'getSource']);
    api.getSource.and.returnValue(of({display: 'Added by you'} as never));
    api.getResourceBySourceId.and.callFake((_source, id) => of({
      source_id: 'source-1', source_resource_id: id,
      source_resource_type: id.includes('#') ? 'Procedure' : 'Device',
      resource_raw: id.includes('#')
        ? {resourceType: 'Procedure', id: 'placement', code: {text: 'Implant placement'}, performedDateTime: '2024'}
        : {resourceType: 'Device', id: 'implant', type: {text: 'Synthetic stent'}},
    } as never));
    await TestBed.configureTestingModule({
      declarations: [ResourceDetailComponent],
      imports: [RouterTestingModule],
      providers: [
        {provide: ActivatedRoute, useValue: {paramMap: params}},
        {provide: FastenApiService, useValue: api},
      ],
    }).overrideTemplate(ResourceDetailComponent, '{{resourceTitle}}').compileComponents();
    fixture = TestBed.createComponent(ResourceDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates and loads the contained Procedure', () => {
    expect(component).toBeTruthy();
    expect(component.resourceType).toBe('Procedure');
  });

  it('loads the implant when a contained Procedure link changes only the resource route parameter', () => {
    params.next(convertToParamMap({'source_id': 'source-1', 'resource_id': 'implant'}));
    expect(api.getResourceBySourceId).toHaveBeenCalledWith('source-1', 'implant');
    expect(component.resourceType).toBe('Device');
    expect(component.resourceTitle).toBe('Synthetic stent');
    expect(component.displayModel.source_resource_id).toBe('implant');
  });

  it('clears a failed read and still handles the next navigation', () => {
    api.getResourceBySourceId.and.returnValue(throwError(() => new Error('not found')));
    params.next(convertToParamMap({'resource_id': 'missing'}));
    expect(component.displayModel).toBeNull();
    expect(component.loading).toBeFalse();
    expect(component.loadError).toContain('Could not load this record');
    api.getResourceBySourceId.and.returnValue(of({
      source_resource_type: 'Device', source_resource_id: 'implant', resource_raw: {resourceType: 'Device', id: 'implant'},
    } as never));
    params.next(convertToParamMap({'resource_id': 'implant'}));
    expect(component.resourceType).toBe('Device');
    expect(component.loadError).toBe('');
  });
});
