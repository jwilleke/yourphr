import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';

import { ComponentsSidebarComponent } from './components-sidebar.component';

describe('ComponentsSidebarComponent', () => {
  let component: ComponentsSidebarComponent;
  let fixture: ComponentFixture<ComponentsSidebarComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ ComponentsSidebarComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ComponentsSidebarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
