use glixo_extension_sdk::state::ScopedState;
use serde_json::{json, Value};

wit_bindgen::generate!({ path: "wit", world: "contribution", generate_all });

const ACTION_ID: &str = "save-preferences";
const STORAGE_KEY: &str = "accessible-theme/preferences/current";

struct HostState;
impl ScopedState for HostState {
    fn get(&mut self, key: &str) -> Result<Option<String>, String> { glixo::contribution::broker::state_get(key) }
    fn set(&mut self, key: &str, value: &str) -> Result<(), String> { glixo::contribution::broker::state_set(key, value) }
    fn list(&mut self, prefix: &str) -> Result<Vec<String>, String> { glixo::contribution::broker::state_list(prefix) }
    fn delete(&mut self, key: &str) -> Result<bool, String> { glixo::contribution::broker::state_delete(key) }
}

pub fn save_preferences(request_json: &str, state: &mut impl ScopedState) -> Result<String, String> {
    if request_json.len() > 32 * 1024 { return Err("action_payload_too_large".into()); }
    let envelope: glixo_extension_sdk::guest::GuestEnvelope<Value> = serde_json::from_str(request_json).map_err(|_| "action_envelope_invalid")?;
    if envelope.kind != "actions" || envelope.contribution_id != ACTION_ID {
        return Err("contribution_mismatch".into());
    }
    if envelope.context.session_id.trim().is_empty() { return Err("session_context_missing".into()); }
    let input = envelope.input.as_object().ok_or("input_invalid")?;
    if input.len() != 2 { return Err("input_invalid".into()); }
    let accent = input.get("accent").and_then(Value::as_str).ok_or("accent_invalid")?;
    let bytes = accent.as_bytes();
    if bytes.len() != 7 || bytes[0] != b'#' || !bytes[1..].iter().all(u8::is_ascii_hexdigit) {
        return Err("accent_invalid".into());
    }
    let large_controls = input.get("largeControls").and_then(Value::as_bool).ok_or("large_controls_invalid")?;
    let value = json!({"accent":accent.to_ascii_lowercase(),"largeControls":large_controls});
    let encoded = serde_json::to_string(&value).map_err(|_| "preferences_encode_failed")?;
    state.set(STORAGE_KEY, &encoded)?;
    Ok(json!({"accepted":true}).to_string())
}

struct Guest;
impl exports::glixo::contribution::guest::Guest for Guest {
    fn invoke(request_json: String) -> Result<String, String> {
        save_preferences(&request_json, &mut HostState)
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
    fn envelope(accent: &str) -> String {
        json!({"kind":"actions","contributionId":ACTION_ID,"configuration":{},"input":{"accent":accent,"largeControls":true},"context":{"sessionId":"contribution:save-preferences","resourceHandles":{},"endpoints":[]}}).to_string()
    }
    #[test]
    fn persists_only_validated_preferences_in_extension_namespace() {
        let mut state = MemoryState::default();
        assert_eq!(save_preferences(&envelope("#AABBCC"), &mut state).unwrap(), "{\"accepted\":true}");
        assert_eq!(state.0.get(STORAGE_KEY).unwrap(), "{\"accent\":\"#aabbcc\",\"largeControls\":true}");
    }
    #[test]
    fn rejects_invalid_colors_before_storage_write() {
        let mut state = MemoryState::default();
        assert_eq!(save_preferences(&envelope("url(#fff)"), &mut state).unwrap_err(), "accent_invalid");
        assert!(state.0.is_empty());
    }
    #[test]
    fn requires_host_stamped_session_context_before_storage_write() {
        let mut state = MemoryState::default();
        let request = json!({"kind":"actions","contributionId":ACTION_ID,"configuration":{},"input":{"accent":"#AABBCC","largeControls":true},"context":{"sessionId":""}}).to_string();
        assert_eq!(save_preferences(&request, &mut state).unwrap_err(), "session_context_missing");
        assert!(state.0.is_empty());
    }
}
