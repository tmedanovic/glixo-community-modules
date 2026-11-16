use serde_json::{json, Map, Value};
wit_bindgen::generate!({ path: "wit", world: "contribution", generate_all });

struct GuestImpl;

fn object(value: &Value) -> Option<&Map<String, Value>> { value.as_object() }
fn count(source: Option<&Map<String, Value>>, key: &str) -> u64 {
    source.and_then(|o| o.get(key)).and_then(Value::as_u64).unwrap_or(0)
}
fn nullable_count(source: Option<&Map<String, Value>>, key: &str) -> Value {
    source.and_then(|o| o.get(key)).and_then(Value::as_u64).map(Value::from).unwrap_or(Value::Null)
}

// docs:snippet-start conversation-insights-handler:rust
pub fn analyze(input: &Value) -> Result<Value, String> {
    let request = object(input).ok_or_else(|| "middleware_request_invalid".to_owned())?;
    if request.get("schemaVersion").and_then(Value::as_u64) != Some(1) { return Err("middleware_schema_unsupported".into()); }
    let operation = request.get("operation").and_then(Value::as_str).unwrap_or("");
    if operation == "committed" {
        let message = object(request.get("committedMessage").ok_or_else(|| "committed_message_missing".to_owned())?)
            .ok_or_else(|| "committed_message_missing".to_owned())?;
        let role = message.get("role").and_then(Value::as_str).unwrap_or("");
        return Ok(json!({"observation": {
            "schemaVersion":1,"messageCount":1,"userMessageCount":if role == "user" { 1 } else { 0 },
            "assistantMessageCount":if role == "assistant" { 1 } else { 0 },"toolCallCount":count(Some(message),"toolCallCount"),
            "toolResultCount":count(Some(message),"toolResultCount"),"attachmentCount":count(Some(message),"attachmentCount")
        },"auditDescription":"insights-recorded"}));
    }
    if operation == "completed" {
        let completion = object(request.get("completion").ok_or_else(|| "completion_missing".to_owned())?)
            .ok_or_else(|| "completion_missing".to_owned())?;
        let usage = completion.get("actualUsage").and_then(Value::as_object);
        let actual_usage = usage.map(|u| json!({
            "inputTokens":nullable_count(Some(u),"inputTokens"),"outputTokens":nullable_count(Some(u),"outputTokens"),
            "cachedTokens":nullable_count(Some(u),"cachedTokens"),"reasoningTokens":nullable_count(Some(u),"reasoningTokens"),
            "totalTokens":nullable_count(Some(u),"totalTokens")
        })).unwrap_or(Value::Null);
        return Ok(json!({"observation": {
            "schemaVersion":1,"latencyMilliseconds":count(Some(completion),"latencyMilliseconds"),
            "userMessageCount":count(Some(completion),"userMessageCount"),"assistantMessageCount":count(Some(completion),"assistantMessageCount"),
            "toolCallCount":count(Some(completion),"toolCallCount"),"toolResultCount":count(Some(completion),"toolResultCount"),
            "attachmentCount":count(Some(completion),"attachmentCount"),"actualUsageAvailable":usage.is_some(),"actualUsage":actual_usage,
            "estimatedInputCharacters":count(Some(completion),"estimatedInputCharacters"),
            "estimatedOutputCharacters":count(Some(completion),"estimatedOutputCharacters"),"textStatisticsAreEstimates":true
        },"auditDescription":"analysis-complete"}));
    }
    Err("operation_unsupported".into())
}
// docs:snippet-end conversation-insights-handler:rust

impl exports::glixo::contribution::guest::Guest for GuestImpl {
    fn invoke(request_json: String) -> Result<String, String> {
        let envelope: Value = serde_json::from_str(&request_json).map_err(|_| "guest_envelope_invalid".to_owned())?;
        if envelope.get("kind").and_then(Value::as_str) != Some("messageMiddleware")
            || envelope.get("contributionId").and_then(Value::as_str) != Some("conversation-insights") {
            return Err("guest_envelope_invalid".into());
        }
        serde_json::to_string(&analyze(envelope.get("input").ok_or_else(|| "guest_envelope_invalid".to_owned())?)?)
            .map_err(|_| "guest_result_invalid".to_owned())
    }
}

export!(GuestImpl);

#[cfg(test)]
mod tests;
