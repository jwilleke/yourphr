import {ComponentFixture, TestBed} from '@angular/core/testing';

import {MissingDataComponent} from './missing-data.component';

describe('MissingDataComponent', () => {
  let component: MissingDataComponent;
  let fixture: ComponentFixture<MissingDataComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MissingDataComponent]
    })
      .compileComponents();

    fixture = TestBed.createComponent(MissingDataComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders the default "Data Not Provided" label', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent?.trim()).toBe('Data Not Provided');
  });

  it('explains that the data was absent from the source record (no guessing)', () => {
    expect(component.explanation).toContain('was not included in the record imported from your provider');
    expect(component.explanation).toContain('never fills in or guesses');
  });

  it('tailors the explanation to a named field', () => {
    component.field = 'Purpose';
    expect(component.explanation).toContain('"Purpose" was not included');
  });
});
