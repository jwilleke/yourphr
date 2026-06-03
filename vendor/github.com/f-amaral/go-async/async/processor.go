package async

import "github.com/f-amaral/go-async/sort"

// Processor is a generic interface to process asynchronously a list of inputs.
type Processor[I any, O any] interface {
	Process([]I) ProcessResult
	Close()
}

// JobResult is the result of a single job.
type JobResult struct {
	Input     any
	Output    any
	Err       error
	ExecIndex int
}

func (j JobResult) GetIndex() int {
	return j.ExecIndex
}

// ProcessResult is the result of a list of jobs, the hasError flag indicates if any job has failed.
type ProcessResult struct {
	Results  []JobResult
	HasError bool
}

// GetErrors return all errors from failed jobs, it uses HasError flag to minimize allocations on getting errors
func (p *ProcessResult) GetErrors() (errs []error) {
	if p.HasError {
		for _, r := range p.Results {
			if r.Err != nil {
				errs = append(errs, r.Err)
			}
		}
	}
	return errs
}

func (p *ProcessResult) Sort() {
	p.Results = sort.Merge(p.Results)
}
