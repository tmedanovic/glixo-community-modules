use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use serde_json::Value;

wit_bindgen::generate!({ path: "../../rust/wit", world: "provider-compat", generate_all });

struct RustSecretHttpConformance;
struct Session {
    request_id: String,
    http_handle: Option<u32>,
    cancelled: bool,
    text_sent: bool,
    terminal_sent: bool,
}

thread_local! {
    static SESSIONS: RefCell<HashMap<u32, Session>> = RefCell::new(HashMap::new());
}

static NEXT_SESSION: AtomicU32 = AtomicU32::new(1);

fn event(request_id: &str) -> glixo::llm_types::types::ProviderEvent {
    glixo::llm_types::types::ProviderEvent {
        request_id: request_id.to_owned(),
        part: None,
        usage: None,
        finish: None,
        warning: None,
        error: None,
        provider_request_id: None,
        provider_response_id: None,
    }
}

impl exports::glixo::llm_provider_compat::provider::Guest for RustSecretHttpConformance {
    fn describe(
        _context: glixo::llm_types::types::ProviderContext,
    ) -> Result<glixo::llm_types::types::ProviderDescriptor, String> {
        Ok(glixo::llm_types::types::ProviderDescriptor {
            id: "glixo.rust-secret-http-conformance".into(),
            name: "Rust v3 secret HTTP conformance".into(),
            version: "1.0.0".into(),
            models: vec!["fixture".into()],
            capabilities: vec![
                glixo::llm_types::types::ProviderCapability { name: "chat".into(), optional: false },
                glixo::llm_types::types::ProviderCapability { name: "streaming".into(), optional: false },
            ],
        })
    }

    fn validate_configuration(
        config_json: String,
        _context: glixo::llm_types::types::ProviderContext,
    ) -> Result<glixo::llm_types::types::ConfigurationReport, String> {
        let mut diagnostics = Vec::new();
        let configuration: Value = serde_json::from_str(&config_json)
            .map_err(|_| "configuration_json_invalid".to_owned())?;
        let object = configuration.as_object()
            .ok_or_else(|| "configuration_object_required".to_owned())?;
        if !object.get("baseUrl").and_then(Value::as_str).is_some_and(|value| !value.trim().is_empty()) {
            diagnostics.push("base_url_required".to_owned());
        }
        if let Some(api_key) = object.get("apiKey").and_then(Value::as_str) {
            if !api_key.starts_with("secret-ref:") {
                diagnostics.push("raw_secret_not_allowed_apiKey".to_owned());
            }
        }
        Ok(glixo::llm_types::types::ConfigurationReport {
            valid: diagnostics.is_empty(),
            diagnostics,
        })
    }

    fn list_models(
        _context: glixo::llm_types::types::ProviderContext,
    ) -> Result<Vec<String>, String> {
        Ok(vec!["fixture".into()])
    }

    fn start(
        request: glixo::llm_types::types::LlmRequest,
        context: glixo::llm_types::types::ProviderContext,
    ) -> Result<u32, String> {
        let endpoint = context.endpoints.iter()
            .find(|endpoint| endpoint.name == "fixture" && !endpoint.handle.is_empty())
            .ok_or_else(|| "approved_fixture_endpoint_missing".to_owned())?;
        let url = format!("{}/v1/chat/completions", endpoint.base_url.trim_end_matches('/'));
        let handle = glixo::http::broker::http_start(&glixo::http::types::HttpRequest {
            url,
            method: "POST".into(),
            headers: Vec::new(),
            body: Some(b"{}".to_vec()),
            content_type: Some("application/json".into()),
            timeout_ms: Some(5_000),
            max_response_bytes: Some(1024),
            accepted_status_min: Some(200),
            accepted_status_max: Some(299),
            endpoint_handle: Some(endpoint.handle.clone()),
            secret_handle: Some("apiKey".into()),
            auth_header: Some("Authorization".into()),
            auth_scheme: Some("bearer".into()),
        })?;
        let status = match glixo::http::broker::http_status(handle) {
            Ok(status) => status,
            Err(error) => {
                glixo::http::broker::http_drop(handle);
                return Err(error);
            }
        };
        if !(200..=299).contains(&status) {
            glixo::http::broker::http_drop(handle);
            return Err(format!("fixture_http_{status}"));
        }

        let session = NEXT_SESSION.fetch_add(1, Ordering::Relaxed).max(1);
        SESSIONS.with(|sessions| {
            sessions.borrow_mut().insert(session, Session {
                request_id: request.request_id,
                http_handle: Some(handle),
                cancelled: false,
                text_sent: false,
                terminal_sent: false,
            });
        });
        Ok(session)
    }

    fn next(handle: u32) -> Result<Option<glixo::llm_types::types::ProviderEvent>, String> {
        SESSIONS.with(|sessions| {
            let mut sessions = sessions.borrow_mut();
            let session = sessions.get_mut(&handle).ok_or_else(|| "provider_stream_missing".to_owned())?;
            if session.terminal_sent {
                return Ok(None);
            }
            if session.cancelled {
                session.terminal_sent = true;
                release_http(session, false);
                return Ok(Some(glixo::llm_types::types::ProviderEvent {
                    finish: Some(glixo::llm_types::types::FinishReason::Cancelled),
                    ..event(&session.request_id)
                }));
            }
            if !session.text_sent {
                session.text_sent = true;
                return Ok(Some(glixo::llm_types::types::ProviderEvent {
                    part: Some(glixo::llm_types::types::ContentPart::Text("Rust v3 request-scoped fixture".into())),
                    ..event(&session.request_id)
                }));
            }
            session.terminal_sent = true;
            release_http(session, false);
            Ok(Some(glixo::llm_types::types::ProviderEvent {
                finish: Some(glixo::llm_types::types::FinishReason::Stop),
                ..event(&session.request_id)
            }))
        })
    }

    fn cancel(handle: u32) {
        SESSIONS.with(|sessions| {
            if let Some(session) = sessions.borrow_mut().get_mut(&handle) {
                if !session.terminal_sent {
                    session.cancelled = true;
                    release_http(session, true);
                }
            }
        });
    }

    fn drop(handle: u32) {
        SESSIONS.with(|sessions| {
            if let Some(mut session) = sessions.borrow_mut().remove(&handle) {
                release_http(&mut session, false);
            }
        });
    }
}

fn release_http(session: &mut Session, cancel: bool) {
    if let Some(handle) = session.http_handle.take() {
        if cancel {
            glixo::http::broker::http_cancel(handle);
        }
        glixo::http::broker::http_drop(handle);
    }
}

export!(RustSecretHttpConformance);
