package models

//type ResourceFhir struct {
//	OriginBase
//
//	SortDate  *time.Time `json:"sort_date" gorm:"sort_date"`
//	SortTitle *string    `json:"sort_title" gorm:"sort_title"`
//
//	//embedded data
//	ResourceRaw datatypes.JSON `json:"resource_raw" gorm:"resource_raw"`
//
//	//relationships
//	RelatedResourceFhir []*ResourceFhir `json:"related_resources" gorm:"many2many:related_resources;ForeignKey:user_id,source_id,source_resource_type,source_resource_id;references:user_id,source_id,source_resource_type,source_resource_id;"`
//}

type ListResourceQueryOptions struct {
	SourceID           string
	SourceResourceType string
	SourceResourceID   string

	// SortTitleContains, when set, filters to resources whose sort_title contains the substring
	// (case-insensitive LIKE) — used for the dashboard "search your record" feature.
	SortTitleContains string

	//pagination
	Limit  int
	Offset int
}
