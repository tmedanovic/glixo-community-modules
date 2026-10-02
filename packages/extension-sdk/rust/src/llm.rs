#[derive(Clone, Debug, PartialEq)]
pub enum ContentPart {
    Text(String),
    Reasoning(String),
    ToolCallDetails(ToolCallDetails),
}

#[derive(Clone, Debug, PartialEq)]
pub struct ToolCallDetails {
    pub id: String,
    pub name: String,
    pub arguments_fragment: Option<String>,
    pub complete: bool,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Usage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cached_tokens: Option<u32>,
    pub reasoning_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum FinishReason {
    Stop,
    Length,
    Tool,
    Cancelled,
    ContentFilter,
    Error,
    Unknown(String),
}

#[derive(Clone, Debug, PartialEq)]
pub struct ProviderEvent {
    pub request_id: String,
    pub part: Option<ContentPart>,
    pub usage: Option<Usage>,
    pub finish: Option<FinishReason>,
    pub error: Option<TypedError>,
    pub provider_request_id: Option<String>,
    pub provider_response_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TypedError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    pub retry_after_ms: Option<u32>,
}
