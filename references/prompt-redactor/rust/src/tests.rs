#[cfg(test)]
mod tests {
    use crate::{preview_text, redact, rules};
    use serde_json::json;
    #[test]
    fn unicode_literal_preview_and_user_text_patch() {
        let rules = rules(&json!({"rules":[{"match":"café 🧪","replacement":"[private]"}]})).unwrap();
        assert_eq!(preview_text("café 🧪 x café 🧪", &rules).unwrap(), "[private] x [private]");
        let value = redact(&json!({"schemaVersion":1,"operation":"before-provider","conversation":{"messages":[{"id":"m1","role":"user","isHostAuthority":false,"parts":[{"id":"p1","kind":"text","text":"café 🧪"},{"id":"p2","kind":"image","text":"café 🧪"}]},{"id":"system","role":"system","isHostAuthority":true,"parts":[{"id":"p3","kind":"text","text":"café 🧪"}]}]}}), &json!({"rules":[{"match":"café 🧪","replacement":"[private]"}]})).unwrap();
        assert_eq!(value["textPatches"].as_array().unwrap().len(),1);
        assert_eq!(value["textPatches"][0]["text"],"[private]");
        assert!(!value.to_string().contains("café"));
    }
    #[test]
    fn oversized_rule_set_fails_closed() {
        let entries = (0..65).map(|_| json!({"match":"x","replacement":"y"})).collect::<Vec<_>>();
        assert_eq!(rules(&json!({"rules":entries})).unwrap_err(), "redaction_rules_invalid");
        assert_eq!(rules(&json!({})).unwrap_err(), "redaction_rules_invalid");
    }
}
