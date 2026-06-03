package pool

import (
	"github.com/f-amaral/go-async/async"
)

type JobFn[I any, O any] func(I) (O, error)

type jobParams[I any] struct {
	input     I
	resultsCh chan async.JobResult
	execIndex int
}

type jobPool[I any, O any] struct {
	jobCh chan<- jobParams[I]
	sort  bool
}

func (s *jobParams[I]) GetIndex() int {
	return s.execIndex
}

type option[I any, O any] func(*jobPool[I, O])

func NewPool[I any, O any](workers int, jobFunc JobFn[I, O], options ...option[I, O]) async.Processor[I, O] {
	jobs := make(chan jobParams[I], workers)

	for w := 0; w < workers; w++ {
		go func() {
			for params := range jobs {
				output, err := jobFunc(params.input)
				params.resultsCh <- async.JobResult{
					Input:     params.input,
					Output:    output,
					Err:       err,
					ExecIndex: params.GetIndex(),
				}
			}
		}()
	}

	p := &jobPool[I, O]{
		jobCh: jobs,
	}

	for _, opt := range options {
		opt(p)
	}
	return p
}

func WithSortingOutput[I any, O any]() option[I, O] {
	return func(p *jobPool[I, O]) {
		p.sort = true
	}
}

func (s *jobPool[I, O]) Process(inputs []I) async.ProcessResult {
	results := make(chan async.JobResult, len(inputs))
	for executionIndex, input := range inputs {
		s.jobCh <- jobParams[I]{
			input:     input,
			resultsCh: results,
			execIndex: executionIndex,
		}
	}

	defer func() {
		close(results)
	}()

	output := async.ProcessResult{
		Results:  make([]async.JobResult, 0),
		HasError: false,
	}

	for range inputs {
		result := <-results
		if result.Err != nil {
			output.HasError = true
		}
		output.Results = append(output.Results, result)
	}

	if s.sort {
		output.Sort()
	}

	return output

}

func (s *jobPool[I, O]) Close() {
	close(s.jobCh)
}
