//! Guest-side helpers for the Glixo Component Model extension imports.
//!
//! This crate deliberately has no networking, process, filesystem, or
//! environment-secret implementation. Applications provide adapters backed by
//! generated WIT imports.

pub mod guest;
pub mod http;
pub mod logging;
pub mod state;
pub mod workspace;
pub mod llm;

pub use serde_json::Value as JsonValue;
