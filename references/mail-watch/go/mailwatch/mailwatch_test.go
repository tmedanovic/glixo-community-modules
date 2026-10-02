package mailwatch

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/tmedanovic/glixo-community-modules/packages/extension-sdk/go/httpbroker"
	"github.com/tmedanovic/glixo-community-modules/packages/extension-sdk/go/state"
)

type fixtureBroker struct {
	responses [][]byte
	requests []httpbroker.Request
	active map[uint32][]byte
	position map[uint32]int
	cancelled []uint32
	dropped []uint32
	next uint32
}

func newFixtureBroker(values ...any) *fixtureBroker {
	broker := &fixtureBroker{active: map[uint32][]byte{}, position: map[uint32]int{}, next: 1}
	for _, value := range values { data, _ := json.Marshal(value); broker.responses = append(broker.responses, data) }
	return broker
}
func (b *fixtureBroker) HTTPStart(request httpbroker.Request) (uint32, error) {
	b.requests = append(b.requests, request)
	if len(b.responses) == 0 { return 0, errors.New("fixture_exhausted") }
	h := b.next; b.next++
	b.active[h] = b.responses[0]; b.responses = b.responses[1:]
	return h, nil
}
func (b *fixtureBroker) HTTPStatus(uint32) (uint16, error) { return 200, nil }
func (b *fixtureBroker) HTTPResponseHeaders(uint32) ([]httpbroker.Header, error) { return []httpbroker.Header{{Name:"content-type", Value:"application/json"}}, nil }
func (b *fixtureBroker) HTTPRead(handle, max uint32) ([]byte, bool, error) {
	data := b.active[handle]; pos := b.position[handle]
	if pos == len(data) { return nil, false, nil }
	end := pos + int(max); if end > len(data) { end = len(data) }
	b.position[handle] = end
	return data[pos:end], end < len(data), nil
}
func (b *fixtureBroker) HTTPCancel(handle uint32) { b.cancelled = append(b.cancelled, handle) }
func (b *fixtureBroker) HTTPDrop(handle uint32) { b.dropped = append(b.dropped, handle); delete(b.active, handle) }

type emptyState struct{}
func (emptyState) Get(string) (string, bool, error) { return "", false, nil }
func (emptyState) Set(string, string) error { return nil }
func (emptyState) List(string) ([]string, error) { return nil, nil }
func (emptyState) Delete(string) (bool, error) { return false, nil }
var _ state.Store = emptyState{}

func request(operation string, checkpoint *Checkpoint) Request {
	return Request{Kind:"backgroundServices", ContributionID:ContributionID, Configuration:&Configuration{MaxPagesPerWake:5}, Input:Input{Operation:operation, Checkpoint:checkpoint}, Context:&Context{ResourceHandles:map[string]string{"oauth":"secret-slot-lease"}}}
}

func TestInitializeSuppressesExistingMessages(t *testing.T) {
	broker := newFixtureBroker(map[string]any{"value": []any{map[string]any{"id":"old", "receivedDateTime":"2026-01-01T00:00:00Z"}}, "@odata.deltaLink":"https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=seed"})
	result, err := Handle(request("initialize", nil), broker, emptyState{})
	if err != nil { t.Fatal(err) }
	if !result.Checkpoint.Initialized || len(result.Events) != 0 { t.Fatalf("initial result = %#v", result) }
	if broker.requests[0].SecretHandle == nil || *broker.requests[0].SecretHandle != "oauth" || broker.requests[0].Method != "GET" || len(broker.requests[0].Body) != 0 { t.Fatalf("request = %#v", broker.requests[0]) }
	if len(broker.dropped) != 1 || len(broker.cancelled) != 0 { t.Fatalf("release = %#v %#v", broker.dropped, broker.cancelled) }
}

func TestWakePaginatesAndEmitsMetadataWithStableKey(t *testing.T) {
	message := map[string]any{"id":"AAMkAGI1", "receivedDateTime":"2026-10-01T10:00:00Z", "from":map[string]any{"emailAddress":map[string]any{"address":"sender@example.test"}}, "body":map[string]any{"content":"never emitted"}}
	next := "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=opaque"
	delta := "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=opaque"
	broker := newFixtureBroker(map[string]any{"value":[]any{message}, "@odata.nextLink":next}, map[string]any{"value":[]any{message}, "@odata.deltaLink":delta})
	checkpoint := &Checkpoint{Initialized:true, DeltaURL:"https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=prior"}
	result, err := Handle(request("wake", checkpoint), broker, emptyState{})
	if err != nil { t.Fatal(err) }
	if result.Checkpoint.DeltaURL != delta || len(result.Events) != 2 || result.Events[0].IdempotencyKey != result.Events[1].IdempotencyKey { t.Fatalf("result = %#v", result) }
	if result.Events[0].Type != EventType || result.Events[0].Payload.Sender != "sender@example.test" { t.Fatalf("event = %#v", result.Events[0]) }
	encoded, _ := json.Marshal(result.Events)
	if strings.Contains(string(encoded), "never emitted") || strings.Contains(string(encoded), "subject") { t.Fatalf("overscoped event: %s", encoded) }
	if len(broker.requests) != 2 || broker.requests[1].URL != next { t.Fatalf("requests = %#v", broker.requests) }
}

func TestUnsafeNextLinkIsRejectedBeforeRequest(t *testing.T) {
	broker := newFixtureBroker(map[string]any{"value":[]any{}, "@odata.nextLink":"https://evil.example/v1.0/me/mailFolders/inbox/messages/delta"})
	_, err := Handle(request("wake", &Checkpoint{Initialized:true, DeltaURL:initialDeltaURL}), broker, emptyState{})
	if err == nil || !strings.Contains(err.Error(), "outside_scope") { t.Fatalf("error = %v", err) }
	if len(broker.requests) != 1 || len(broker.dropped) != 1 { t.Fatalf("request/release counts = %d/%d", len(broker.requests), len(broker.dropped)) }
}

func TestHealthAndStopNeedNoOAuthLease(t *testing.T) {
	for _, operation := range []string{"health", "stop"} {
		result, err := Handle(Request{Kind:"backgroundServices", ContributionID:ContributionID, Input:Input{Operation:operation}}, newFixtureBroker(), emptyState{})
		if err != nil || len(result.Events) != 0 { t.Fatalf("%s: %#v %v", operation, result, err) }
	}
}

func TestGraphCursorScope(t *testing.T) {
	for _, value := range []string{"http://graph.microsoft.com"+graphPath, "https://evil.example"+graphPath, "https://graph.microsoft.com.evil.example"+graphPath, "https://user@graph.microsoft.com"+graphPath, "https://graph.microsoft.com:444"+graphPath, "https://graph.microsoft.com/v1.0/me/messages"} {
		if _, err := ValidateGraphDeltaURL(value); err == nil { t.Errorf("accepted %q", value) }
	}
}
