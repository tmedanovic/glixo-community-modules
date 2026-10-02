package logging

type Logger interface {
	Log(level, message string) error
}
