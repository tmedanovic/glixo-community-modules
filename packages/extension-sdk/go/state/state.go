package state

type Store interface {
	Get(key string) (string, bool, error)
	Set(key, value string) error
	List(prefix string) ([]string, error)
	Delete(key string) (bool, error)
}
