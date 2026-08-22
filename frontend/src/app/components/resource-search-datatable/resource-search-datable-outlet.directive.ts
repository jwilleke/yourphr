import { Directive, ViewContainerRef } from '@angular/core';

@Directive({
  standalone: false,
  selector: '[resourceSearchDatatableOutlet]',
})
export class ResourceSearchDatatableOutletDirective {
  constructor(public viewContainerRef: ViewContainerRef) {}
}
