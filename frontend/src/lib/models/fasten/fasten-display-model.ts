import {FastenOptions} from './fasten-options';
import {Provenance} from './provenance';
import {Classified} from './classified';
import {ResourceType} from '../constants';

export class FastenDisplayModel {
  source_resource_type: ResourceType | undefined
  source_resource_id: string | undefined
  source_id: string | undefined
  sort_title: string | undefined
  sort_date: Date | undefined

  // "Who said this" — resolved at read time on the generic resource path (#271). Undefined for models
  // not built from that path (e.g. storybook fixtures). Rendered once by the fhir-card host.
  provenance: Provenance | undefined

  // Layer-1 synthesized view-model (legible state/verification/category) attached at read time for
  // classifier-backed types (#308/#309). Undefined for unclassified types / storybook fixtures.
  // Rendered once by the fhir-card host; never re-derived in TS.
  classified: Classified | undefined

  related_resources: Record<string, FastenDisplayModel[]> = {}

  constructor(options?: FastenOptions) {}
}
