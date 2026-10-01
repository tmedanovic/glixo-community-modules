package mailwatch

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"net/url"
	"strings"

	"github.com/glixo/extension-sdk-go/httpbroker"
	"github.com/glixo/extension-sdk-go/state"
)

const (
	ReferenceID = "mail-watch"
	ContributionID = "mail-watch"
	EventType = "mail.received"
	graphHost = "graph.microsoft.com"
	graphPath = "/v1.0/me/mailFolders/inbox/messages/delta"
	initialDeltaURL = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=id,receivedDateTime,from&$top=10"
	maxPagesPerWake = 5
	maxPageBytes = 1_000_000
)

type Checkpoint struct {
	Initialized bool `json:"initialized,omitempty"`
	Initializing bool `json:"initializing,omitempty"`
	DeltaURL string `json:"deltaUrl,omitempty"`
	PendingURL string `json:"pendingUrl,omitempty"`
}

type Configuration struct {
	MaxPagesPerWake int `json:"maxPagesPerWake"`
}

type Input struct {
	Operation string `json:"operation"`
	Checkpoint *Checkpoint `json:"checkpoint,omitempty"`
}

type Context struct {
	ResourceHandles map[string]string `json:"resourceHandles,omitempty"`
}

type Request struct {
	Kind string `json:"kind"`
	ContributionID string `json:"contributionId"`
	Configuration *Configuration `json:"configuration,omitempty"`
	Input Input `json:"input"`
	Context *Context `json:"context,omitempty"`
}

type Payload struct {
	MessageID string `json:"messageId"`
	ReceivedAt string `json:"receivedAt"`
	Sender string `json:"sender,omitempty"`
}

type Event struct {
	Type string `json:"type"`
	IdempotencyKey string `json:"idempotencyKey"`
	Payload Payload `json:"payload"`
}

type Result struct {
	Checkpoint Checkpoint `json:"checkpoint"`
	Events []Event `json:"events"`
	Health string `json:"health"`
}

type graphDocument struct {
	Value []json.RawMessage `json:"value"`
	NextLink *string `json:"@odata.nextLink"`
	DeltaLink *string `json:"@odata.deltaLink"`
}

type graphMessage struct {
	ID string `json:"id"`
	ReceivedDateTime string `json:"receivedDateTime"`
	From struct { EmailAddress struct { Address string `json:"address"` } `json:"emailAddress"` } `json:"from"`
	Removed json.RawMessage `json:"@removed"`
}

// docs:snippet-start mail-watch-handler:go
// Handle performs a bounded Inbox delta read with the host's scoped HTTP broker.
// It never reads message bodies, sends mail, or selects a non-Graph origin.
func Handle(request Request, broker httpbroker.Broker, _ state.Store) (Result, error) {
	if request.Kind != "backgroundServices" || request.ContributionID != ContributionID {
		return Result{}, errors.New("contribution_mismatch")
	}
	operation := request.Input.Operation
	if operation != "initialize" && operation != "wake" && operation != "health" && operation != "stop" {
		return Result{}, errors.New("service_operation_invalid")
	}
	checkpoint := Checkpoint{}
	if request.Input.Checkpoint != nil { checkpoint = *request.Input.Checkpoint }
	if operation == "health" || operation == "stop" {
		return healthy(checkpoint), nil
	}
	if request.Context == nil || request.Context.ResourceHandles["oauth"] == "" {
		return Result{}, errors.New("graph_oauth_lease_missing")
	}
	pageLimit := maxPagesPerWake
	if request.Configuration != nil {
		pageLimit = request.Configuration.MaxPagesPerWake
	}
	if pageLimit < 1 || pageLimit > maxPagesPerWake {
		return Result{}, errors.New("mail_watch_page_limit_invalid")
	}
	initializing := operation == "initialize" || checkpoint.Initializing || !checkpoint.Initialized
	cursor := checkpoint.PendingURL
	if cursor == "" { cursor = checkpoint.DeltaURL }
	if cursor == "" { cursor = initialDeltaURL }
	deltaURL := checkpoint.DeltaURL
	pendingURL := ""
	events := make([]Event, 0)
	for page := 0; page < pageLimit; page++ {
		validated, err := ValidateGraphDeltaURL(cursor)
		if err != nil { return Result{}, err }
		document, err := readGraphJSON(broker, httpbroker.Request{
			URL: validated, Method: "GET", Headers: []httpbroker.Header{{Name: "Accept", Value: "application/json"}},
			TimeoutMS: u32(5000), MaxResponseBytes: u32(maxPageBytes), AcceptedStatusMin: u16(200), AcceptedStatusMax: u16(299),
			SecretHandle: str("oauth"), AuthHeader: str("Authorization"), AuthScheme: str("Bearer"),
		})
		if err != nil { return Result{}, err }
		var response graphDocument
		if err := json.Unmarshal(document, &response); err != nil || response.Value == nil {
			return Result{}, errors.New("graph_delta_value_invalid")
		}
		if !initializing {
			for _, raw := range response.Value {
				var message graphMessage
				if err := json.Unmarshal(raw, &message); err != nil || message.Removed != nil || message.ID == "" || message.ReceivedDateTime == "" { continue }
				sender := message.From.EmailAddress.Address
				if len(sender) > 320 { sender = sender[:320] }
				payload := Payload{MessageID: message.ID, ReceivedAt: message.ReceivedDateTime, Sender: sender}
				events = append(events, Event{Type: EventType, IdempotencyKey: "mail:" + stableID(message.ID), Payload: payload})
			}
		}
		if response.NextLink != nil {
			cursor = *response.NextLink
			if _, err := ValidateGraphDeltaURL(cursor); err != nil { return Result{}, err }
			pendingURL = *response.NextLink
			continue
		}
		if response.DeltaLink == nil { return Result{}, errors.New("graph_delta_link_missing") }
		deltaURL, err = ValidateGraphDeltaURL(*response.DeltaLink)
		if err != nil { return Result{}, err }
		pendingURL = ""
		initializing = false
		break
	}
	if pendingURL == "" && initializing { return Result{}, errors.New("graph_initial_sync_incomplete") }
	return Result{Checkpoint: Checkpoint{Initialized: !initializing, Initializing: initializing, DeltaURL: deltaURL, PendingURL: pendingURL}, Events: events, Health: "healthy"}, nil
}
// docs:snippet-end mail-watch-handler:go

func ValidateGraphDeltaURL(value string) (string, error) {
	u, err := url.Parse(value)
	if err != nil || u == nil { return "", errors.New("graph_delta_url_invalid") }
	if !strings.EqualFold(u.Scheme, "https") || !strings.EqualFold(u.Hostname(), graphHost) || (u.Port() != "" && u.Port() != "443") || u.User != nil || u.Fragment != "" || !strings.EqualFold(u.EscapedPath(), graphPath) {
		return "", errors.New("graph_delta_url_outside_scope")
	}
	return value, nil
}

func readGraphJSON(broker httpbroker.Broker, request httpbroker.Request) ([]byte, error) {
	handle, err := broker.HTTPStart(request)
	if err != nil { return nil, err }
	complete := false
	defer func() {
		if !complete { broker.HTTPCancel(handle) }
		broker.HTTPDrop(handle)
	}()
	status, err := broker.HTTPStatus(handle)
	if err != nil { return nil, err }
	if status < 200 || status > 299 { return nil, errors.New("graph_http_status_rejected") }
	if _, err := broker.HTTPResponseHeaders(handle); err != nil { return nil, err }
	var body bytes.Buffer
	for {
		chunk, more, err := broker.HTTPRead(handle, 16*1024)
		if err != nil { return nil, err }
		if body.Len()+len(chunk) > maxPageBytes { return nil, errors.New("graph_response_too_large") }
		_, _ = body.Write(chunk)
		if !more { break }
	}
	if !json.Valid(body.Bytes()) { return nil, errors.New("graph_response_invalid") }
	complete = true
	return append([]byte(nil), body.Bytes()...), nil
}

func stableID(value string) string { h := fnv.New64a(); _, _ = h.Write([]byte(value)); return fmt.Sprintf("%016x", h.Sum64()) }
func healthy(checkpoint Checkpoint) Result { return Result{Checkpoint: checkpoint, Events: []Event{}, Health: "healthy"} }
func str(value string) *string { return &value }
func u32(value uint32) *uint32 { return &value }
func u16(value uint16) *uint16 { return &value }
