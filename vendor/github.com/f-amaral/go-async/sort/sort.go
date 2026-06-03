package sort

type Sortable interface {
	GetIndex() int
}

func Merge[T Sortable](arr []T) []T {
	if len(arr) < 2 {
		return arr
	}

	left := arr[:len(arr)/2]
	right := arr[len(arr)/2:]

	sortedLeft := Merge(left)
	sortedRight := Merge(right)

	return mergeArrays(sortedLeft, sortedRight)
}

func mergeArrays[T Sortable](a []T, b []T) []T {
	var merged []T

	i := 0
	j := 0
	for i < len(a) && j < len(b) {
		if a[i].GetIndex() < b[j].GetIndex() {
			merged = append(merged, a[i])
			i++
		} else {
			merged = append(merged, b[j])
			j++
		}
	}

	for ; i < len(a); i++ {
		merged = append(merged, a[i])
	}

	for ; j < len(b); j++ {
		merged = append(merged, b[j])
	}

	return merged
}
