use glixo_extension_sdk::http::{Broker, Header as SdkHeader, NdjsonStream, Request as HttpRequest};
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicU32, Ordering};

wit_bindgen::generate!({ path: "wit", world: "provider-compat", generate_all });

struct OllamaProvider;
struct HostBroker;
impl Broker for HostBroker {
    fn start(&mut self, request: HttpRequest) -> Result<u32, String> {
        glixo::http::broker::http_start(&glixo::http::types::HttpRequest {
            url: request.url, method: request.method,
            headers: request.headers.into_iter().map(|h| glixo::http::types::Header { name: h.name, value: h.value }).collect(),
            body: request.body, content_type: request.content_type, timeout_ms: request.timeout_ms,
            max_response_bytes: request.max_response_bytes, accepted_status_min: request.accepted_status_min,
            accepted_status_max: request.accepted_status_max, endpoint_handle: request.endpoint_handle,
            secret_handle: request.secret_handle, auth_header: request.auth_header, auth_scheme: request.auth_scheme,
        })
    }
    fn status(&mut self, handle: u32) -> Result<u16, String> { glixo::http::broker::http_status(handle) }
    fn response_headers(&mut self, handle: u32) -> Result<Vec<SdkHeader>, String> {
        glixo::http::broker::http_response_headers(handle).map(|headers| headers.into_iter().map(|h| SdkHeader { name: h.name, value: h.value }).collect())
    }
    fn read(&mut self, handle: u32, max_bytes: u32) -> Result<Option<Vec<u8>>, String> { glixo::http::broker::http_read(handle, max_bytes) }
    fn cancel(&mut self, handle: u32) { glixo::http::broker::http_cancel(handle); }
    fn drop_response(&mut self, handle: u32) { glixo::http::broker::http_drop(handle); }
}
struct PendingEvent { event: glixo::llm_types::types::ProviderEvent, terminal: bool }
struct Session { stream: NdjsonStream<HostBroker>, request_id: String, done: bool, terminal_sent: bool, cancelled: bool, tool_index: u32, tool_calls_seen: bool, pending: VecDeque<PendingEvent> }
thread_local! { static STREAMS: RefCell<HashMap<u32, Session>> = RefCell::new(HashMap::new()); }
static NEXT_STREAM: AtomicU32 = AtomicU32::new(1);
const DEFAULT_CONTEXT_WINDOW_TOKENS: u32 = 8192;
const MAXIMUM_CONTEXT_WINDOW_TOKENS: u64 = 32768;

fn context_window_tokens(config: &Value) -> Result<u32, String> {
    let Some(value) = config.get("contextWindowTokens") else { return Ok(DEFAULT_CONTEXT_WINDOW_TOKENS); };
    value.as_f64()
        .filter(|tokens| tokens.is_finite() && tokens.fract() == 0.0 && *tokens >= 1.0 && *tokens <= MAXIMUM_CONTEXT_WINDOW_TOKENS as f64)
        .map(|tokens| tokens as u32)
        .ok_or_else(|| "context_window_tokens_must_be_between_1_and_32768".to_owned())
}

fn parse_config(ctx: &glixo::llm_types::types::ProviderContext) -> Result<(Value, glixo::http::types::EndpointGrant), String> {
    let cfg: Value = serde_json::from_str(&ctx.configuration_json).map_err(|_| "configuration_json_invalid".to_owned())?;
    let obj = cfg.as_object().ok_or_else(|| "configuration_object_required".to_owned())?;
    if obj.get("endpointName").and_then(Value::as_str) != Some("ollama") { return Err("endpointName_must_be_ollama".into()); }
    if let Some(model) = obj.get("model") { if !model.as_str().is_some_and(|s| !s.trim().is_empty()) { return Err("model_must_be_nonempty_string".into()); } }
    let _ = context_window_tokens(&cfg)?;
    let grant = ctx.endpoints.iter().find(|ep| ep.name == "ollama" && !ep.handle.is_empty()).cloned().ok_or_else(|| "approved_ollama_endpoint_missing".to_owned())?;
    if !(grant.base_url.starts_with("http://") || grant.base_url.starts_with("https://")) || grant.base_url.contains(['?', '#']) || grant.base_url[grant.base_url.find("://").unwrap_or(0) + 3..].contains('/') {
        return Err("approved_ollama_base_url_invalid".into());
    }
    Ok((cfg, grant))
}
fn request(grant: &glixo::http::types::EndpointGrant, path: &str, method: &str, body: Option<Vec<u8>>) -> HttpRequest {
    HttpRequest { url: format!("{}{}", grant.base_url.trim_end_matches('/'), path), method: method.into(), headers: vec![SdkHeader { name: "accept".into(), value: "application/json".into() }], body,
        content_type: Some("application/json".into()), timeout_ms: Some(30_000), max_response_bytes: Some(8 * 1024 * 1024),
        accepted_status_min: Some(200), accepted_status_max: Some(299), endpoint_handle: Some(grant.handle.clone()),
        secret_handle: None, auth_header: None, auth_scheme: None }
}
fn read_json(grant: &glixo::http::types::EndpointGrant, path: &str, method: &str, body: Option<Value>) -> Result<Value, String> {
    let bytes = body.map(|v| serde_json::to_vec(&v).map_err(|e| e.to_string())).transpose()?;
    let mut stream = NdjsonStream::open(HostBroker, request(grant, path, method, bytes), 1024 * 1024)?;
    let result = (|| {
        let status = stream.status()?;
        if !(200..=299).contains(&status) { return Err(format!("ollama_http_{status}")); }
        let mut all = Vec::new();
        while let Some(line) = stream.next_line()? {
            if all.len().saturating_add(line.len()).saturating_add(1) > 8 * 1024 * 1024 { return Err("ollama_response_too_large".into()); }
            all.extend_from_slice(&line); all.push(b'\n');
        }
        serde_json::from_slice(&all).map_err(|_| "ollama_json_invalid".to_owned())
    })();
    stream.close();
    result
}
fn models(grant: &glixo::http::types::EndpointGrant) -> Result<Vec<String>, String> {
    let value = read_json(grant, "/api/tags", "GET", None)?;
    let arr = value.get("models").and_then(Value::as_array).ok_or_else(|| "ollama_tags_invalid".to_owned())?;
    Ok(arr.iter().filter_map(|m| m.get("name").or_else(|| m.get("model"))?.as_str().map(str::to_owned)).collect())
}
fn capabilities(grant: &glixo::http::types::EndpointGrant, model: &str) -> Result<HashSet<String>, String> {
    let value = read_json(grant, "/api/show", "POST", Some(json!({"model": model})))?;
    Ok(value.get("capabilities").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).map(str::to_owned).collect())
}
fn chat_body(req: &glixo::llm_types::types::LlmRequest, caps: &HashSet<String>, context_window_tokens: u32) -> Result<Value, String> {
    use glixo::llm_types::types::ContentPart as P;
    if !req.tools.is_empty() && !caps.contains("tools") { return Err("model_does_not_support_tools".into()); }
    let mut messages = Vec::new();
    let mut pending_tools = HashMap::<String, String>::new();
    for message in &req.messages {
        let mut content = String::new(); let mut images = Vec::new();
        let mut tool_calls = Vec::new();
        let mut tool_name: Option<String> = None;
        for p in &message.parts {
            match p {
                P::MediaRef(v) => {
                    if !caps.contains("vision") { return Err("model_does_not_support_vision".into()); }
                    let encoded = v.strip_prefix("data:image/").and_then(|s| s.split_once(";base64,").map(|x| x.1)).ok_or_else(|| "vision_requires_base64_image_data_uri".to_owned())?;
                    if encoded.is_empty() || !encoded.bytes().all(|b| b.is_ascii_alphanumeric() || b"+/=".contains(&b)) { return Err("vision_image_data_invalid".into()); }
                    images.push(encoded.to_owned());
                }
                P::Text(v) | P::Reasoning(v) => content.push_str(v),
                P::ToolCallDetails(call) => {
                    if message.role != "assistant" { return Err("tool_call_requires_assistant_role".into()); }
                    if !call.complete || call.id.is_empty() || call.name.is_empty() { return Err("tool_call_details_invalid".into()); }
                    if pending_tools.contains_key(&call.id) { return Err("tool_call_id_duplicate".into()); }
                    let args: Value = serde_json::from_str(call.arguments_fragment.as_deref().unwrap_or("{}"))
                        .map_err(|_| "tool_call_arguments_invalid".to_owned())?;
                    if !args.is_object() { return Err("tool_call_arguments_invalid".into()); }
                    pending_tools.insert(call.id.clone(), call.name.clone());
                    tool_calls.push(json!({"type":"function","function":{"index":tool_calls.len(),"name":call.name,"arguments":args}}));
                }
                P::ToolResult(payload) => {
                    if message.role != "tool" || tool_name.is_some() { return Err("tool_result_requires_tool_message".into()); }
                    let result: Value = serde_json::from_str(payload).map_err(|_| "tool_result_invalid".to_owned())?;
                    let id = result.get("id").and_then(Value::as_str).filter(|id| !id.is_empty())
                        .ok_or_else(|| "tool_result_invalid".to_owned())?;
                    let value = result.get("result").ok_or_else(|| "tool_result_invalid".to_owned())?;
                    let name = pending_tools.remove(id).ok_or_else(|| "tool_result_call_id_unmatched".to_owned())?;
                    let rendered = value.as_str().map(str::to_owned).unwrap_or_else(|| value.to_string());
                    content.push_str(&rendered);
                    tool_name = Some(name);
                }
                P::Citation(_) | P::Annotation(_) => (),
                _ => return Err("unsupported_message_part".into()),
            }
        }
        let mut m = json!({"role": message.role, "content": content});
        if !tool_calls.is_empty() { m["tool_calls"] = json!(tool_calls); }
        if let Some(name) = tool_name { m["tool_name"] = json!(name); }
        if message.role == "tool" && m.get("tool_name").is_none() { return Err("tool_message_result_missing".into()); }
        if !images.is_empty() { m["images"] = json!(images); }
        messages.push(m);
    }
    let mut body = json!({"model": req.model, "messages": messages, "stream": true});
    if !req.tools.is_empty() {
        body["tools"] = Value::Array(req.tools.iter().map(|t| json!({"type":"function","function":{"name":t.name,"description":t.description,"parameters":serde_json::from_str::<Value>(&t.schema_json).unwrap_or(Value::Null)}})).collect());
    }
    if let Some(format) = &req.response_format {
        if format.kind == "json" { body["format"] = format.schema_json.as_ref().and_then(|s| serde_json::from_str(s).ok()).unwrap_or(json!("json")); }
        else if format.kind != "text" { return Err("response_format_unsupported".into()); }
    }
    let mut opts = serde_json::Map::new();
    opts.insert("num_ctx".into(), json!(context_window_tokens));
    if let Some(sampling) = &req.sampling {
        if let Some(v) = sampling.temperature { opts.insert("temperature".into(), json!(v)); }
        if let Some(v) = sampling.top_p { opts.insert("top_p".into(), json!(v)); }
        if let Some(v) = sampling.max_output_tokens { opts.insert("num_predict".into(), json!(v)); }
    }
    body["options"] = Value::Object(opts);
    if let Some(ext) = &req.extensions_json {
        let value: Value = serde_json::from_str(ext).map_err(|_| "extensions_json_invalid".to_owned())?;
        if value.get("think").and_then(Value::as_bool) == Some(true) {
            if !caps.contains("thinking") { return Err("model_does_not_support_thinking".into()); }
            body["think"] = json!(true);
        }
    }
    Ok(body)
}
fn event(request_id: &str) -> glixo::llm_types::types::ProviderEvent {
    use glixo::llm_types::types::ProviderEvent;
    ProviderEvent { request_id: request_id.into(), part: None, usage: None, finish: None, warning: None, error: None, provider_request_id: None, provider_response_id: None }
}
fn event_with_part(request_id: &str, part: glixo::llm_types::types::ContentPart) -> glixo::llm_types::types::ProviderEvent {
    glixo::llm_types::types::ProviderEvent { part: Some(part), ..event(request_id) }
}
fn err_message<E: std::fmt::Display>(e: E) -> String { e.to_string() }

impl exports::glixo::llm_provider_compat::provider::Guest for OllamaProvider {
    // docs:snippet-start provider-discovery:rust
    fn describe(context: glixo::llm_types::types::ProviderContext) -> Result<glixo::llm_types::types::ProviderDescriptor, String> {
        let (cfg, grant) = parse_config(&context)?;
        let names = models(&grant)?;
        let selected: Vec<String> = cfg.get("model").and_then(Value::as_str).map(|m| names.iter().filter(|n| n.as_str() == m).cloned().collect()).unwrap_or_else(|| names.iter().take(64).cloned().collect());
        let mut found = HashSet::new();
        for model in selected { found.extend(capabilities(&grant, &model)?); }
        let mut advertised = vec![glixo::llm_types::types::ProviderCapability { name: "chat".into(), optional: false }, glixo::llm_types::types::ProviderCapability { name: "streaming".into(), optional: false }];
        for (upstream, name) in [("tools", "tools"), ("vision", "images"), ("thinking", "reasoning")] {
            if found.contains(upstream) { advertised.push(glixo::llm_types::types::ProviderCapability { name: name.into(), optional: true }); }
        }
        Ok(glixo::llm_types::types::ProviderDescriptor { id: "community.ollama".into(), name: "Ollama".into(), version: "0.1.0".into(), models: names, capabilities: advertised })
    }
    // docs:snippet-end provider-discovery:rust
    fn validate_configuration(config_json: String, context: glixo::llm_types::types::ProviderContext) -> Result<glixo::llm_types::types::ConfigurationReport, String> {
        let mut ctx = context; ctx.configuration_json = config_json;
        let mut diagnostics = Vec::new();
        match parse_config(&ctx) { Ok((cfg, grant)) => if let Some(model) = cfg.get("model").and_then(Value::as_str) { if !models(&grant)?.iter().any(|m| m == model) { diagnostics.push("configured model is not present in /api/tags".to_owned()); } }, Err(e) => diagnostics.push(e) }
        Ok(glixo::llm_types::types::ConfigurationReport { valid: diagnostics.is_empty(), diagnostics })
    }
    fn list_models(context: glixo::llm_types::types::ProviderContext) -> Result<Vec<String>, String> { let (_, grant) = parse_config(&context)?; models(&grant) }
    // docs:snippet-start provider-request:rust
    fn start(req: glixo::llm_types::types::LlmRequest, context: glixo::llm_types::types::ProviderContext) -> Result<u32, String> {
        let (config, grant) = parse_config(&context)?;
        let context_window = context_window_tokens(&config)?;
        if req.model.trim().is_empty() { return Err("model_required".into()); }
        let caps = capabilities(&grant, &req.model)?;
        let body = chat_body(&req, &caps, context_window)?;
        let mut stream = NdjsonStream::open(HostBroker, request(&grant, "/api/chat", "POST", Some(serde_json::to_vec(&body).map_err(err_message)?)), 1024 * 1024)?;
        let status = stream.status()?;
        if !(200..=299).contains(&status) { stream.close(); return Err(format!("ollama_http_{status}")); }
        let handle = NEXT_STREAM.fetch_add(1, Ordering::Relaxed).max(1);
        STREAMS.with(|streams| { streams.borrow_mut().insert(handle, Session { stream, request_id: req.request_id, done: false, terminal_sent: false, cancelled: false, tool_index: 0, tool_calls_seen: false, pending: VecDeque::new() }); });
        Ok(handle)
    }
    // docs:snippet-end provider-request:rust
    fn next(handle: u32) -> Result<Option<glixo::llm_types::types::ProviderEvent>, String> {
        STREAMS.with(|all| {
            let mut all = all.borrow_mut();
            let session = all.get_mut(&handle).ok_or_else(|| "provider_stream_missing".to_owned())?;
            if session.terminal_sent { return Ok(None); }
            if session.cancelled {
                session.terminal_sent = true;
                session.pending.clear();
                session.stream.close();
                return Ok(Some(glixo::llm_types::types::ProviderEvent { finish: Some(glixo::llm_types::types::FinishReason::Cancelled), ..event(&session.request_id) }));
            }
            if let Some(pending) = session.pending.pop_front() {
                if pending.terminal { session.terminal_sent = true; session.done = true; session.stream.close(); }
                return Ok(Some(pending.event));
            }
            loop {
                if session.done { session.terminal_sent = true; session.stream.close(); return Ok(Some(glixo::llm_types::types::ProviderEvent { finish: Some(glixo::llm_types::types::FinishReason::Stop), ..event(&session.request_id) })); }
                let line = match session.stream.next_line()? { Some(v) if v.is_empty() => continue, Some(v) => v, None => return Err("ollama_stream_ended_before_done".into()) };
                let record: Value = serde_json::from_slice(&line).map_err(|_| "ollama_ndjson_record_invalid".to_owned())?;
                if let Some(upstream_error) = record.get("error").and_then(Value::as_str) { session.terminal_sent = true; session.stream.close(); return Ok(Some(glixo::llm_types::types::ProviderEvent { finish: Some(glixo::llm_types::types::FinishReason::Error), error: Some(glixo::llm_types::types::TypedError { code: "ollama_error".into(), message: upstream_error.chars().take(256).collect(), retryable: false, retry_after_ms: None }), ..event(&session.request_id) })); }
                let msg = &record["message"];
                let calls = msg["tool_calls"].as_array().map(Vec::as_slice).unwrap_or(&[]);
                if calls.len() > 32 {
                    session.pending.clear();
                    session.stream.close();
                    session.terminal_sent = true;
                    return Ok(Some(glixo::llm_types::types::ProviderEvent {
                        finish: Some(glixo::llm_types::types::FinishReason::Error),
                        error: Some(glixo::llm_types::types::TypedError {
                            code: "ollama_tool_call_limit_exceeded".into(),
                            message: "Ollama returned more than 32 tool calls in one record".into(),
                            retryable: false,
                            retry_after_ms: None,
                        }),
                        ..event(&session.request_id)
                    }));
                }
                if let Some(text) = msg["thinking"].as_str().filter(|s| !s.is_empty()) {
                    session.pending.push_back(PendingEvent { event: event_with_part(&session.request_id, glixo::llm_types::types::ContentPart::Reasoning(text.into())), terminal: false });
                }
                if let Some(text) = msg["content"].as_str().filter(|s| !s.is_empty()) {
                    session.pending.push_back(PendingEvent { event: event_with_part(&session.request_id, glixo::llm_types::types::ContentPart::Text(text.into())), terminal: false });
                }
                for call in calls {
                    let name = call["function"]["name"].as_str().unwrap_or("");
                    if name.is_empty() { continue; }
                    session.tool_calls_seen = true;
                    let args = call["function"]["arguments"].to_string();
                    let id = format!("{}:ollama:{}", session.request_id, session.tool_index);
                    session.tool_index += 1;
                    let detail = glixo::llm_types::types::ToolCallDetails { id, name: name.into(), arguments_fragment: Some(args), complete: true };
                    session.pending.push_back(PendingEvent { event: event_with_part(&session.request_id, glixo::llm_types::types::ContentPart::ToolCallDetails(detail)), terminal: false });
                }
                if record["done"].as_bool() == Some(true) {
                    session.pending.push_back(PendingEvent { event: terminal_event(&session.request_id, &record, session.tool_calls_seen), terminal: true });
                }
                if let Some(pending) = session.pending.pop_front() { return Ok(Some(pending.event)); }
            }
        })
    }
    fn cancel(handle: u32) { STREAMS.with(|all| { if let Some(session) = all.borrow_mut().get_mut(&handle) { if !session.terminal_sent { session.pending.clear(); session.stream.cancel(); session.cancelled = true; } } }); }
    fn drop(handle: u32) { STREAMS.with(|all| { if let Some(mut session) = all.borrow_mut().remove(&handle) { session.stream.close(); } }); }
}

fn terminal_event(request_id: &str, record: &Value, tool_calls_seen: bool) -> glixo::llm_types::types::ProviderEvent {
    let input = record["prompt_eval_count"].as_u64().unwrap_or(0).min(u32::MAX as u64) as u32;
    let output = record["eval_count"].as_u64().unwrap_or(0).min(u32::MAX as u64) as u32;
    let usage = glixo::llm_types::types::Usage { input_tokens: input, output_tokens: output, cached_tokens: None, reasoning_tokens: None, total_tokens: if record["prompt_eval_count"].is_number() && record["eval_count"].is_number() { Some(input.saturating_add(output)) } else { None } };
    let finish = finish_reason(record["done_reason"].as_str(), tool_calls_seen);
    glixo::llm_types::types::ProviderEvent { usage: Some(usage), finish: Some(finish), ..event(request_id) }
}

fn finish_reason(reason: Option<&str>, tool_calls_seen: bool) -> glixo::llm_types::types::FinishReason {
    if tool_calls_seen { return glixo::llm_types::types::FinishReason::Tool; }
    match reason.unwrap_or("stop") {
        "length" => glixo::llm_types::types::FinishReason::Length,
        "stop" | "" => glixo::llm_types::types::FinishReason::Stop,
        "tool" | "tool_calls" => glixo::llm_types::types::FinishReason::Tool,
        other => glixo::llm_types::types::FinishReason::Unknown(glixo::llm_types::types::UnknownRepresentation { name: other.into(), payload_json: None }),
    }
}

#[cfg(test)]
mod finish_reason_tests {
    use super::finish_reason;
    use super::glixo::llm_types::types::FinishReason;

    #[test]
    fn tool_call_turn_overrides_ollama_stop_reason() {
        assert!(matches!(finish_reason(Some("stop"), true), FinishReason::Tool));
    }

    #[test]
    fn non_tool_turn_keeps_ollama_finish_reason() {
        assert!(matches!(finish_reason(Some("stop"), false), FinishReason::Stop));
        assert!(matches!(finish_reason(Some("length"), false), FinishReason::Length));
    }
}


export!(OllamaProvider);
