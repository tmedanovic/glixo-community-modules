use glixo_extension_sdk::guest::GuestEnvelope;
use glixo_extension_sdk::workspace::Workspace;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashSet};

wit_bindgen::generate!({ path: "wit", world: "contribution", generate_all });

const MAX_REQUEST_BYTES: usize = 128 * 1024;
const MAX_JSON_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, PartialEq, Eq)]
struct FileItem {
    path: String,
    bytes: u64,
}

// docs:snippet-start workspace-health-handler:rust
pub fn handle(request_json: &str, reader: &mut impl Workspace) -> Result<String, String> {
    if request_json.len() > MAX_REQUEST_BYTES {
        return Err("guest_envelope_invalid".into());
    }
    let envelope: GuestEnvelope<Value> =
        serde_json::from_str(request_json).map_err(|_| "guest_envelope_invalid")?;
    if envelope.kind != "tools" || envelope.contribution_id != "inspect" {
        return Err("contribution_mismatch".into());
    }
    if envelope.context.session_id.trim().is_empty() {
        return Err("guest_envelope_invalid".into());
    }
    let handle = envelope
        .context
        .resource_handles
        .get("workspace")
        .filter(|value| !value.trim().is_empty())
        .ok_or("workspace_handle_missing")?;
    let input = envelope.input.as_object().ok_or("input_invalid")?;
    let limit = optional_integer(input, "maxFiles", 100, 1, 100, "input_limit_invalid")?;
    let raw = reader.search(handle, "", limit as u32)?;
    let (items, truncated) = read_inventory(&raw, limit as usize)?;
    let output = summarize(items, truncated)?;
    serde_json::to_string(&output).map_err(|_| "guest_result_invalid".into())
}
// docs:snippet-end workspace-health-handler:rust

fn optional_integer(
    input: &Map<String, Value>,
    key: &str,
    fallback: u64,
    minimum: u64,
    maximum: u64,
    error: &'static str,
) -> Result<u64, String> {
    let Some(value) = input.get(key) else {
        return Ok(fallback);
    };
    let value = value
        .as_u64()
        .filter(|value| *value >= minimum && *value <= maximum)
        .ok_or(error)?;
    Ok(value)
}

fn read_inventory(raw: &str, limit: usize) -> Result<(Vec<FileItem>, bool), String> {
    let value: Value = serde_json::from_str(raw).map_err(|_| "workspace_search_result_invalid")?;
    let object = value.as_object().ok_or("workspace_search_result_invalid")?;
    let array = object
        .get("items")
        .and_then(Value::as_array)
        .ok_or("workspace_search_result_invalid")?;
    if array.len() > limit {
        return Err("workspace_search_result_invalid".into());
    }
    let truncated = object
        .get("truncated")
        .and_then(Value::as_bool)
        .ok_or("workspace_search_result_invalid")?;
    let mut seen = HashSet::with_capacity(array.len());
    let mut items = Vec::with_capacity(array.len());
    for item in array {
        let fields = item.as_object().ok_or("workspace_search_item_invalid")?;
        let path = fields
            .get("path")
            .and_then(Value::as_str)
            .filter(|path| valid_path(path))
            .ok_or("workspace_search_item_invalid")?;
        let bytes = fields
            .get("bytes")
            .and_then(Value::as_u64)
            .filter(|bytes| *bytes <= MAX_JSON_INTEGER)
            .ok_or("workspace_search_item_invalid")?;
        if !seen.insert(path.to_owned()) {
            return Err("workspace_search_item_invalid".into());
        }
        items.push(FileItem {
            path: path.to_owned(),
            bytes,
        });
    }
    items.sort_by(|left, right| left.path.as_bytes().cmp(right.path.as_bytes()));
    Ok((items, truncated))
}

fn valid_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path.contains(':')
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn summarize(items: Vec<FileItem>, truncated: bool) -> Result<Value, String> {
    let mut total = 0u64;
    let mut extensions = BTreeMap::<String, u64>::new();
    for item in &items {
        total = total
            .checked_add(item.bytes)
            .filter(|value| *value <= MAX_JSON_INTEGER)
            .ok_or("workspace_search_result_invalid")?;
        let name = item.path.rsplit('/').next().unwrap_or(&item.path);
        let extension = name
            .rfind('.')
            .filter(|index| *index > 0)
            .map(|index| name[index..].to_lowercase())
            .unwrap_or_else(|| "[none]".into());
        *extensions.entry(extension).or_default() += 1;
    }
    let mut largest = items.clone();
    largest.sort_by(|left, right| {
        right
            .bytes
            .cmp(&left.bytes)
            .then_with(|| left.path.as_bytes().cmp(right.path.as_bytes()))
    });
    largest.truncate(10);
    let totals = if truncated {
        Value::Null
    } else {
        json!({ "fileCount": items.len(), "bytes": total })
    };
    Ok(json!({
        "sampledFiles": items.len(), "sampledBytes": total, "truncated": truncated,
        "eligibleFileTotals": totals, "sampledExtensions": extensions,
        "largestFiles": largest.into_iter().map(|item| json!({"path": item.path, "bytes": item.bytes})).collect::<Vec<_>>()
    }))
}

struct GuestImpl;
struct HostWorkspace;
impl Workspace for HostWorkspace {
    fn search(&mut self, handle: &str, query: &str, limit: u32) -> Result<String, String> {
        glixo::contribution::broker::workspace_search(handle, query, limit)
    }
    fn read(&mut self, _handle: &str, _path: &str, _max_bytes: u32) -> Result<String, String> {
        Err("workspace_read_not_used".into())
    }
}

impl exports::glixo::contribution::guest::Guest for GuestImpl {
    fn invoke(request_json: String) -> Result<String, String> {
        handle(&request_json, &mut HostWorkspace)
    }
}

export!(GuestImpl);

#[cfg(test)]
mod tests;
