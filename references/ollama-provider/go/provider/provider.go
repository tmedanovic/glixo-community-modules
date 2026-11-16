package provider

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/glixo-community/ollama-provider-go/generated/wit/glixo_http_broker"
	"github.com/glixo-community/ollama-provider-go/generated/wit/glixo_http_types"
	"github.com/glixo-community/ollama-provider-go/generated/wit/glixo_llm_types_types"
	"github.com/tmedanovic/glixo-community-modules/packages/extension-sdk/go/httpbroker"
	types "go.bytecodealliance.org/pkg/wit/types"
)

type brokerAdapter struct{}

func (brokerAdapter) HTTPStart(r httpbroker.Request) (uint32, error) {
	hs := make([]glixo_http_types.Header, 0, len(r.Headers))
	for _, h := range r.Headers {
		hs = append(hs, glixo_http_types.Header{Name: h.Name, Value: h.Value})
	}
	optS := func(p *string) types.Option[string] {
		if p == nil {
			return types.None[string]()
		}
		return types.Some(*p)
	}
	opt32 := func(p *uint32) types.Option[uint32] {
		if p == nil {
			return types.None[uint32]()
		}
		return types.Some(*p)
	}
	opt16 := func(p *uint16) types.Option[uint16] {
		if p == nil {
			return types.None[uint16]()
		}
		return types.Some(*p)
	}
	body := types.None[[]uint8]()
	if r.Body != nil {
		body = types.Some[[]uint8](r.Body)
	}
	x := glixo_http_broker.HttpStart(glixo_http_types.HttpRequest{Url: r.URL, Method: r.Method, Headers: hs, Body: body, ContentType: optS(r.ContentType), TimeoutMs: opt32(r.TimeoutMS), MaxResponseBytes: opt32(r.MaxResponseBytes), AcceptedStatusMin: opt16(r.AcceptedStatusMin), AcceptedStatusMax: opt16(r.AcceptedStatusMax), EndpointHandle: optS(r.EndpointHandle), SecretHandle: optS(r.SecretHandle), AuthHeader: optS(r.AuthHeader), AuthScheme: optS(r.AuthScheme)})
	if x.IsErr() {
		return 0, fmt.Errorf("%s", x.Err())
	}
	return x.Ok(), nil
}
func (brokerAdapter) HTTPStatus(h uint32) (uint16, error) {
	x := glixo_http_broker.HttpStatus(h)
	if x.IsErr() {
		return 0, fmt.Errorf("%s", x.Err())
	}
	return x.Ok(), nil
}
func (brokerAdapter) HTTPResponseHeaders(h uint32) ([]httpbroker.Header, error) {
	x := glixo_http_broker.HttpResponseHeaders(h)
	if x.IsErr() {
		return nil, fmt.Errorf("%s", x.Err())
	}
	out := []httpbroker.Header{}
	for _, v := range x.Ok() {
		out = append(out, httpbroker.Header{Name: v.Name, Value: v.Value})
	}
	return out, nil
}
func (brokerAdapter) HTTPRead(h, n uint32) ([]byte, bool, error) {
	x := glixo_http_broker.HttpRead(h, n)
	if x.IsErr() {
		return nil, false, fmt.Errorf("%s", x.Err())
	}
	if x.Ok().IsNone() {
		return nil, false, nil
	}
	return x.Ok().Some(), true, nil
}
func (brokerAdapter) HTTPCancel(h uint32) { glixo_http_broker.HttpCancel(h) }
func (brokerAdapter) HTTPDrop(h uint32)   { glixo_http_broker.HttpDrop(h) }

type ctx = glixo_llm_types_types.ProviderContext
type request = glixo_llm_types_types.LlmRequest

const defaultContextWindowTokens = 8192
const maximumContextWindowTokens = 32768

type session struct {
	stream              *httpbroker.Stream
	requestID           string
	terminal, cancelled bool
	toolIndex           uint32
	toolCallsSeen       bool
	pending             []pendingEvent
}

type pendingEvent struct {
	event    glixo_llm_types_types.ProviderEvent
	terminal bool
}

var sessions = struct {
	sync.Mutex
	next  atomic.Uint32
	items map[uint32]*session
}{items: map[uint32]*session{}}

func ptr[T any](x T) *T                             { return &x }
func optErr[T any](e error) types.Result[T, string] { return types.Err[T, string](e.Error()) }
func contextWindowTokens(cfg map[string]any) (int, error) {
	raw, ok := cfg["contextWindowTokens"]
	if !ok {
		return defaultContextWindowTokens, nil
	}
	value, ok := raw.(float64)
	if !ok || math.Trunc(value) != value || value < 1 || value > maximumContextWindowTokens {
		return 0, fmt.Errorf("context_window_tokens_must_be_between_1_and_32768")
	}
	return int(value), nil
}

func cfgEndpoint(c ctx) (map[string]any, glixo_http_types.EndpointGrant, error) {
	var cfg map[string]any
	if json.Unmarshal([]byte(c.ConfigurationJson), &cfg) != nil || cfg == nil {
		return nil, glixo_http_types.EndpointGrant{}, fmt.Errorf("configuration_json_invalid")
	}
	if cfg["endpointName"] != "ollama" {
		return nil, glixo_http_types.EndpointGrant{}, fmt.Errorf("endpointName_must_be_ollama")
	}
	if m, ok := cfg["model"]; ok {
		if s, ok := m.(string); !ok || strings.TrimSpace(s) == "" {
			return nil, glixo_http_types.EndpointGrant{}, fmt.Errorf("model_must_be_nonempty_string")
		}
	}
	if _, err := contextWindowTokens(cfg); err != nil {
		return nil, glixo_http_types.EndpointGrant{}, err
	}
	var ep *glixo_http_types.EndpointGrant
	for i := range c.Endpoints {
		if c.Endpoints[i].Name == "ollama" && c.Endpoints[i].Handle != "" {
			ep = &c.Endpoints[i]
			break
		}
	}
	if ep == nil {
		return nil, glixo_http_types.EndpointGrant{}, fmt.Errorf("approved_ollama_endpoint_missing")
	}
	base := strings.TrimSuffix(ep.BaseUrl, "/")
	if !(strings.HasPrefix(base, "http://") || strings.HasPrefix(base, "https://")) || strings.ContainsAny(base, "?#") || strings.Contains(strings.TrimPrefix(strings.TrimPrefix(base, "http://"), "https://"), "/") {
		return nil, glixo_http_types.EndpointGrant{}, fmt.Errorf("approved_ollama_base_url_invalid")
	}
	ep.BaseUrl = base
	return cfg, *ep, nil
}
func reqHTTP(ep glixo_http_types.EndpointGrant, path, method string, body []byte) httpbroker.Request {
	r := httpbroker.Request{URL: ep.BaseUrl + path, Method: method, Headers: []httpbroker.Header{{Name: "accept", Value: "application/json"}}, TimeoutMS: ptr(uint32(30000)), MaxResponseBytes: ptr(uint32(8 << 20)), AcceptedStatusMin: ptr(uint16(200)), AcceptedStatusMax: ptr(uint16(299)), EndpointHandle: ptr(ep.Handle)}
	if body != nil {
		r.Body = body
		r.ContentType = ptr("application/json")
	}
	return r
}
func readJSON(ep glixo_http_types.EndpointGrant, path, method string, body any) (any, error) {
	var b []byte
	var e error
	if body != nil {
		b, e = json.Marshal(body)
		if e != nil {
			return nil, e
		}
	}
	s, e := httpbroker.Open(brokerAdapter{}, reqHTTP(ep, path, method, b), 1<<20)
	if e != nil {
		return nil, e
	}
	defer s.Close()
	status, e := s.Status()
	if e != nil {
		return nil, e
	}
	if status < 200 || status > 299 {
		return nil, fmt.Errorf("ollama_http_%d", status)
	}
	var all bytes.Buffer
	for {
		line, e := s.NextLine()
		if e == io.EOF {
			break
		}
		if e != nil {
			return nil, e
		}
		if all.Len()+len(line)+1 > 8<<20 {
			return nil, fmt.Errorf("ollama_response_too_large")
		}
		all.Write(line)
		all.WriteByte('\n')
	}
	var v any
	if json.Unmarshal(all.Bytes(), &v) != nil {
		return nil, fmt.Errorf("ollama_json_invalid")
	}
	return v, nil
}
func list(ep glixo_http_types.EndpointGrant) ([]string, error) {
	v, e := readJSON(ep, "/api/tags", "GET", nil)
	if e != nil {
		return nil, e
	}
	o, ok := v.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("ollama_tags_invalid")
	}
	a, ok := o["models"].([]any)
	if !ok {
		return nil, fmt.Errorf("ollama_tags_invalid")
	}
	r := []string{}
	for _, x := range a {
		m, _ := x.(map[string]any)
		n, _ := m["name"].(string)
		if n == "" {
			n, _ = m["model"].(string)
		}
		if n != "" {
			r = append(r, n)
		}
	}
	return r, nil
}
func caps(ep glixo_http_types.EndpointGrant, model string) (map[string]bool, error) {
	v, e := readJSON(ep, "/api/show", "POST", map[string]string{"model": model})
	if e != nil {
		return nil, e
	}
	m, ok := v.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("ollama_show_invalid")
	}
	r := map[string]bool{}
	if a, ok := m["capabilities"].([]any); ok {
		for _, x := range a {
			if s, ok := x.(string); ok {
				r[s] = true
			}
		}
	}
	return r, nil
}
func chatMessages(r request, c map[string]bool) ([]any, error) {
	out := []any{}
	pendingTools := map[string]string{}
	for _, m := range r.Messages {
		var text strings.Builder
		images := []string{}
		toolCalls := []any{}
		toolName := ""
		for _, p := range m.Parts {
			switch p.Tag() {
			case glixo_llm_types_types.ContentPartText:
				text.WriteString(p.Text())
			case glixo_llm_types_types.ContentPartToolResult:
				if m.Role != "tool" || toolName != "" {
					return nil, fmt.Errorf("tool_result_requires_tool_message")
				}
				var result map[string]json.RawMessage
				if json.Unmarshal([]byte(p.ToolResult()), &result) != nil {
					return nil, fmt.Errorf("tool_result_invalid")
				}
				var id string
				if json.Unmarshal(result["id"], &id) != nil || id == "" || result["result"] == nil {
					return nil, fmt.Errorf("tool_result_invalid")
				}
				name, ok := pendingTools[id]
				if !ok {
					return nil, fmt.Errorf("tool_result_call_id_unmatched")
				}
				delete(pendingTools, id)
				var resultText string
				if json.Unmarshal(result["result"], &resultText) != nil {
					resultText = string(result["result"])
				}
				text.WriteString(resultText)
				toolName = name
			case glixo_llm_types_types.ContentPartToolCallDetails:
				if m.Role != "assistant" {
					return nil, fmt.Errorf("tool_call_requires_assistant_role")
				}
				call := p.ToolCallDetails()
				if !call.Complete || call.Id == "" || call.Name == "" {
					return nil, fmt.Errorf("tool_call_details_invalid")
				}
				if _, ok := pendingTools[call.Id]; ok {
					return nil, fmt.Errorf("tool_call_id_duplicate")
				}
				argsText := "{}"
				if call.ArgumentsFragment.IsSome() {
					argsText = call.ArgumentsFragment.Some()
				}
				var args map[string]any
				if json.Unmarshal([]byte(argsText), &args) != nil || args == nil {
					return nil, fmt.Errorf("tool_call_arguments_invalid")
				}
				pendingTools[call.Id] = call.Name
				toolCalls = append(toolCalls, map[string]any{"type": "function", "function": map[string]any{"index": len(toolCalls), "name": call.Name, "arguments": args}})
			case glixo_llm_types_types.ContentPartReasoning:
				text.WriteString(p.Reasoning())
			case glixo_llm_types_types.ContentPartMediaRef:
				v := p.MediaRef()
				idx := strings.Index(v, ";base64,")
				if !c["vision"] {
					return nil, fmt.Errorf("model_does_not_support_vision")
				}
				if !strings.HasPrefix(v, "data:image/") || idx < 0 {
					return nil, fmt.Errorf("vision_requires_base64_image_data_uri")
				}
				b64 := v[idx+8:]
				if _, e := base64.StdEncoding.DecodeString(b64); e != nil {
					return nil, fmt.Errorf("vision_image_data_invalid")
				}
				images = append(images, b64)
			case glixo_llm_types_types.ContentPartAnnotation, glixo_llm_types_types.ContentPartCitation:
			default:
				return nil, fmt.Errorf("unsupported_message_part")
			}
		}
		item := map[string]any{"role": m.Role, "content": text.String()}
		if len(toolCalls) > 0 {
			item["tool_calls"] = toolCalls
		}
		if toolName != "" {
			item["tool_name"] = toolName
		}
		if m.Role == "tool" && toolName == "" {
			return nil, fmt.Errorf("tool_message_result_missing")
		}
		if len(images) > 0 {
			item["images"] = images
		}
		out = append(out, item)
	}
	return out, nil
}
func chatBody(r request, c map[string]bool, contextWindowTokens int) (map[string]any, error) {
	if r.Model == "" {
		return nil, fmt.Errorf("model_required")
	}
	if len(r.Tools) > 0 && !c["tools"] {
		return nil, fmt.Errorf("model_does_not_support_tools")
	}
	msgs, e := chatMessages(r, c)
	if e != nil {
		return nil, e
	}
	body := map[string]any{"model": r.Model, "messages": msgs, "stream": true}
	if len(r.Tools) > 0 {
		ts := []any{}
		for _, t := range r.Tools {
			var schema any
			if json.Unmarshal([]byte(t.SchemaJson), &schema) != nil {
				return nil, fmt.Errorf("tool_schema_json_invalid")
			}
			ts = append(ts, map[string]any{"type": "function", "function": map[string]any{"name": t.Name, "description": t.Description, "parameters": schema}})
		}
		body["tools"] = ts
	}
	if r.ResponseFormat.IsSome() {
		f := r.ResponseFormat.Some()
		if f.Kind == "json" {
			if f.SchemaJson.IsSome() {
				var s any
				if json.Unmarshal([]byte(f.SchemaJson.Some()), &s) != nil {
					return nil, fmt.Errorf("response_schema_invalid")
				}
				body["format"] = s
			} else {
				body["format"] = "json"
			}
		} else if f.Kind != "text" {
			return nil, fmt.Errorf("response_format_unsupported")
		}
	}
	o := map[string]any{"num_ctx": contextWindowTokens}
	if r.Sampling.IsSome() {
		s := r.Sampling.Some()
		if s.Temperature.IsSome() {
			o["temperature"] = s.Temperature.Some()
		}
		if s.TopP.IsSome() {
			o["top_p"] = s.TopP.Some()
		}
		if s.MaxOutputTokens.IsSome() {
			o["num_predict"] = s.MaxOutputTokens.Some()
		}
	}
	body["options"] = o
	if r.ExtensionsJson.IsSome() {
		var ext map[string]any
		if json.Unmarshal([]byte(r.ExtensionsJson.Some()), &ext) != nil {
			return nil, fmt.Errorf("extensions_json_invalid")
		}
		if ext["think"] == true {
			if !c["thinking"] {
				return nil, fmt.Errorf("model_does_not_support_thinking")
			}
			body["think"] = true
		}
	}
	return body, nil
}
func event(id string) glixo_llm_types_types.ProviderEvent {
	return glixo_llm_types_types.ProviderEvent{RequestId: id, Part: types.None[glixo_llm_types_types.ContentPart](), Usage: types.None[glixo_llm_types_types.Usage](), Finish: types.None[glixo_llm_types_types.FinishReason](), Warning: types.None[string](), Error: types.None[glixo_llm_types_types.TypedError](), ProviderRequestId: types.None[string](), ProviderResponseId: types.None[string]()}
}
func partEvent(id string, p glixo_llm_types_types.ContentPart) glixo_llm_types_types.ProviderEvent {
	e := event(id)
	e.Part = types.Some(p)
	return e
}

// docs:snippet-start provider-discovery:go
func Describe(c ctx) types.Result[glixo_llm_types_types.ProviderDescriptor, string] {
	cfg, ep, e := cfgEndpoint(c)
	if e != nil {
		return optErr[glixo_llm_types_types.ProviderDescriptor](e)
	}
	names, e := list(ep)
	if e != nil {
		return optErr[glixo_llm_types_types.ProviderDescriptor](e)
	}
	selected := names
	if model, ok := cfg["model"].(string); ok {
		selected = []string{}
		for _, n := range names {
			if n == model {
				selected = append(selected, n)
			}
		}
	} else if len(selected) > 64 {
		selected = selected[:64]
	}
	found := map[string]bool{}
	for _, n := range selected {
		a, e := caps(ep, n)
		if e != nil {
			return optErr[glixo_llm_types_types.ProviderDescriptor](e)
		}
		for k := range a {
			found[k] = true
		}
	}
	cs := []glixo_llm_types_types.ProviderCapability{{Name: "chat", Optional: false}, {Name: "streaming", Optional: false}}
	for _, pair := range [][2]string{{"tools", "tools"}, {"vision", "images"}, {"thinking", "reasoning"}} {
		if found[pair[0]] {
			cs = append(cs, glixo_llm_types_types.ProviderCapability{Name: pair[1], Optional: true})
		}
	}
	return types.Ok[glixo_llm_types_types.ProviderDescriptor, string](glixo_llm_types_types.ProviderDescriptor{Id: "community.ollama", Name: "Ollama", Version: "0.1.0", Models: names, Capabilities: cs})
}
func ValidateConfiguration(config string, c ctx) types.Result[glixo_llm_types_types.ConfigurationReport, string] {
	c.ConfigurationJson = config
	cfg, ep, e := cfgEndpoint(c)
	ds := []string{}
	if e != nil {
		ds = append(ds, e.Error())
	} else if model, ok := cfg["model"].(string); ok {
		ms, er := list(ep)
		if er != nil {
			return optErr[glixo_llm_types_types.ConfigurationReport](er)
		}
		found := false
		for _, n := range ms {
			if n == model {
				found = true
			}
		}
		if !found {
			ds = append(ds, "configured model is not present in /api/tags")
		}
	}
	return types.Ok[glixo_llm_types_types.ConfigurationReport, string](glixo_llm_types_types.ConfigurationReport{Valid: len(ds) == 0, Diagnostics: ds})
}
func ListModels(c ctx) types.Result[[]string, string] {
	_, ep, e := cfgEndpoint(c)
	if e != nil {
		return optErr[[]string](e)
	}
	ms, e := list(ep)
	if e != nil {
		return optErr[[]string](e)
	}
	return types.Ok[[]string, string](ms)
}

// docs:snippet-end provider-discovery:go

// docs:snippet-start provider-request:go
func Start(r request, c ctx) types.Result[uint32, string] {
	cfg, ep, e := cfgEndpoint(c)
	if e != nil {
		return optErr[uint32](e)
	}
	ca, e := caps(ep, r.Model)
	if e != nil {
		return optErr[uint32](e)
	}
	contextWindow, e := contextWindowTokens(cfg)
	if e != nil {
		return optErr[uint32](e)
	}
	body, e := chatBody(r, ca, contextWindow)
	if e != nil {
		return optErr[uint32](e)
	}
	b, e := json.Marshal(body)
	if e != nil {
		return optErr[uint32](e)
	}
	s, e := httpbroker.Open(brokerAdapter{}, reqHTTP(ep, "/api/chat", "POST", b), 1<<20)
	if e != nil {
		return optErr[uint32](e)
	}
	st, e := s.Status()
	if e != nil || st < 200 || st > 299 {
		s.Close()
		if e == nil {
			e = fmt.Errorf("ollama_http_%d", st)
		}
		return optErr[uint32](e)
	}
	id := sessions.next.Add(1)
	if id == 0 {
		id = sessions.next.Add(1)
	}
	sessions.Lock()
	sessions.items[id] = &session{stream: s, requestID: r.RequestId}
	sessions.Unlock()
	return types.Ok[uint32, string](id)
}

// docs:snippet-end provider-request:go
func Next(id uint32) types.Result[types.Option[glixo_llm_types_types.ProviderEvent], string] {
	sessions.Lock()
	s := sessions.items[id]
	sessions.Unlock()
	if s == nil {
		return types.Err[types.Option[glixo_llm_types_types.ProviderEvent], string]("provider_stream_missing")
	}
	if s.terminal {
		return types.Ok[types.Option[glixo_llm_types_types.ProviderEvent], string](types.None[glixo_llm_types_types.ProviderEvent]())
	}
	if s.cancelled {
		s.terminal = true
		s.pending = nil
		s.stream.Close()
		e := event(s.requestID)
		e.Finish = types.Some(glixo_llm_types_types.MakeFinishReasonCancelled())
		return types.Ok[types.Option[glixo_llm_types_types.ProviderEvent], string](types.Some(e))
	}
	if len(s.pending) > 0 {
		return deliverPending(s)
	}
	for {
		line, e := s.stream.NextLine()
		if e == io.EOF {
			return terminal(s, "ollama_stream_ended_before_done")
		}
		if e != nil {
			return terminal(s, e.Error())
		}
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		var rec struct {
			Message struct {
				Content, Thinking string
				ToolCalls         []struct {
					Function struct {
						Name      string
						Arguments any
					}
				} `json:"tool_calls"`
			} `json:"message"`
			Done       bool    `json:"done"`
			DoneReason string  `json:"done_reason"`
			Prompt     *uint32 `json:"prompt_eval_count"`
			Eval       *uint32 `json:"eval_count"`
			Error      string  `json:"error"`
		}
		if json.Unmarshal(line, &rec) != nil {
			return terminal(s, "ollama_ndjson_record_invalid")
		}
		if rec.Error != "" {
			return terminal(s, "ollama_error:"+rec.Error)
		}
		if rec.Message.Thinking != "" {
			s.pending = append(s.pending, pendingEvent{event: partEvent(s.requestID, glixo_llm_types_types.MakeContentPartReasoning(rec.Message.Thinking))})
		}
		if rec.Message.Content != "" {
			s.pending = append(s.pending, pendingEvent{event: partEvent(s.requestID, glixo_llm_types_types.MakeContentPartText(rec.Message.Content))})
		}
		if len(rec.Message.ToolCalls) > 32 {
			return terminal(s, "ollama_tool_call_limit_exceeded")
		}
		for _, call := range rec.Message.ToolCalls {
			f := call.Function
			if f.Name == "" {
				continue
			}
			s.toolCallsSeen = true
			a, _ := json.Marshal(f.Arguments)
			d := glixo_llm_types_types.ToolCallDetails{Id: fmt.Sprintf("%s:ollama:%d", s.requestID, s.toolIndex), Name: f.Name, ArgumentsFragment: types.Some(string(a)), Complete: true}
			s.toolIndex++
			s.pending = append(s.pending, pendingEvent{event: partEvent(s.requestID, glixo_llm_types_types.MakeContentPartToolCallDetails(d))})
		}
		if rec.Done {
			ev := finishEvent(s.requestID, rec.DoneReason, rec.Prompt, rec.Eval, s.toolCallsSeen)
			s.pending = append(s.pending, pendingEvent{event: ev, terminal: true})
		}
		if len(s.pending) > 0 {
			return deliverPending(s)
		}
	}
}

func deliverPending(s *session) types.Result[types.Option[glixo_llm_types_types.ProviderEvent], string] {
	next := s.pending[0]
	s.pending = s.pending[1:]
	if next.terminal {
		s.terminal = true
		s.stream.Close()
	}
	return types.Ok[types.Option[glixo_llm_types_types.ProviderEvent], string](types.Some(next.event))
}

func finishEvent(requestID, reason string, prompt, eval *uint32, toolCallsSeen bool) glixo_llm_types_types.ProviderEvent {
	ev := event(requestID)
	ev.Finish = types.Some(finishReason(reason, toolCallsSeen))
	if prompt != nil || eval != nil {
		u := glixo_llm_types_types.Usage{CachedTokens: types.None[uint32](), ReasoningTokens: types.None[uint32](), TotalTokens: types.None[uint32]()}
		if prompt != nil {
			u.InputTokens = *prompt
		}
		if eval != nil {
			u.OutputTokens = *eval
		}
		if prompt != nil && eval != nil {
			u.TotalTokens = types.Some(u.InputTokens + u.OutputTokens)
		}
		ev.Usage = types.Some(u)
	}
	return ev
}

func finishReason(reason string, toolCallsSeen bool) glixo_llm_types_types.FinishReason {
	if toolCallsSeen {
		return glixo_llm_types_types.MakeFinishReasonTool()
	}
	switch reason {
	case "length":
		return glixo_llm_types_types.MakeFinishReasonLength()
	case "tool", "tool_calls":
		return glixo_llm_types_types.MakeFinishReasonTool()
	case "stop", "":
		return glixo_llm_types_types.MakeFinishReasonStop()
	default:
		return glixo_llm_types_types.MakeFinishReasonUnknown(glixo_llm_types_types.UnknownRepresentation{Name: reason, PayloadJson: types.None[string]()})
	}
}
func terminal(s *session, msg string) types.Result[types.Option[glixo_llm_types_types.ProviderEvent], string] {
	s.terminal = true
	s.stream.Close()
	e := event(s.requestID)
	e.Finish = types.Some(glixo_llm_types_types.MakeFinishReasonError())
	e.Error = types.Some(glixo_llm_types_types.TypedError{Code: "ollama_stream_error", Message: msg, Retryable: false, RetryAfterMs: types.None[uint32]()})
	return types.Ok[types.Option[glixo_llm_types_types.ProviderEvent], string](types.Some(e))
}
func Cancel(id uint32) {
	sessions.Lock()
	defer sessions.Unlock()
	if s := sessions.items[id]; s != nil && !s.terminal {
		s.pending = nil
		s.stream.Cancel()
		s.cancelled = true
	}
}
func Drop(id uint32) {
	sessions.Lock()
	defer sessions.Unlock()
	if s := sessions.items[id]; s != nil {
		s.stream.Close()
		delete(sessions.items, id)
	}
}
