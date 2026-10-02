use serde_json::{json, Value};
wit_bindgen::generate!({ path: "wit", world: "contribution", generate_all });

struct GuestImpl;
#[derive(Clone, Debug)] pub struct Rule { pub from: String, pub to: String }
fn rules(config: &Value) -> Result<Vec<Rule>, String> {
    let items = config.get("rules").ok_or_else(|| "redaction_rules_invalid".to_owned())?;
    let items = items.as_array().ok_or_else(|| "redaction_rules_invalid".to_owned())?;
    if items.len() > 64 { return Err("redaction_rules_invalid".into()); }
    items.iter().map(|item| {
        let from = item.get("match").and_then(Value::as_str).ok_or_else(|| "redaction_rule_invalid".to_owned())?;
        let to = item.get("replacement").and_then(Value::as_str).ok_or_else(|| "redaction_rule_invalid".to_owned())?;
        if from.is_empty() || from.chars().count() > 512 || to.chars().count() > 1024 { return Err("redaction_rule_invalid".into()); }
        Ok(Rule { from: from.to_owned(), to: to.to_owned() })
    }).collect()
}

// docs:snippet-start prompt-redactor-handler:rust
pub fn preview_text(text: &str, rules: &[Rule]) -> Result<String, String> {
    let mut output = text.to_owned();
    for rule in rules {
        if rule.from.is_empty() || rule.from.chars().count() > 512 || rule.to.chars().count() > 1024 {
            return Err("redaction_rule_invalid".into());
        }
        output = output.replace(&rule.from, &rule.to);
    }
    Ok(output)
}

pub fn redact(input: &Value, configuration: &Value) -> Result<Value, String> {
    if input.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || input.get("operation").and_then(Value::as_str) != Some("before-provider") {
        return Err("operation_unsupported".into());
    }
    let messages = input.get("conversation").and_then(|v| v.get("messages")).and_then(Value::as_array)
        .ok_or_else(|| "conversation_missing".to_owned())?;
    let rules = rules(configuration)?;
    let mut patches = Vec::new();
    for message in messages {
        if message.get("role").and_then(Value::as_str) != Some("user")
            || message.get("isHostAuthority").and_then(Value::as_bool) != Some(false) { continue; }
        let (Some(message_id), Some(parts)) = (message.get("id").and_then(Value::as_str), message.get("parts").and_then(Value::as_array)) else { continue; };
        for part in parts {
            if part.get("kind").and_then(Value::as_str) != Some("text") { continue; }
            let (Some(part_id), Some(text)) = (part.get("id").and_then(Value::as_str), part.get("text").and_then(Value::as_str)) else { continue; };
            let transformed = preview_text(text, &rules)?;
            if transformed != text { patches.push(json!({"messageId":message_id,"partId":part_id,"text":transformed})); }
        }
    }
    let audit = if patches.is_empty() { "no-change" } else { "redaction-applied" };
    Ok(json!({"textPatches":patches,"auditDescription":audit}))
}
// docs:snippet-end prompt-redactor-handler:rust

impl exports::glixo::contribution::guest::Guest for GuestImpl {
    fn invoke(request_json: String) -> Result<String, String> {
        let envelope: Value = serde_json::from_str(&request_json).map_err(|_| "guest_envelope_invalid".to_owned())?;
        if envelope.get("kind").and_then(Value::as_str) != Some("messageMiddleware")
            || envelope.get("contributionId").and_then(Value::as_str) != Some("prompt-redactor") {
            return Err("guest_envelope_invalid".into());
        }
        let input = envelope.get("input").ok_or_else(|| "guest_envelope_invalid".to_owned())?;
        let configuration = envelope.get("configuration").unwrap_or(&Value::Null);
        serde_json::to_string(&redact(input, configuration)?).map_err(|_| "guest_result_invalid".to_owned())
    }
}

export!(GuestImpl);

#[cfg(test)]
mod tests;
