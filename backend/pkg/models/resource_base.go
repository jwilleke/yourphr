package models

import (
	"time"

	"github.com/fastenhealth/fasten-onprem/backend/pkg/provenance"
	"gorm.io/datatypes"
)

type ResourceBase struct {
	OriginBase

	SortDate  *time.Time `json:"sort_date" gorm:"sort_date"`
	SortTitle *string    `json:"sort_title" gorm:"sort_title"`
	SourceUri *string    `json:"source_uri" gorm:"source_uri"`

	// The raw resource content in JSON format
	ResourceRaw datatypes.JSON `gorm:"column:resource_raw;type:text;serializer:json" json:"resource_raw,omitempty"`

	// Provenance ("who said this") — resolved at read time on the generic resource path. Not persisted
	// (gorm:"-"); nil unless a handler attaches it.
	Provenance *provenance.Provenance `json:"provenance,omitempty" gorm:"-"`

	// Classified is the Layer-1 synthesized view-model (legible state/verification/category + provenance)
	// for classifier-backed resource types, attached at read time (handler attachClassification). Not
	// persisted (gorm:"-"); nil for unclassified types. The concrete type is the per-resource Classified*
	// struct (e.g. allergyintolerance.ClassifiedAllergy) — see #308/#309.
	Classified any `json:"classified,omitempty" gorm:"-"`

	//relationships
	RelatedResource []*ResourceBase `json:"related_resources" gorm:"many2many:related_resources;ForeignKey:user_id,source_id,source_resource_type,source_resource_id;references:user_id,source_id,source_resource_type,source_resource_id;"`
}

func (s *ResourceBase) SetOriginBase(originBase OriginBase) {
	s.OriginBase = originBase
}
func (s *ResourceBase) SetSortTitle(sortTitle *string) {
	s.SortTitle = sortTitle
}

func (s *ResourceBase) SetSortDate(sortDate *time.Time) {
	s.SortDate = sortDate
}

func (s *ResourceBase) SetResourceRaw(resourceRaw datatypes.JSON) {
	s.ResourceRaw = resourceRaw
}
func (s *ResourceBase) GetResourceRaw() datatypes.JSON {
	return s.ResourceRaw
}

func (s *ResourceBase) SetSourceUri(sourceUri *string) {
	s.SourceUri = sourceUri
}
