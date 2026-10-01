package export_glixo_contribution_guest

import (
	"encoding/json"
	"fmt"

	"github.com/glixo-community/glixo-contribution-guest-go/generated/wit/glixo_contribution_broker"
	"github.com/glixo-community/glixo-contribution-guest-go/generated/wit/glixo_http_broker"
	withttp "github.com/glixo-community/glixo-contribution-guest-go/generated/wit/glixo_http_types"
	"github.com/glixo-community/glixo-contribution-guest-go/mailwatch"
	"github.com/glixo/extension-sdk-go/httpbroker"
	"github.com/glixo/extension-sdk-go/state"
	abitypes "go.bytecodealliance.org/pkg/wit/types"
)

type hostBroker struct{}

func (hostBroker) HTTPStart(request httpbroker.Request) (uint32, error) {
	headers := make([]withttp.Header, 0, len(request.Headers))
	for _, header := range request.Headers {
		headers = append(headers, withttp.Header{Name: header.Name, Value: header.Value})
	}
	body := abitypes.None[[]uint8]()
	if request.Body != nil {
		body = abitypes.Some(request.Body)
	}
	toString := func(value *string) abitypes.Option[string] {
		if value == nil {
			return abitypes.None[string]()
		}
		return abitypes.Some(*value)
	}
	toU32 := func(value *uint32) abitypes.Option[uint32] {
		if value == nil {
			return abitypes.None[uint32]()
		}
		return abitypes.Some(*value)
	}
	toU16 := func(value *uint16) abitypes.Option[uint16] {
		if value == nil {
			return abitypes.None[uint16]()
		}
		return abitypes.Some(*value)
	}
	witRequest := withttp.HttpRequest{
		Url: request.URL, Method: request.Method, Headers: headers, Body: body,
		ContentType: toString(request.ContentType), TimeoutMs: toU32(request.TimeoutMS),
		MaxResponseBytes:  toU32(request.MaxResponseBytes),
		AcceptedStatusMin: toU16(request.AcceptedStatusMin), AcceptedStatusMax: toU16(request.AcceptedStatusMax),
		EndpointHandle: toString(request.EndpointHandle), SecretHandle: toString(request.SecretHandle),
		AuthHeader: toString(request.AuthHeader), AuthScheme: toString(request.AuthScheme),
	}
	result := glixo_http_broker.HttpStart(witRequest)
	if result.IsErr() {
		return 0, fmt.Errorf("%s", result.Err())
	}
	return result.Ok(), nil
}

func (hostBroker) HTTPStatus(handle uint32) (uint16, error) {
	result := glixo_http_broker.HttpStatus(handle)
	if result.IsErr() {
		return 0, fmt.Errorf("%s", result.Err())
	}
	return result.Ok(), nil
}

func (hostBroker) HTTPResponseHeaders(handle uint32) ([]httpbroker.Header, error) {
	result := glixo_http_broker.HttpResponseHeaders(handle)
	if result.IsErr() {
		return nil, fmt.Errorf("%s", result.Err())
	}
	generated := result.Ok()
	headers := make([]httpbroker.Header, 0, len(generated))
	for _, header := range generated {
		headers = append(headers, httpbroker.Header{Name: header.Name, Value: header.Value})
	}
	return headers, nil
}

func (hostBroker) HTTPRead(handle, maxBytes uint32) ([]byte, bool, error) {
	result := glixo_http_broker.HttpRead(handle, maxBytes)
	if result.IsErr() {
		return nil, false, fmt.Errorf("%s", result.Err())
	}
	chunk := result.Ok()
	if chunk.IsNone() {
		return nil, false, nil
	}
	return chunk.Some(), true, nil
}

func (hostBroker) HTTPCancel(handle uint32) { glixo_http_broker.HttpCancel(handle) }
func (hostBroker) HTTPDrop(handle uint32)   { glixo_http_broker.HttpDrop(handle) }

type hostState struct{}

func (hostState) Get(key string) (string, bool, error) {
	result := glixo_contribution_broker.StateGet(key)
	if result.IsErr() {
		return "", false, fmt.Errorf("%s", result.Err())
	}
	value := result.Ok()
	if value.IsNone() {
		return "", false, nil
	}
	return value.Some(), true, nil
}

func (hostState) Set(key, value string) error {
	result := glixo_contribution_broker.StateSet(key, value)
	if result.IsErr() {
		return fmt.Errorf("%s", result.Err())
	}
	return nil
}

func (hostState) List(prefix string) ([]string, error) {
	result := glixo_contribution_broker.StateList(prefix)
	if result.IsErr() {
		return nil, fmt.Errorf("%s", result.Err())
	}
	return result.Ok(), nil
}

func (hostState) Delete(key string) (bool, error) {
	result := glixo_contribution_broker.StateDelete(key)
	if result.IsErr() {
		return false, fmt.Errorf("%s", result.Err())
	}
	return result.Ok(), nil
}

// Invoke adapts the generic contribution WIT JSON envelope to the shared handler.
func Invoke(requestJSON string) abitypes.Result[string, string] {
	var request mailwatch.Request
	if err := json.Unmarshal([]byte(requestJSON), &request); err != nil {
		return abitypes.Err[string, string]("guest_request_invalid")
	}
	result, err := mailwatch.Handle(request, hostBroker{}, hostState{})
	if err != nil {
		message := err.Error()
		if len(message) > 240 {
			message = message[:240]
		}
		_ = glixo_contribution_broker.Log("error", message)
		return abitypes.Err[string, string](message)
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return abitypes.Err[string, string]("guest_response_invalid")
	}
	return abitypes.Ok[string, string](string(encoded))
}

// Keep the generated WIT package types in the source-level adapter contract.
var _ state.Store = hostState{}
