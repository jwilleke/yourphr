import {Directive, ViewContainerRef} from '@angular/core';

@Directive({
    selector: '[fhirCardOutlet]',
    standalone: false
})
export class FhirCardOutletDirective {

  constructor(public viewContainerRef: ViewContainerRef) { }

}
