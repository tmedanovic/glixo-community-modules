package middleware

import (
    "bytes"
    "encoding/json"
    "errors"
    "io"
    "strconv"
)

type object = map[string]any

func asObject(v any) object { x, _ := v.(map[string]any); return x }
func count(obj object, key string) uint64 { n, ok := unsigned(obj[key]); if ok { return n }; return 0 }
func unsigned(v any) (uint64, bool) {
    switch n := v.(type) {
    case json.Number:
        value, err := strconv.ParseUint(string(n), 10, 64); return value, err == nil
    case float64:
        if n < 0 || n != float64(uint64(n)) { return 0, false }; return uint64(n), true
    case uint64: return n, true
    case int: if n >= 0 { return uint64(n), true }
    case int64: if n >= 0 { return uint64(n), true }
    }
    return 0, false
}
func nullableCount(obj object, key string) any { if value, ok := unsigned(obj[key]); ok { return value }; return nil }

// docs:snippet-start conversation-insights-handler:go
func Analyze(input object) (object, error) {
    if _, ok := unsigned(input["schemaVersion"]); !ok || count(input,"schemaVersion") != 1 { return nil, errors.New("middleware_schema_unsupported") }
    switch input["operation"] {
    case "committed":
        message := asObject(input["committedMessage"]); if message == nil { return nil, errors.New("committed_message_missing") }
        role, _ := message["role"].(string); user, assistant := uint64(0), uint64(0)
        if role == "user" { user = 1 }; if role == "assistant" { assistant = 1 }
        return object{"observation":object{"schemaVersion":1,"messageCount":1,"userMessageCount":user,"assistantMessageCount":assistant,"toolCallCount":count(message,"toolCallCount"),"toolResultCount":count(message,"toolResultCount"),"attachmentCount":count(message,"attachmentCount")},"auditDescription":"insights-recorded"},nil
    case "completed":
        completion := asObject(input["completion"]); if completion == nil { return nil, errors.New("completion_missing") }
        usage := asObject(completion["actualUsage"]); var actual any
        if usage != nil { actual = object{"inputTokens":nullableCount(usage,"inputTokens"),"outputTokens":nullableCount(usage,"outputTokens"),"cachedTokens":nullableCount(usage,"cachedTokens"),"reasoningTokens":nullableCount(usage,"reasoningTokens"),"totalTokens":nullableCount(usage,"totalTokens")} }
        return object{"observation":object{"schemaVersion":1,"latencyMilliseconds":count(completion,"latencyMilliseconds"),"userMessageCount":count(completion,"userMessageCount"),"assistantMessageCount":count(completion,"assistantMessageCount"),"toolCallCount":count(completion,"toolCallCount"),"toolResultCount":count(completion,"toolResultCount"),"attachmentCount":count(completion,"attachmentCount"),"actualUsageAvailable":usage!=nil,"actualUsage":actual,"estimatedInputCharacters":count(completion,"estimatedInputCharacters"),"estimatedOutputCharacters":count(completion,"estimatedOutputCharacters"),"textStatisticsAreEstimates":true},"auditDescription":"analysis-complete"},nil
    default: return nil, errors.New("operation_unsupported")
    }
}
// docs:snippet-end conversation-insights-handler:go

func Invoke(requestJSON string) (string,error) {
    decoder:=json.NewDecoder(bytes.NewBufferString(requestJSON)); decoder.UseNumber()
    var envelope object
    if err:=decoder.Decode(&envelope); err!=nil { return "",errors.New("guest_envelope_invalid") }
    if _,err:=decoder.Token(); err!=io.EOF { return "",errors.New("guest_envelope_invalid") }
    if envelope["kind"]!="messageMiddleware" || envelope["contributionId"]!="conversation-insights" { return "",errors.New("guest_envelope_invalid") }
    input:=asObject(envelope["input"]); if input==nil { return "",errors.New("guest_envelope_invalid") }
    result,err:=Analyze(input); if err!=nil { return "",err }
    body,err:=json.Marshal(result); if err!=nil { return "",errors.New("guest_result_invalid") }; return string(body),nil
}
