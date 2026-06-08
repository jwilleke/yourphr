package database

import (
	"fmt"
	"sync"

	goja "github.com/dop251/goja"
)

// The fhirpath.min.js library is ~602KB. Compiling it (and searchParameterExtractor.js) is the
// expensive part of search-parameter extraction, and it used to run once *per resource* inside every
// generated PopulateAndExtractSearchParameters — so importing an N-resource bundle compiled the
// library N times. We compile both programs exactly once, package-wide, and reuse the immutable
// *goja.Program for every resource. See #151.
//
// We still create a fresh goja.Runtime per call: goja.Runtime is not safe for concurrent use and the
// extractor binds per-resource globals (`window`, `fhirResource`). Reusing/pooling VMs is a possible
// further optimization but risks state leaking between resources, so it is intentionally not done here.
var (
	extractorProgramsOnce sync.Once
	fhirPathProgram       *goja.Program
	searchParamProgram    *goja.Program
	extractorProgramsErr  error
)

func compiledExtractorPrograms() (*goja.Program, *goja.Program, error) {
	extractorProgramsOnce.Do(func() {
		if len(fhirPathJs) == 0 {
			extractorProgramsErr = fmt.Errorf("fhirPathJs script is empty")
			return
		}
		fhirPathProgram, extractorProgramsErr = goja.Compile("fhirpath.min.js", fhirPathJs, true)
		if extractorProgramsErr != nil {
			return
		}
		searchParamProgram, extractorProgramsErr = goja.Compile("searchParameterExtractor.js", searchParameterExtractorJs, true)
	})
	return fhirPathProgram, searchParamProgram, extractorProgramsErr
}

// newSearchParameterExtractorVM returns a goja runtime with the fhirpath + searchParameterExtractor
// libraries loaded (from the cached compiled programs) and the given resource bound as the global
// `fhirResource`, ready to run extractTokenSearchParameters(...) etc.
func newSearchParameterExtractorVM(resourceRawMap map[string]interface{}) (*goja.Runtime, error) {
	fhirPathProg, searchParamProg, err := compiledExtractorPrograms()
	if err != nil {
		return nil, err
	}

	vm := goja.New()
	// setup the global window object
	vm.Set("window", vm.NewObject())
	// set the global FHIR Resource object
	vm.Set("fhirResource", resourceRawMap)

	// load the fhirpath library
	if _, err := vm.RunProgram(fhirPathProg); err != nil {
		return nil, err
	}
	// load the searchParametersExtractor library
	if _, err := vm.RunProgram(searchParamProg); err != nil {
		return nil, err
	}
	return vm, nil
}
