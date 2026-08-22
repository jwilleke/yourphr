package handler

import (
	"net/http"

	"github.com/fastenhealth/fasten-onprem/backend/pkg"
	"github.com/fastenhealth/fasten-onprem/backend/pkg/config"
	"github.com/gin-gonic/gin"
)

// GetSettings godoc
// @Summary Get settings
// @Description Get settings
// @Tags Settings
// @Accept  json
// @Produce  json
// @Success 200 {object} map[string]interface{}
// @Router /settings [get]
func GetSettings(c *gin.Context) {
	cfg := c.MustGet(pkg.ContextKeyTypeConfig).(config.Interface)

	// cfg.Get("search") walks viper's registered defaults/config tree, but viper only checks
	// an environment override (YOURPHR_SEARCH_*) when a LEAF key is queried directly — Get() on
	// the parent key silently returns the un-overridden defaults. Read every leaf explicitly so
	// an operator's YOURPHR_SEARCH_ENABLED=true (etc.) actually reaches the frontend.
	c.JSON(http.StatusOK, gin.H{"search": gin.H{
		"enabled":         cfg.GetBool("search.enabled"),
		"uri":             cfg.GetString("search.uri"),
		"api_key":         cfg.GetString("search.api_key"),
		"collection_name": cfg.GetString("search.collection_name"),
		"chat": gin.H{
			"conversation_collection_name": cfg.GetString("search.chat.conversation_collection_name"),
			"model": gin.H{
				"id":        cfg.GetString("search.chat.model.id"),
				"name":      cfg.GetString("search.chat.model.name"),
				"vllm_url":  cfg.GetString("search.chat.model.vllm_url"),
				"max_bytes": cfg.GetInt("search.chat.model.max_bytes"),
			},
		},
	}})
}
