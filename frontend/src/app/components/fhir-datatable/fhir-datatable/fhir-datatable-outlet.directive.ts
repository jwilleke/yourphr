import {Directive, ViewContainerRef} from '@angular/core';

@Directive({
    selector: '[fhirDatatableOutlet]',
    standalone: false
})
export class FhirDatatableOutletDirective {

  constructor(public viewContainerRef: ViewContainerRef) { }

}
