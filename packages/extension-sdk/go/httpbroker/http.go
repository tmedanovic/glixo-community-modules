package httpbroker

import (
	"bytes"
	"errors"
	"io"
)

const (
	DefaultReadBytes    uint32 = 16 * 1024
	DefaultMaxLineBytes        = 1024 * 1024
)

type Header struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// Request mirrors glixo:http/types@3.0.0. A Broker implementation must call
// generated WIT imports; this package intentionally provides no net/http path.
type Request struct {
	URL               string   `json:"url"`
	Method            string   `json:"method"`
	Headers           []Header `json:"headers"`
	Body              []byte   `json:"body,omitempty"`
	ContentType       *string  `json:"content-type,omitempty"`
	TimeoutMS         *uint32  `json:"timeout-ms,omitempty"`
	MaxResponseBytes  *uint32  `json:"max-response-bytes,omitempty"`
	AcceptedStatusMin *uint16  `json:"accepted-status-min,omitempty"`
	AcceptedStatusMax *uint16  `json:"accepted-status-max,omitempty"`
	EndpointHandle    *string  `json:"endpoint-handle,omitempty"`
	SecretHandle      *string  `json:"secret-handle,omitempty"`
	AuthHeader        *string  `json:"auth-header,omitempty"`
	AuthScheme        *string  `json:"auth-scheme,omitempty"`
}

type Broker interface {
	HTTPStart(Request) (uint32, error)
	HTTPStatus(uint32) (uint16, error)
	HTTPResponseHeaders(uint32) ([]Header, error)
	HTTPRead(uint32, uint32) ([]byte, bool, error)
	HTTPCancel(uint32)
	HTTPDrop(uint32)
}

type Stream struct {
	broker       Broker
	handle       uint32
	pending      []byte
	maxLineBytes int
	eof          bool
	released     bool
}

func Open(broker Broker, request Request, maxLineBytes int) (*Stream, error) {
	handle, err := broker.HTTPStart(request)
	if err != nil {
		return nil, err
	}
	if maxLineBytes <= 0 {
		maxLineBytes = DefaultMaxLineBytes
	}
	return &Stream{broker: broker, handle: handle, maxLineBytes: maxLineBytes}, nil
}

func (s *Stream) Status() (uint16, error) { return s.broker.HTTPStatus(s.handle) }

func (s *Stream) ResponseHeaders() ([]Header, error) {
	return s.broker.HTTPResponseHeaders(s.handle)
}

// NextLine handles split/coalesced chunks and accepts a final record without a
// trailing newline. A nil line with io.EOF means the broker ended cleanly.
func (s *Stream) NextLine() ([]byte, error) {
	for {
		if end := bytes.IndexByte(s.pending, '\n'); end >= 0 {
			if end > s.maxLineBytes {
				return nil, errors.New("ndjson_line_too_large")
			}
			line := append([]byte(nil), s.pending[:end]...)
			s.pending = s.pending[end+1:]
			return bytes.TrimSuffix(line, []byte{'\r'}), nil
		}
		if len(s.pending) > s.maxLineBytes {
			return nil, errors.New("ndjson_line_too_large")
		}
		if s.eof {
			if len(s.pending) == 0 {
				return nil, io.EOF
			}
			line := bytes.TrimSuffix(s.pending, []byte{'\r'})
			if len(line) > s.maxLineBytes {
				return nil, errors.New("ndjson_line_too_large")
			}
			s.pending = nil
			return line, nil
		}
		chunk, more, err := s.broker.HTTPRead(s.handle, DefaultReadBytes)
		if err != nil {
			return nil, err
		}
		if !more {
			s.eof = true
			continue
		}
		s.pending = append(s.pending, chunk...)
	}
}

func (s *Stream) Cancel() {
	if !s.released {
		s.broker.HTTPCancel(s.handle)
		s.Close()
	}
}

func (s *Stream) Close() {
	if !s.released {
		s.broker.HTTPDrop(s.handle)
		s.released = true
	}
}
