use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// Direct host-stamped `glixo:contribution/guest.invoke` JSON object.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestEnvelope<T = Value> {
    pub kind: String,
    pub contribution_id: String,
    pub configuration: T,
    pub input: Value,
    pub context: GuestContext,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestContext {
    pub session_id: String,
    #[serde(default)]
    pub resource_handles: BTreeMap<String, String>,
    #[serde(default)]
    pub endpoints: Vec<Endpoint>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint { pub name: String, pub handle: String, pub base_url: String }
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GuestReply<T = Value> { pub response: T }
