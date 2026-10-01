use glixo_extension_sdk::http::{Broker, Header, Request as HttpRequest};
use serde_json::{json, Value};
use url::Url;

mod guest;

const MAX_RESPONSE_BYTES: usize = 128 * 1024;

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.as_object()?.get(key)?.as_str()
}

fn approved_endpoint(envelope: &Value) -> Result<(String, String), String> {
    if text(envelope, "kind") != Some("tools") || text(envelope, "contributionId") != Some("issue-lookup") {
        return Err("guest_envelope_invalid".into());
    }
    if text(envelope.get("configuration").ok_or("guest_envelope_invalid")?, "endpointName") != Some("issues") {
        return Err("endpoint_name_must_be_issues".into());
    }
    let endpoints = envelope.get("context").and_then(|v| v.get("endpoints")).and_then(Value::as_array)
        .ok_or("approved_issues_endpoint_missing")?;
    let endpoint = endpoints.iter().find(|endpoint| text(endpoint, "name") == Some("issues"))
        .ok_or("approved_issues_endpoint_missing")?;
    let handle = text(endpoint, "handle").filter(|h| !h.is_empty()).ok_or("approved_issues_endpoint_missing")?;
    let base = text(endpoint, "baseUrl").ok_or("approved_endpoint_url_invalid")?;
    let mut url = Url::parse(base).map_err(|_| "approved_endpoint_url_invalid")?;
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some()
        || url.query().is_some() || url.fragment().is_some() {
        return Err("approved_endpoint_url_invalid".into());
    }
    url.set_path("/mcp");
    Ok((url.to_string(), handle.to_owned()))
}

// docs:snippet-start issue-lookup-mcp:rust
fn call_request(url: String, endpoint_handle: String, issue_key: &str) -> Result<Value, String> {
    let mut broker = guest::HostBroker;
    let body = serde_json::to_vec(&json!({
        "jsonrpc":"2.0","id":1,"method":"tools/call",
        "params":{"name":"issues.lookup","arguments":{"issueKey":issue_key},"_meta":{
            "io.modelcontextprotocol/protocolVersion":"2026-07-28",
            "io.modelcontextprotocol/clientInfo":{"name":"glixo-issue-lookup","version":"0.1.0"}
        }}
    })).map_err(|_| "mcp_request_invalid")?;
    let request = HttpRequest {
        url,
        method: "POST".into(),
        headers: vec![
            Header { name: "Accept".into(), value: "application/json".into() },
            Header { name: "MCP-Protocol-Version".into(), value: "2026-07-28".into() },
            Header { name: "Mcp-Method".into(), value: "tools/call".into() },
            Header { name: "Mcp-Name".into(), value: "issues.lookup".into() },
        ],
        body: Some(body), content_type: Some("application/json".into()), timeout_ms: Some(15_000),
        max_response_bytes: Some(MAX_RESPONSE_BYTES as u32), accepted_status_min: Some(200),
        accepted_status_max: Some(299), endpoint_handle: Some(endpoint_handle), secret_handle: None,
        auth_header: None, auth_scheme: None,
    };
    let handle = broker.start(request).map_err(|_| "mcp_request_denied")?;
    let mut complete = false;
    let result = (|| {
        if broker.status(handle).map_err(|_| "mcp_status_failed")? != 200 { return Err("mcp_http_status_invalid".into()); }
        let headers = broker.response_headers(handle).map_err(|_| "mcp_headers_failed")?;
        let content_type = headers.iter().find(|h| h.name.eq_ignore_ascii_case("content-type"))
            .map(|h| h.value.as_str()).ok_or("mcp_content_type_invalid")?;
        let media_type = content_type.split(';').next().unwrap_or("").trim();
        if !media_type.eq_ignore_ascii_case("application/json") { return Err("mcp_content_type_invalid".into()); }
        let mut bytes = Vec::new();
        let mut empty_reads = 0;
        loop {
            let chunk = broker.read(handle, 16 * 1024).map_err(|_| "http_read_failed")?;
            let Some(chunk) = chunk else { break; };
            if chunk.is_empty() {
                empty_reads += 1;
                if empty_reads > 32 { return Err("mcp_response_stalled".into()); }
                continue;
            }
            empty_reads = 0;
            if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES { return Err("mcp_response_too_large".into()); }
            bytes.extend_from_slice(&chunk);
        }
        let response: Value = serde_json::from_slice(&bytes).map_err(|_| "mcp_response_invalid_json")?;
        if text(&response, "jsonrpc") != Some("2.0") || response.get("id").and_then(Value::as_u64) != Some(1)
            || response.get("error").is_some() { return Err("mcp_call_failed".into()); }
        let content = response.get("result").and_then(|r| r.get("content")).and_then(Value::as_array)
            .ok_or("mcp_result_content_missing")?;
        if content.len() != 1 || text(&content[0], "type") != Some("text") { return Err("mcp_result_content_invalid".into()); }
        let summary = text(&content[0], "text").ok_or("mcp_result_content_invalid")?;
        if summary.len() > 64 * 1024 { return Err("mcp_result_content_invalid".into()); }
        complete = true;
        Ok(json!({"issueKey":issue_key,"summary":summary}))
    })();
    if !complete { broker.cancel(handle); }
    broker.drop_response(handle);
    result
}

pub fn invoke(request_json: &str) -> Result<String, String> {
    let envelope: Value = serde_json::from_str(request_json).map_err(|_| "guest_envelope_invalid")?;
    let issue_key = text(envelope.get("input").ok_or("guest_envelope_invalid")?, "issueKey")
        .filter(|key| {
            let (prefix, suffix) = key.split_once('-').unwrap_or(("", ""));
            !prefix.is_empty() && prefix.len() <= 10 && prefix.as_bytes()[0].is_ascii_uppercase()
                && prefix.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
                && !suffix.is_empty() && suffix.len() <= 9 && suffix.bytes().all(|b| b.is_ascii_digit()) && !suffix.starts_with('0')
        }).ok_or("issue_key_invalid")?;
    let (url, endpoint) = approved_endpoint(&envelope)?;
    let response = call_request(url, endpoint, issue_key)?;
    serde_json::to_string(&response).map_err(|_| "guest_result_invalid".into())
}
// docs:snippet-end issue-lookup-mcp:rust

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unapproved_endpoint_before_broker_use() {
        let envelope = json!({"kind":"tools","contributionId":"issue-lookup","configuration":{"endpointName":"issues"},"input":{"issueKey":"DEMO-17"},"context":{"endpoints":[]}});
        assert_eq!(approved_endpoint(&envelope).unwrap_err(), "approved_issues_endpoint_missing");
        assert_eq!(invoke(&envelope.to_string()).unwrap_err(), "approved_issues_endpoint_missing");
    }

    #[test]
    fn validates_issue_key_and_host_envelope() {
        let envelope = json!({"kind":"tools","contributionId":"issue-lookup","configuration":{"endpointName":"issues"},"input":{"issueKey":"bad"},"context":{"endpoints":[{"name":"issues","handle":"opaque","baseUrl":"https://example.test"}]}});
        assert_eq!(invoke(&envelope.to_string()).unwrap_err(), "issue_key_invalid");
    }

    #[test]
    fn rejects_terminal_newline_in_issue_key() {
        let envelope = json!({"kind":"tools","contributionId":"issue-lookup","configuration":{"endpointName":"issues"},"input":{"issueKey":"DEMO-17\n"},"context":{"endpoints":[{"name":"issues","handle":"opaque","baseUrl":"https://example.test"}]}});
        assert_eq!(invoke(&envelope.to_string()).unwrap_err(), "issue_key_invalid");
    }
}
