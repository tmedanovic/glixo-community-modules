use glixo_extension_sdk::state::ScopedState;
use serde_json::{json, Map, Value};

wit_bindgen::generate!({ path: "wit", world: "contribution", generate_all });

const CONTRIBUTION_ID: &str = "storage";
const TEST_PREFIX: &str = "workspace-storage/test/";
const MAX_VALUE_BYTES: usize = 4096;

struct HostState;
impl ScopedState for HostState {
    fn get(&mut self, key: &str) -> Result<Option<String>, String> { glixo::contribution::broker::state_get(key) }
    fn set(&mut self, key: &str, value: &str) -> Result<(), String> { glixo::contribution::broker::state_set(key, value) }
    fn list(&mut self, prefix: &str) -> Result<Vec<String>, String> { glixo::contribution::broker::state_list(prefix) }
    fn delete(&mut self, key: &str) -> Result<bool, String> { glixo::contribution::broker::state_delete(key) }
}

fn valid_key(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty() && bytes.len() <= 64
        && (bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit())
        && bytes[1..].iter().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(byte))
}

fn storage_key(value: Option<&str>) -> Result<String, String> {
    let value = value.ok_or_else(|| "storage_key_invalid".to_string())?;
    if !valid_key(value) { return Err("storage_key_invalid".into()); }
    Ok(format!("{TEST_PREFIX}{value}"))
}

fn object<'a>(value: &'a Value) -> Result<&'a Map<String, Value>, String> {
    value.as_object().ok_or_else(|| "input_object_required".into())
}
fn field<'a>(input: &'a Map<String, Value>, name: &str) -> Option<&'a str> {
    input.get(name).and_then(Value::as_str)
}
fn ensure_fields(input: &Map<String, Value>, allowed: &[&str]) -> Result<(), String> {
    if input.keys().all(|name| allowed.contains(&name.as_str())) { Ok(()) }
    else { Err("storage_input_invalid".into()) }
}

// docs:snippet-start workspace-storage-handler:rust
pub fn handle_storage(envelope: &Value, state: &mut impl ScopedState) -> Result<Value, String> {
    let envelope = object(envelope)?;
    if field(envelope, "kind") != Some("tools") || field(envelope, "contributionId") != Some(CONTRIBUTION_ID) {
        return Err("contribution_mismatch".into());
    }
    let input = object(envelope.get("input").ok_or_else(|| "input_object_required".to_string())?)?;
    match field(input, "operation") {
        Some("get") => {
            ensure_fields(input, &["operation", "key"])?;
            let key = storage_key(field(input, "key"))?;
            Ok(json!({"operation":"get","key":field(input,"key"),"value":state.get(&key)?}))
        }
        Some("set") => {
            ensure_fields(input, &["operation", "key", "value"])?;
            let key = storage_key(field(input, "key"))?;
            let value = field(input, "value").ok_or_else(|| "value_string_required".to_string())?;
            if value.len() > MAX_VALUE_BYTES { return Err("value_too_large".into()); }
            state.set(&key, value)?;
            Ok(json!({"operation":"set","key":field(input,"key"),"stored":true}))
        }
        Some("list") => {
            ensure_fields(input, &["operation", "prefix"])?;
            if input.get("prefix").is_some_and(|value| !value.is_string()) { return Err("key_prefix_invalid".into()); }
            let prefix = field(input, "prefix").unwrap_or("");
            if !prefix.is_empty() && !valid_key(prefix) { return Err("key_prefix_invalid".into()); }
            let full_prefix = if prefix.is_empty() { TEST_PREFIX.to_owned() } else { storage_key(Some(prefix))? };
            let mut keys = state.list(&full_prefix)?.into_iter()
                .filter_map(|key| key.strip_prefix(TEST_PREFIX).map(str::to_owned))
                .filter(|key| valid_key(key) && key.starts_with(prefix))
                .collect::<Vec<_>>();
            keys.sort();
            keys.truncate(100);
            Ok(json!({"operation":"list","prefix":prefix,"keys":keys}))
        }
        Some("delete") => {
            ensure_fields(input, &["operation", "key"])?;
            let key = storage_key(field(input, "key"))?;
            Ok(json!({"operation":"delete","key":field(input,"key"),"deleted":state.delete(&key)?}))
        }
        _ => Err("storage_operation_invalid".into()),
    }
}
// docs:snippet-end workspace-storage-handler:rust

struct Guest;
impl exports::glixo::contribution::guest::Guest for Guest {
    fn invoke(request_json: String) -> Result<String, String> {
        let request: Value = serde_json::from_str(&request_json).map_err(|_| "request_json_invalid".to_string())?;
        let response = handle_storage(&request, &mut HostState)?;
        serde_json::to_string(&response).map_err(|_| "response_json_invalid".into())
    }
}
export!(Guest);

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    #[derive(Default)] struct MemoryState(BTreeMap<String, String>);
    impl ScopedState for MemoryState {
        fn get(&mut self, key: &str) -> Result<Option<String>, String> { Ok(self.0.get(key).cloned()) }
        fn set(&mut self, key: &str, value: &str) -> Result<(), String> { self.0.insert(key.into(), value.into()); Ok(()) }
        fn list(&mut self, prefix: &str) -> Result<Vec<String>, String> { Ok(self.0.keys().filter(|key| key.starts_with(prefix)).cloned().collect()) }
        fn delete(&mut self, key: &str) -> Result<bool, String> { Ok(self.0.remove(key).is_some()) }
    }
    fn request(operation: &str, fields: Value) -> Value {
        let mut input = fields.as_object().cloned().unwrap_or_default();
        input.insert("operation".into(), json!(operation));
        json!({"kind":"tools","contributionId":"storage","input":Value::Object(input)})
    }
    #[test]
    fn storage_round_trip_stays_in_test_namespace_and_sorts() {
        let mut state = MemoryState::default();
        state.set("workspace-storage/test/zeta", "x").unwrap();
        assert_eq!(handle_storage(&request("set", json!({"key":"alpha","value":"green"})), &mut state).unwrap(), json!({"operation":"set","key":"alpha","stored":true}));
        assert_eq!(state.get("workspace-storage/test/alpha").unwrap().as_deref(), Some("green"));
        assert_eq!(handle_storage(&request("list", json!({"prefix":""})), &mut state).unwrap(), json!({"operation":"list","prefix":"","keys":["alpha","zeta"]}));
        assert_eq!(handle_storage(&request("delete", json!({"key":"alpha"})), &mut state).unwrap()["deleted"], true);
    }
    #[test]
    fn invalid_keys_and_unbounded_values_fail_closed() {
        let mut state = MemoryState::default();
        for key in ["../outside", "nested/key", "", ".", ".."] {
            assert_eq!(handle_storage(&request("get", json!({"key":key})), &mut state).unwrap_err(), "storage_key_invalid");
        }
        assert_eq!(handle_storage(&request("set", json!({"key":"large","value":"x".repeat(4097)})), &mut state).unwrap_err(), "value_too_large");
        assert_eq!(handle_storage(&request("get", json!({"key":"safe","prefix":"other/"})), &mut state).unwrap_err(), "storage_input_invalid");
        assert_eq!(handle_storage(&request("list", json!({"prefix":3})), &mut state).unwrap_err(), "key_prefix_invalid");
        assert!(state.0.is_empty());
    }
}
