package issuelookup

import (
	"encoding/json"
	"testing"

	"github.com/glixo/extension-sdk-go/httpbroker"
)

type fixtureBroker struct { request httpbroker.Request; reads int; canceled, dropped bool }
func (b *fixtureBroker) HTTPStart(request httpbroker.Request) (uint32,error) { b.request=request; return 7,nil }
func (*fixtureBroker) HTTPStatus(uint32) (uint16,error) { return 200,nil }
func (*fixtureBroker) HTTPResponseHeaders(uint32) ([]httpbroker.Header,error) { return []httpbroker.Header{{Name:"Content-Type",Value:"application/json"}},nil }
func (b *fixtureBroker) HTTPRead(_ uint32, _ uint32) ([]byte,bool,error) { if b.reads>0{return nil,false,nil}; b.reads++; return []byte(`{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"DEMO-17 is open"}]}}`),true,nil }
func (b *fixtureBroker) HTTPCancel(uint32) { b.canceled=true }
func (b *fixtureBroker) HTTPDrop(uint32) { b.dropped=true }

func envelope(issueKey string) string {
	encoded, _ := json.Marshal(issueKey)
	return `{"kind":"tools","contributionId":"issue-lookup","configuration":{"endpointName":"issues"},"input":{"issueKey":` + string(encoded) + `},"context":{"endpoints":[{"name":"issues","handle":"opaque-approved-handle","baseUrl":"https://issues.example.test"}]}}`
}

func TestLookupUsesApprovedEndpointAndReturnsBoundedSummary(t *testing.T) {
	broker:=&fixtureBroker{}
	result,err:=Lookup(envelope("DEMO-17"),broker); if err!=nil { t.Fatal(err) }
	if result["summary"]!="DEMO-17 is open" { t.Fatalf("unexpected result: %#v",result) }
	if broker.request.URL!="https://issues.example.test/mcp" || broker.request.EndpointHandle==nil || *broker.request.EndpointHandle!="opaque-approved-handle" { t.Fatalf("request was not bound to approved endpoint: %#v",broker.request) }
	var body map[string]any; if err:=json.Unmarshal(broker.request.Body,&body);err!=nil{t.Fatal(err)}
	if body["method"]!="tools/call" { t.Fatalf("unexpected MCP request: %#v",body) }
	if !broker.dropped || broker.canceled { t.Fatal("successful response was not released cleanly") }
}

func TestLookupRejectsUnapprovedEndpointAndInvalidKeyWithoutHTTP(t *testing.T) {
	broker:=&fixtureBroker{}
	noEndpoint:=`{"kind":"tools","contributionId":"issue-lookup","configuration":{"endpointName":"issues"},"input":{"issueKey":"DEMO-17"},"context":{"endpoints":[]}}`
	if _,err:=Lookup(noEndpoint,broker);err==nil||err.Error()!="approved_issues_endpoint_missing"{t.Fatalf("unexpected error: %v",err)}
	if _,err:=Lookup(envelope("bad"),broker);err==nil||err.Error()!="issue_key_invalid"{t.Fatalf("unexpected error: %v",err)}
	if broker.request.URL!="" { t.Fatal("HTTP started before validation") }
}

type failingBroker struct{ fixtureBroker }
func (b *failingBroker) HTTPStatus(uint32)(uint16,error){return 400,nil}
func TestLookupCancelsAndDropsFailedResponse(t *testing.T){
	b:=&failingBroker{}
	_,err:=Lookup(envelope("DEMO-17"),b);if err==nil||err.Error()!="mcp_http_status_invalid"{t.Fatalf("unexpected error: %v",err)}
	if !b.dropped||!b.canceled{t.Fatal("failed response was not cancelled and dropped")}
}

type responseBroker struct { fixtureBroker; body []byte; contentType string; emptyReads int }
func (b *responseBroker) HTTPResponseHeaders(uint32) ([]httpbroker.Header,error) { return []httpbroker.Header{{Name:"Content-Type",Value:b.contentType}},nil }
func (b *responseBroker) HTTPRead(_ uint32, _ uint32) ([]byte,bool,error) {
	if b.emptyReads > 0 { b.emptyReads--; return []byte{},true,nil }
	if b.reads > 0 { return nil,false,nil }
	b.reads++; return b.body,true,nil
}

func TestLookupRejectsMalformedSummaryContentTypeAndTerminalNewline(t *testing.T) {
	broker := &fixtureBroker{}
	if _, err := Lookup(envelope("DEMO-17\n"), broker); err == nil || err.Error() != "issue_key_invalid" { t.Fatalf("terminal newline accepted: %v", err) }
	for _, testCase := range []struct{ body, contentType string }{
		{`{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text"}]}}`, "application/json"},
		{`{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"ok"}]}}`, "application/jsonp"},
		{`{"jsonrpc":"2.0","id":1,"error":null}`, "application/json"},
	} {
		response := &responseBroker{body:[]byte(testCase.body),contentType:testCase.contentType}
		if _, err := Lookup(envelope("DEMO-17"), response); err == nil { t.Fatal("malformed response was accepted") }
		if !response.dropped || !response.canceled { t.Fatal("malformed response was not released") }
	}
	stalled := &responseBroker{body:[]byte(`{}`),contentType:"application/json",emptyReads:33}
	if _, err := Lookup(envelope("DEMO-17"), stalled); err == nil || err.Error() != "mcp_response_stalled" { t.Fatalf("empty reads were not bounded: %v", err) }
}
