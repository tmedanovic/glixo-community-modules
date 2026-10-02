use glixo_extension_sdk::http::{Broker, Header, Request as HttpRequest};
use glixo_extension_sdk::state::ScopedState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

mod guest;

pub const REFERENCE_ID: &str = "mail-watch";
pub const CONTRIBUTION_ID: &str = "mail-watch";
pub const EVENT_TYPE: &str = "mail.received";
const GRAPH_HOST: &str = "graph.microsoft.com";
const GRAPH_PATH: &str = "/v1.0/me/mailFolders/inbox/messages/delta";
const INITIAL_DELTA_URL: &str = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=id,receivedDateTime,from&$top=10";
const MAX_PAGES_PER_WAKE: usize = 5;
const MAX_PAGE_BYTES: usize = 1_000_000;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    #[serde(default)]
    pub initialized: bool,
    #[serde(default)]
    pub initializing: bool,
    #[serde(default)]
    pub delta_url: Option<String>,
    #[serde(default)]
    pub pending_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Configuration {
    pub max_pages_per_wake: Option<usize>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    pub operation: String,
    pub checkpoint: Option<Checkpoint>,
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Context {
    pub resource_handles: Option<std::collections::HashMap<String, String>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceRequest {
    pub kind: String,
    pub contribution_id: String,
    pub configuration: Option<Configuration>,
    pub input: Input,
    pub context: Option<Context>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MailPayload {
    pub message_id: String,
    pub received_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sender: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MailEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub idempotency_key: String,
    pub payload: MailPayload,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServiceResult {
    pub checkpoint: Checkpoint,
    pub events: Vec<MailEvent>,
    pub health: String,
}

/// docs:snippet-start mail-watch-handler:rust
/// Performs one bounded Inbox delta poll through the host-issued HTTP broker.
/// It does not read message bodies, send mail, or loop beyond its page budget.
pub fn handle_mail_watch<B: Broker>(
    request: &ServiceRequest,
    broker: &mut B,
    _state: &mut dyn ScopedState,
) -> Result<ServiceResult, String> {
    if request.kind != "backgroundServices" || request.contribution_id != CONTRIBUTION_ID {
        return Err("contribution_mismatch".into());
    }
    let operation = request.input.operation.as_str();
    if !matches!(operation, "initialize" | "wake" | "health" | "stop") {
        return Err("service_operation_invalid".into());
    }
    let checkpoint = request.input.checkpoint.clone().unwrap_or_default();
    if matches!(operation, "health" | "stop") {
        return Ok(healthy(checkpoint));
    }
    let handles = request.context.as_ref().and_then(|context| context.resource_handles.as_ref());
    let _oauth_handle = handles.and_then(|items| items.get("oauth")).filter(|value| !value.is_empty())
        .ok_or_else(|| "graph_oauth_lease_missing".to_string())?;
    let page_limit = request.configuration.as_ref().and_then(|config| config.max_pages_per_wake).unwrap_or(MAX_PAGES_PER_WAKE);
    if !(1..=MAX_PAGES_PER_WAKE).contains(&page_limit) { return Err("mail_watch_page_limit_invalid".into()); }

    let mut initializing = operation == "initialize" || checkpoint.initializing || !checkpoint.initialized;
    let mut cursor = checkpoint.pending_url.clone().or(checkpoint.delta_url.clone()).unwrap_or_else(|| INITIAL_DELTA_URL.into());
    let mut delta_url = checkpoint.delta_url.clone();
    let mut pending_url: Option<String> = None;
    let mut events = Vec::new();
    for _ in 0..page_limit {
        let validated = validate_graph_delta_url(&cursor)?;
        let document = read_graph_json(broker, HttpRequest {
            url: validated,
            method: "GET".into(),
            headers: vec![Header { name: "Accept".into(), value: "application/json".into() }],
            body: None,
            content_type: None,
            timeout_ms: Some(5000),
            max_response_bytes: Some(MAX_PAGE_BYTES as u32),
            accepted_status_min: Some(200),
            accepted_status_max: Some(299),
            endpoint_handle: None,
            secret_handle: Some("oauth".into()),
            auth_header: Some("Authorization".into()),
            auth_scheme: Some("Bearer".into()),
        })?;
        let values = document.get("value").and_then(Value::as_array).ok_or_else(|| "graph_delta_value_invalid".to_string())?;
        if !initializing {
            for item in values {
                if item.get("@removed").is_some() { continue; }
                if let Some(event) = to_mail_event(item) { events.push(event); }
            }
        }
        if let Some(next) = document.get("@odata.nextLink").and_then(Value::as_str) {
            validate_graph_delta_url(next)?;
            cursor = next.to_string();
            pending_url = Some(next.to_string());
            continue;
        }
        let final_delta = document.get("@odata.deltaLink").and_then(Value::as_str)
            .ok_or_else(|| "graph_delta_link_missing".to_string())?;
        delta_url = Some(validate_graph_delta_url(final_delta)?);
        pending_url = None;
        initializing = false;
        break;
    }
    if pending_url.is_none() && initializing { return Err("graph_initial_sync_incomplete".into()); }
    Ok(ServiceResult {
        checkpoint: Checkpoint { initialized: !initializing, initializing, delta_url, pending_url },
        events,
        health: "healthy".into(),
    })
}
/// docs:snippet-end mail-watch-handler:rust

pub fn validate_graph_delta_url(value: &str) -> Result<String, String> {
    let url = Url::parse(value).map_err(|_| "graph_delta_url_invalid".to_string())?;
    if url.scheme() != "https" || !url.host_str().is_some_and(|host| host.eq_ignore_ascii_case(GRAPH_HOST))
        || url.port().is_some_and(|port| port != 443) || !url.username().is_empty() || url.password().is_some()
        || url.fragment().is_some() || !url.path().eq_ignore_ascii_case(GRAPH_PATH) {
        return Err("graph_delta_url_outside_scope".into());
    }
    Ok(value.into())
}

fn read_graph_json<B: Broker>(broker: &mut B, request: HttpRequest) -> Result<Value, String> {
    let handle = broker.start(request)?;
    let mut complete = false;
    let result = (|| {
        let status = broker.status(handle)?;
        if !(200..=299).contains(&status) { return Err("graph_http_status_rejected".into()); }
        let _ = broker.response_headers(handle)?;
        let mut body = Vec::new();
        loop {
            match broker.read(handle, 16 * 1024)? {
                Some(chunk) => {
                    if body.len() + chunk.len() > MAX_PAGE_BYTES { return Err("graph_response_too_large".into()); }
                    body.extend_from_slice(&chunk);
                }
                None => break,
            }
        }
        let value: Value = serde_json::from_slice(&body).map_err(|_| "graph_response_invalid".to_string())?;
        if !value.is_object() { return Err("graph_response_invalid".into()); }
        complete = true;
        Ok(value)
    })();
    if !complete { broker.cancel(handle); }
    broker.drop_response(handle);
    result
}

fn to_mail_event(message: &Value) -> Option<MailEvent> {
    let id = message.get("id")?.as_str()?;
    let received = message.get("receivedDateTime")?.as_str()?;
    if id.is_empty() || received.is_empty() { return None; }
    let sender = message.get("from").and_then(|from| from.get("emailAddress"))
        .and_then(|email| email.get("address")).and_then(Value::as_str)
        .map(|address| address.chars().take(320).collect());
    Some(MailEvent {
        event_type: EVENT_TYPE.into(),
        idempotency_key: format!("mail:{}", stable_id(id)),
        payload: MailPayload { message_id: id.into(), received_at: received.into(), sender },
    })
}

fn stable_id(value: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in value.as_bytes() { hash = (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3); }
    format!("{hash:016x}")
}

fn healthy(checkpoint: Checkpoint) -> ServiceResult {
    ServiceResult { checkpoint, events: Vec::new(), health: "healthy".into() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use glixo_extension_sdk::http::Broker;
    use serde_json::json;
    use std::collections::{HashMap, VecDeque};

    #[derive(Default)]
    struct EmptyState;
    impl ScopedState for EmptyState {
        fn get(&mut self, _key: &str) -> Result<Option<String>, String> { Ok(None) }
        fn set(&mut self, _key: &str, _value: &str) -> Result<(), String> { Ok(()) }
        fn list(&mut self, _prefix: &str) -> Result<Vec<String>, String> { Ok(Vec::new()) }
        fn delete(&mut self, _key: &str) -> Result<bool, String> { Ok(false) }
    }

    struct FixtureBroker {
        responses: VecDeque<Vec<u8>>,
        requests: Vec<HttpRequest>,
        active: HashMap<u32, (Vec<u8>, usize)>,
        dropped: Vec<u32>,
        cancelled: Vec<u32>,
    }
    impl FixtureBroker {
        fn new(responses: Vec<Value>) -> Self {
            Self { responses: responses.into_iter().map(|value| serde_json::to_vec(&value).unwrap()).collect(), requests: Vec::new(), active: HashMap::new(), dropped: Vec::new(), cancelled: Vec::new() }
        }
    }
    impl Broker for FixtureBroker {
        fn start(&mut self, request: HttpRequest) -> Result<u32, String> {
            self.requests.push(request);
            let handle = self.active.len() as u32 + 1;
            let body = self.responses.pop_front().ok_or_else(|| "fixture_exhausted".to_string())?;
            self.active.insert(handle, (body, 0));
            Ok(handle)
        }
        fn status(&mut self, _handle: u32) -> Result<u16, String> { Ok(200) }
        fn response_headers(&mut self, _handle: u32) -> Result<Vec<Header>, String> { Ok(vec![Header { name: "content-type".into(), value: "application/json".into() }]) }
        fn read(&mut self, handle: u32, max: u32) -> Result<Option<Vec<u8>>, String> {
            let (bytes, offset) = self.active.get_mut(&handle).ok_or_else(|| "missing".to_string())?;
            if *offset >= bytes.len() { return Ok(None); }
            let end = (*offset + max as usize).min(bytes.len());
            let chunk = bytes[*offset..end].to_vec();
            *offset = end;
            Ok(Some(chunk))
        }
        fn cancel(&mut self, handle: u32) { self.cancelled.push(handle); }
        fn drop_response(&mut self, handle: u32) { self.dropped.push(handle); self.active.remove(&handle); }
    }

    fn service_request(operation: &str, checkpoint: Option<Checkpoint>) -> ServiceRequest {
        ServiceRequest {
            kind: "backgroundServices".into(), contribution_id: CONTRIBUTION_ID.into(),
            configuration: Some(Configuration { max_pages_per_wake: Some(5) }),
            input: Input { operation: operation.into(), checkpoint },
            context: Some(Context { resource_handles: Some(HashMap::from([("oauth".into(), "secret-slot-lease".into())])) }),
        }
    }

    #[test]
    fn initialization_suppresses_old_mail() {
        let mut broker = FixtureBroker::new(vec![json!({"value":[{"id":"old","receivedDateTime":"2026-01-01T00:00:00Z"}],"@odata.deltaLink":"https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=seed"})]);
        let result = handle_mail_watch(&service_request("initialize", None), &mut broker, &mut EmptyState).unwrap();
        assert!(result.checkpoint.initialized);
        assert!(result.events.is_empty());
        assert_eq!(broker.requests[0].secret_handle.as_deref(), Some("oauth"));
        assert_eq!(broker.requests[0].method, "GET");
        assert!(broker.requests[0].body.is_none());
        assert_eq!(broker.dropped, vec![1]);
        assert!(broker.cancelled.is_empty());
    }

    #[test]
    fn wake_paginates_emits_only_metadata_and_repeats_key() {
        let next = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=opaque";
        let delta = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=opaque";
        let message = json!({"id":"AAMkAGI1","receivedDateTime":"2026-10-01T10:00:00Z","from":{"emailAddress":{"address":"sender@example.test"}},"body":{"content":"never emitted"}});
        let mut broker = FixtureBroker::new(vec![json!({"value":[message],"@odata.nextLink":next}), json!({"value":[message],"@odata.deltaLink":delta})]);
        let checkpoint = Checkpoint { initialized: true, delta_url: Some("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=prior".into()), ..Default::default() };
        let result = handle_mail_watch(&service_request("wake", Some(checkpoint)), &mut broker, &mut EmptyState).unwrap();
        assert_eq!(result.checkpoint.delta_url.as_deref(), Some(delta));
        assert_eq!(result.events.len(), 2);
        assert_eq!(result.events[0].idempotency_key, result.events[1].idempotency_key);
        assert_eq!(result.events[0].payload.sender.as_deref(), Some("sender@example.test"));
        assert!(!serde_json::to_string(&result.events).unwrap().contains("never emitted"));
        assert_eq!(broker.requests.len(), 2);
    }

    #[test]
    fn unsafe_next_link_is_never_requested() {
        let mut broker = FixtureBroker::new(vec![json!({"value":[],"@odata.nextLink":"https://evil.example/v1.0/me/mailFolders/inbox/messages/delta"})]);
        let checkpoint = Checkpoint { initialized: true, delta_url: Some(INITIAL_DELTA_URL.into()), ..Default::default() };
        let error = handle_mail_watch(&service_request("wake", Some(checkpoint)), &mut broker, &mut EmptyState).unwrap_err();
        assert!(error.contains("outside_scope"));
        assert_eq!(broker.requests.len(), 1);
        assert_eq!(broker.dropped, vec![1]);
    }

    #[test]
    fn lifecycle_health_stop_need_no_credentials() {
        for operation in ["health", "stop"] {
            let request = ServiceRequest { kind: "backgroundServices".into(), contribution_id: CONTRIBUTION_ID.into(), configuration: None, input: Input { operation: operation.into(), checkpoint: None }, context: None };
            let mut broker = FixtureBroker::new(vec![]);
            assert!(handle_mail_watch(&request, &mut broker, &mut EmptyState).unwrap().events.is_empty());
            assert!(broker.requests.is_empty());
        }
    }

    #[test]
    fn delta_link_scope_rejects_alternate_authorities_and_paths() {
        for value in ["http://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta", "https://evil.example/v1.0/me/mailFolders/inbox/messages/delta", "https://graph.microsoft.com.evil.example/v1.0/me/mailFolders/inbox/messages/delta", "https://user@graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta", "https://graph.microsoft.com:444/v1.0/me/mailFolders/inbox/messages/delta", "https://graph.microsoft.com/v1.0/me/messages"] {
            assert!(validate_graph_delta_url(value).is_err(), "accepted {value}");
        }
    }
}
