package handler

import (
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/database"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/models"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// resourceListItem is a lightweight view of a resource for the dashboard's recent-activity and
// search lists — title + date + identity, without the heavy resource_raw body.
type resourceListItem struct {
	SourceID           string  `json:"source_id"`
	SourceResourceType string  `json:"source_resource_type"`
	SourceResourceID   string  `json:"source_resource_id"`
	Title              string  `json:"title"`
	Date               *string `json:"date,omitempty"`
}

func toResourceListItems(resources []models.ResourceBase) []resourceListItem {
	items := make([]resourceListItem, 0, len(resources))
	for i := range resources {
		title := ""
		if resources[i].SortTitle != nil {
			title = *resources[i].SortTitle
		}
		var date *string
		if resources[i].SortDate != nil {
			s := resources[i].SortDate.Format("2006-01-02")
			date = &s
		}
		items = append(items, resourceListItem{
			SourceID:           resources[i].SourceID.String(),
			SourceResourceType: resources[i].SourceResourceType,
			SourceResourceID:   resources[i].SourceResourceID,
			Title:              title,
			Date:               date,
		})
	}
	return items
}

// sortByDateDesc orders resources by SortDate descending (nil dates last).
func sortByDateDesc(resources []models.ResourceBase) {
	sort.SliceStable(resources, func(i, j int) bool {
		a, b := resources[i].SortDate, resources[j].SortDate
		if a == nil {
			return false
		}
		if b == nil {
			return true
		}
		return a.After(*b)
	})
}

// GetRecentResources returns the most recently dated resources across the whole record (default 5),
// for the dashboard "recent activity" list.
func GetRecentResources(c *gin.Context) {
	logger := c.MustGet(pkg.ContextKeyTypeLogger).(*logrus.Entry)
	databaseRepo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)

	limit := 5
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 50 {
			limit = n
		}
	}

	// Limit per resource table, then merge and sort by date so we return the global most-recent.
	resources, err := databaseRepo.ListResources(c, models.ListResourceQueryOptions{Limit: limit})
	if err != nil {
		logger.Errorf("error listing recent resources: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	sortByDateDesc(resources)
	if len(resources) > limit {
		resources = resources[:limit]
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": toResourceListItems(resources)})
}

// SearchResources returns resources whose title matches the query string, across the whole record.
func SearchResources(c *gin.Context) {
	logger := c.MustGet(pkg.ContextKeyTypeLogger).(*logrus.Entry)
	databaseRepo := c.MustGet(pkg.ContextKeyTypeDatabase).(database.DatabaseRepository)

	query := strings.TrimSpace(c.Query("q"))
	if len(query) < 2 {
		c.JSON(http.StatusOK, gin.H{"success": true, "data": []resourceListItem{}})
		return
	}

	// up to 10 matches per resource table, merged and date-sorted, capped to a readable list.
	resources, err := databaseRepo.ListResources(c, models.ListResourceQueryOptions{SortTitleContains: query, Limit: 10})
	if err != nil {
		logger.Errorf("error searching resources: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	sortByDateDesc(resources)
	if len(resources) > 20 {
		resources = resources[:20]
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": toResourceListItems(resources)})
}
