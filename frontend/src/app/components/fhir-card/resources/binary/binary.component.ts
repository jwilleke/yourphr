import {ChangeDetectorRef, Component, Input, OnInit} from '@angular/core';
import {BinaryModel} from '../../../../../lib/models/resources/binary-model';
import {FhirCardComponentInterface} from '../../fhir-card/fhir-card-component-interface';
import {Router, RouterModule} from '@angular/router';
import {AttachmentModel} from '../../../../../lib/models/datatypes/attachment-model';
import {FastenApiService} from '../../../../services/fasten-api.service';
import {NgbCollapseModule} from "@ng-bootstrap/ng-bootstrap";
import {CommonModule} from "@angular/common";
import {BadgeComponent} from "../../common/badge/badge.component";
import {TableComponent} from "../../common/table/table.component";
import {PdfComponent} from "../../datatypes/pdf/pdf.component";
import {ImgComponent} from "../../datatypes/img/img.component";
import {HtmlComponent} from "../../datatypes/html/html.component";
import {MarkdownComponent} from "../../datatypes/markdown/markdown.component";
import {BinaryTextComponent} from "../../datatypes/binary-text/binary-text.component";
import {DicomComponent} from "../../datatypes/dicom/dicom.component";
import {HighlightModule} from "ngx-highlightjs";
import { HttpClient } from "@angular/common/http";
import {AuthService} from "../../../../services/auth.service";
import {RtfComponent} from '../../datatypes/rtf/rtf.component';

@Component({
    imports: [
        NgbCollapseModule,
        CommonModule,
        PdfComponent,
        ImgComponent,
        HtmlComponent,
        MarkdownComponent,
        RtfComponent,
        BinaryTextComponent,
        DicomComponent,
        HighlightModule,
        RouterModule
    ],
    providers: [FastenApiService, AuthService],
    selector: 'fhir-binary',
    templateUrl: './binary.component.html',
    styleUrls: ['./binary.component.scss']
})
export class BinaryComponent implements OnInit, FhirCardComponentInterface {
  @Input() displayModel: BinaryModel
  @Input() showDetails = true
  @Input() attachmentSourceId: string
  @Input() attachmentModel: AttachmentModel //can only have attachmentModel or binaryModel, not both.
  @Input() isCollapsed = false

  loading = false
  //set when the referenced Binary could not be retrieved (not downloaded yet, skipped as oversized on
  //import, or otherwise unavailable) — so the template shows a clear message instead of the misleading
  //"Unknown Binary content type undefined" empty state. #349
  loadError = false
  constructor(public changeRef: ChangeDetectorRef, public router: Router, public fastenApi: FastenApiService) {}

  ngOnInit(): void {
    if(!this.displayModel && this.attachmentSourceId && this.attachmentModel){
      this.loading = true
      this.fastenApi.getBinaryModel(this.attachmentSourceId, this.attachmentModel)
        .subscribe((binaryModel: BinaryModel) => {
          this.loading = false
          this.displayModel = binaryModel
          this.markForCheck()
        }, (error) => {
          this.loading = false
          this.loadError = true
          console.error("Failed to lookup binary resource from attachment:", error)
          this.markForCheck()
        })
    }
  }

  //hasContent reports whether there is a stored document to render/download (a Binary with base64 data).
  get hasContent(): boolean {
    return !!this.displayModel?.data
  }

  //downloadFilename derives a friendly file name from the attachment title (when present) plus an
  //extension inferred from the content type, so a saved document opens in the right app.
  get downloadFilename(): string {
    const base = (this.attachmentModel?.title || 'document').trim().replace(/[^\w.\-]+/g, '_')
    if(/\.[A-Za-z0-9]+$/.test(base)){
      return base //already carries an extension
    }
    const ext = BinaryComponent.extensionForContentType(this.displayModel?.content_type)
    return ext ? `${base}.${ext}` : base
  }

  //download saves the document bytes to the user's device — "your records, in your hands". Works for
  //every content type, including ones the inline viewer can't render (e.g. text/xml). #349
  download(): void {
    if(!this.hasContent){
      return
    }
    const blob = BinaryComponent.base64ToBlob(this.displayModel.data, this.displayModel.content_type)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = this.downloadFilename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  static base64ToBlob(base64Data: string, contentType: string): Blob {
    const byteChars = atob(base64Data)
    const bytes = new Uint8Array(byteChars.length)
    for(let i = 0; i < byteChars.length; i++){
      bytes[i] = byteChars.charCodeAt(i)
    }
    return new Blob([bytes], {type: contentType || 'application/octet-stream'})
  }

  static extensionForContentType(contentType: string | undefined): string {
    switch(contentType){
      case 'application/pdf': return 'pdf'
      case 'text/plain': return 'txt'
      case 'text/html':
      case 'application/html': return 'html'
      case 'text/markdown': return 'md'
      case 'text/rtf': return 'rtf'
      case 'application/xml': return 'xml'
      case 'application/json': return 'json'
      case 'image/jpeg': return 'jpg'
      case 'image/png': return 'png'
      case 'application/dicom': return 'dcm'
      default: return ''
    }
  }

  markForCheck(){
    this.changeRef.markForCheck()
  }
}
