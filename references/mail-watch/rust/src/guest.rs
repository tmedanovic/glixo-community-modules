wit_bindgen::generate!({
    path: "wit",
    world: "contribution",
    generate_all,
});

use exports::glixo::contribution::guest::Guest;
use glixo_extension_sdk::http::{Broker, Header, Request};
use glixo_extension_sdk::state::ScopedState;

struct Component;
export!(Component);

struct HostBroker;

impl Broker for HostBroker {
    fn start(&mut self, request: Request) -> Result<u32, String> {
        let wit_request = glixo::http::types::HttpRequest {
            url: request.url,
            method: request.method,
            headers: request.headers.into_iter().map(|header| glixo::http::types::Header {
                name: header.name,
                value: header.value,
            }).collect(),
            body: request.body.map(|bytes| bytes.into_iter().map(|byte| byte as u8).collect()),
            content_type: request.content_type,
            timeout_ms: request.timeout_ms,
            max_response_bytes: request.max_response_bytes,
            accepted_status_min: request.accepted_status_min,
            accepted_status_max: request.accepted_status_max,
            endpoint_handle: request.endpoint_handle,
            secret_handle: request.secret_handle,
            auth_header: request.auth_header,
            auth_scheme: request.auth_scheme,
        };
        glixo::http::broker::http_start(&wit_request)
    }

    fn status(&mut self, handle: u32) -> Result<u16, String> {
        glixo::http::broker::http_status(handle)
    }

    fn response_headers(&mut self, handle: u32) -> Result<Vec<Header>, String> {
        glixo::http::broker::http_response_headers(handle).map(|headers| headers.into_iter()
            .map(|header| Header { name: header.name, value: header.value }).collect())
    }

    fn read(&mut self, handle: u32, max_bytes: u32) -> Result<Option<Vec<u8>>, String> {
        glixo::http::broker::http_read(handle, max_bytes)
            .map(|chunk| chunk.map(|bytes| bytes.into_iter().map(|byte| byte as u8).collect()))
    }

    fn cancel(&mut self, handle: u32) {
        glixo::http::broker::http_cancel(handle)
    }

    fn drop_response(&mut self, handle: u32) {
        glixo::http::broker::http_drop(handle)
    }
}

struct HostState;

impl ScopedState for HostState {
    fn get(&mut self, key: &str) -> Result<Option<String>, String> {
        glixo::contribution::broker::state_get(key)
    }

    fn set(&mut self, key: &str, value: &str) -> Result<(), String> {
        glixo::contribution::broker::state_set(key, value)
    }

    fn list(&mut self, prefix: &str) -> Result<Vec<String>, String> {
        glixo::contribution::broker::state_list(prefix)
    }

    fn delete(&mut self, key: &str) -> Result<bool, String> {
        glixo::contribution::broker::state_delete(key)
    }
}

impl Guest for Component {
    fn invoke(request_json: String) -> Result<String, String> {
        let request: crate::ServiceRequest = serde_json::from_str(&request_json)
            .map_err(|_| "guest_request_invalid".to_owned())?;
        let response = crate::handle_mail_watch(&request, &mut HostBroker, &mut HostState)?;
        serde_json::to_string(&response).map_err(|_| "guest_response_invalid".to_owned())
    }
}
