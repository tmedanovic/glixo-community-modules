package issuelookup

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/url"
	"strings"

	"github.com/glixo/extension-sdk-go/httpbroker"
)

const maxResponseBytes = 128 * 1024

type object = map[string]any

func asObject(value any) object { result, _ := value.(map[string]any); return result }
func stringValue(value any) string { result, _ := value.(string); return result }

func endpoint(request object) (string, string, error) {
	if request["kind"] != "tools" || request["contributionId"] != "issue-lookup" { return "", "", errors.New("guest_envelope_invalid") }
	if stringValue(asObject(request["configuration"])["endpointName"]) != "issues" { return "", "", errors.New("endpoint_name_must_be_issues") }
	context := asObject(request["context"])
	endpoints, _ := context["endpoints"].([]any)
	for _, raw := range endpoints {
		grant := asObject(raw)
		if stringValue(grant["name"]) != "issues" { continue }
		handle := stringValue(grant["handle"])
		base, err := url.Parse(stringValue(grant["baseUrl"]))
		if err != nil || handle == "" || (base.Scheme != "http" && base.Scheme != "https") || base.User != nil || base.RawQuery != "" || base.Fragment != "" {
			return "", "", errors.New("approved_endpoint_url_invalid")
		}
		base.Path, base.RawPath = "/mcp", ""
		return base.String(), handle, nil
	}
	return "", "", errors.New("approved_issues_endpoint_missing")
}

// docs:snippet-start issue-lookup-mcp:go
func Lookup(requestJSON string, broker httpbroker.Broker) (object, error) {
	decoder := json.NewDecoder(strings.NewReader(requestJSON)); decoder.UseNumber()
	var request object
	if err := decoder.Decode(&request); err != nil { return nil, errors.New("guest_envelope_invalid") }
	if _, err := decoder.Token(); err != io.EOF { return nil, errors.New("guest_envelope_invalid") }
	input := asObject(request["input"])
	issueKey := stringValue(input["issueKey"])
	if len(issueKey) < 3 || len(issueKey) > 20 { return nil, errors.New("issue_key_invalid") }
	prefix, suffix, ok := strings.Cut(issueKey, "-")
	if !ok || len(prefix) == 0 || len(prefix) > 10 || prefix[0] < 'A' || prefix[0] > 'Z' || len(suffix) == 0 || len(suffix) > 9 || suffix[0] == '0' {
		return nil, errors.New("issue_key_invalid")
	}
	for _, char := range prefix { if !((char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9')) { return nil, errors.New("issue_key_invalid") } }
	for _, char := range suffix { if char < '0' || char > '9' { return nil, errors.New("issue_key_invalid") } }
	url, endpointHandle, err := endpoint(request); if err != nil { return nil, err }
	body, _ := json.Marshal(object{"jsonrpc":"2.0", "id":1, "method":"tools/call", "params":object{
		"name":"issues.lookup", "arguments":object{"issueKey":issueKey}, "_meta":object{
			"io.modelcontextprotocol/protocolVersion":"2026-07-28", "io.modelcontextprotocol/clientInfo":object{"name":"glixo-issue-lookup", "version":"0.1.0"},
		},
	}})
	timeout, limit := uint32(15000), uint32(maxResponseBytes)
	minStatus, maxStatus := uint16(200), uint16(299)
	handle, err := broker.HTTPStart(httpbroker.Request{URL:url, Method:"POST", Headers:[]httpbroker.Header{
		{Name:"Accept", Value:"application/json"}, {Name:"MCP-Protocol-Version", Value:"2026-07-28"},
		{Name:"Mcp-Method", Value:"tools/call"}, {Name:"Mcp-Name", Value:"issues.lookup"},
	}, Body:body, ContentType:ptr("application/json"), TimeoutMS:&timeout, MaxResponseBytes:&limit,
		AcceptedStatusMin:&minStatus, AcceptedStatusMax:&maxStatus, EndpointHandle:&endpointHandle})
	if err != nil { return nil, errors.New("mcp_request_denied") }
	complete := false
	defer func() { if !complete { broker.HTTPCancel(handle) }; broker.HTTPDrop(handle) }()
	status, err := broker.HTTPStatus(handle); if err != nil { return nil, errors.New("mcp_status_failed") }
	if status != 200 { return nil, errors.New("mcp_http_status_invalid") }
	headers, err := broker.HTTPResponseHeaders(handle); if err != nil { return nil, errors.New("mcp_headers_failed") }
	contentType := ""; for _, header := range headers { if strings.EqualFold(header.Name,"content-type") { contentType=header.Value; break } }
	mediaType, _, mediaErr := mime.ParseMediaType(contentType); if mediaErr != nil || !strings.EqualFold(mediaType, "application/json") { return nil, errors.New("mcp_content_type_invalid") }
	var response bytes.Buffer
	emptyReads := 0
	for { chunk, more, readErr := broker.HTTPRead(handle, 16*1024); if readErr != nil { return nil, errors.New("http_read_failed") }; if !more { break }; if len(chunk) == 0 { emptyReads++; if emptyReads > 32 { return nil, errors.New("mcp_response_stalled") }; continue }; emptyReads = 0; if response.Len()+len(chunk)>maxResponseBytes { return nil, errors.New("mcp_response_too_large") }; _,_=response.Write(chunk) }
	var rpc object; if err:=json.Unmarshal(response.Bytes(), &rpc); err!=nil { return nil, errors.New("mcp_response_invalid_json") }
	_, hasError := rpc["error"]
	if rpc["jsonrpc"]!="2.0" || rpc["id"]!=float64(1) || hasError { return nil, errors.New("mcp_call_failed") }
	result:=asObject(rpc["result"]); content,ok:=result["content"].([]any); if !ok || len(content)!=1 { return nil, errors.New("mcp_result_content_missing") }
	item:=asObject(content[0]); summary,ok:=item["text"].(string); if stringValue(item["type"])!="text" || !ok || len(summary)>64*1024 { return nil, errors.New("mcp_result_content_invalid") }
	complete=true
	return object{"issueKey":issueKey,"summary":summary},nil
}
// docs:snippet-end issue-lookup-mcp:go

func ptr[T any](value T) *T { return &value }
