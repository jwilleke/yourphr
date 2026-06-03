package deepmerge

import (
	"gopkg.in/yaml.v3"
)

// YAML merges the contents of src into dst
func YAML(dst, src []byte, optionalConfig ...Config) ([]byte, error) {
	var cfg Config
	if len(optionalConfig) > 0 {
		cfg = optionalConfig[0]
	} else {
		cfg = Config{PreventMultipleDefinitionsOfKeysWithPrimitiveValue: true}
	}
	var dstMap, srcMap map[string]interface{}
	err := yaml.Unmarshal(dst, &dstMap)
	if err != nil {
		return nil, err
	}
	err = yaml.Unmarshal(src, &srcMap)
	if err != nil {
		return nil, err
	}
	if dstMap == nil {
		dstMap = make(map[string]interface{})
	}
	if err = DeepMerge(dstMap, srcMap, cfg); err != nil {
		return nil, err
	}
	return yaml.Marshal(dstMap)
}
