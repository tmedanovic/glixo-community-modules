package workspace

type Reader interface {
	Search(handle, query string, limit uint32) (string, error)
	Read(handle, path string, maxBytes uint32) (string, error)
}
