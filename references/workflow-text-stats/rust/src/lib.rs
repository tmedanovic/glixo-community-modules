use serde_json::{json, Value};

wit_bindgen::generate!({ path: "wit", world: "contribution", generate_all });

const MAX_REQUEST_BYTES: usize = 128 * 1024;
const MAX_TEXT_SCALARS: usize = 65_536;
const MAXIMUM_MINIMUM_WORD_LENGTH: usize = 128;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StatsResult {
    pub word_count: usize,
    pub character_count: usize,
}

// docs:snippet-start workflow-text-stats-handler:rust
pub fn handle(request_json: &str) -> Result<String, String> {
    if request_json.len() > MAX_REQUEST_BYTES {
        return Err("guest_envelope_invalid".into());
    }
    let request: Value = serde_json::from_str(request_json).map_err(|_| "guest_envelope_invalid")?;
    if request.get("kind").and_then(Value::as_str) != Some("tools")
        || request.get("contributionId").and_then(Value::as_str) != Some("text-stats")
    {
        return Err("contribution_mismatch".into());
    }
    let input = request.get("input").and_then(Value::as_object).ok_or("input_invalid")?;
    let text = input.get("text").and_then(Value::as_str).ok_or("text_required")?;
    let include_whitespace = input
        .get("includeWhitespace")
        .map(Value::as_bool)
        .transpose_option("include_whitespace_invalid")?
        .unwrap_or(true);
    let minimum_word_length = input
        .get("minimumWordLength")
        .map(Value::as_u64)
        .transpose_option("minimum_word_length_out_of_range")?
        .unwrap_or(1);
    if minimum_word_length > MAXIMUM_MINIMUM_WORD_LENGTH as u64 {
        return Err("minimum_word_length_out_of_range".into());
    }
    let minimum_word_length = minimum_word_length as usize;
    let result = analyze(text, include_whitespace, minimum_word_length)?;
    serde_json::to_string(&json!({
        "wordCount": result.word_count,
        "characterCount": result.character_count
    }))
    .map_err(|_| "guest_result_invalid".into())
}
pub fn analyze(text: &str, include_whitespace: bool, minimum_word_length: usize) -> Result<StatsResult, String> {
    if minimum_word_length < 1 || minimum_word_length > MAXIMUM_MINIMUM_WORD_LENGTH {
        return Err("minimum_word_length_out_of_range".into());
    }
    let mut result = StatsResult { word_count: 0, character_count: 0 };
    let mut word_length = 0;
    let mut scalar_count = 0;
    for scalar in text.chars() {
        scalar_count += 1;
        if scalar_count > MAX_TEXT_SCALARS { return Err("text_too_long".into()); }
        if is_white_space(scalar) {
            if include_whitespace { result.character_count += 1; }
            if word_length >= minimum_word_length { result.word_count += 1; }
            word_length = 0;
        } else {
            result.character_count += 1;
            word_length += 1;
        }
    }
    if word_length >= minimum_word_length { result.word_count += 1; }
    Ok(result)
}

fn is_white_space(scalar: char) -> bool {
    matches!(scalar as u32,
        0x0009..=0x000D | 0x0020 | 0x0085 | 0x00A0 | 0x1680 |
        0x2000..=0x200A | 0x2028 | 0x2029 | 0x202F | 0x205F | 0x3000)
}
// docs:snippet-end workflow-text-stats-handler:rust

trait TransposeOption<T> {
    fn transpose_option(self, error: &'static str) -> Result<Option<T>, String>;
}
impl<T> TransposeOption<T> for Option<Option<T>> {
    fn transpose_option(self, error: &'static str) -> Result<Option<T>, String> {
        match self {
            None => Ok(None),
            Some(Some(value)) => Ok(Some(value)),
            Some(None) => Err(error.into()),
        }
    }
}

// docs:snippet-start workflow-text-stats-guest:rust
struct GuestImpl;
impl exports::glixo::contribution::guest::Guest for GuestImpl {
    fn invoke(request_json: String) -> Result<String, String> {
        handle(&request_json)
    }
}

export!(GuestImpl);
// docs:snippet-end workflow-text-stats-guest:rust

#[cfg(test)]
mod tests;
