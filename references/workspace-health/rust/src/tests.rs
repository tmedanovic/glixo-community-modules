use crate::{handle, read_inventory, summarize};
use glixo_extension_sdk::workspace::Workspace;
use serde_json::{json, Value};

#[derive(Default)]
struct FakeWorkspace {
    search_result: String,
    search_calls: Vec<(String, String, u32)>,
}
impl Workspace for FakeWorkspace {
    fn search(&mut self, handle: &str, query: &str, limit: u32) -> Result<String, String> {
        self.search_calls.push((handle.into(), query.into(), limit));
        Ok(self.search_result.clone())
    }
    fn read(&mut self, _handle: &str, _path: &str, _max_bytes: u32) -> Result<String, String> {
        panic!("health observer must not read file content")
    }
}

fn request(value: &Value) -> String {
    let mut value = value.clone();
    value["context"]["sessionId"] = json!("test-session");
    value.to_string()
}

#[test]
fn shared_partial_sample_matches_and_uses_the_exact_host_handle() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../_shared/goldens/workspace-health/partial-sample.json"
    ))
    .unwrap();
    let mut workspace = FakeWorkspace {
        search_result: fixture["hostSearchResult"].to_string(),
        ..Default::default()
    };
    let result: Value =
        serde_json::from_str(&handle(&request(&fixture["request"]), &mut workspace).unwrap())
            .unwrap();
    assert_eq!(result, fixture["expectedResponse"]);
    assert_eq!(
        workspace.search_calls,
        vec![("host-issued".into(), "".into(), 2)]
    );
}

#[test]
fn totals_are_null_for_truncated_inventory_and_complete_when_proven() {
    let (items, truncated) = read_inventory(
        r#"{"items":[{"path":"b.cs","bytes":4},{"path":"a.md","bytes":8}],"truncated":true}"#,
        2,
    )
    .unwrap();
    let sample = summarize(items.clone(), truncated).unwrap();
    assert!(sample["eligibleFileTotals"].is_null());
    assert_eq!(sample["sampledBytes"], 12);
    let complete = summarize(items, false).unwrap();
    assert_eq!(
        complete["eligibleFileTotals"],
        json!({"fileCount":2,"bytes":12})
    );
}

#[test]
fn rejects_missing_fields_unsafe_paths_fractional_bytes_duplicate_paths_and_over_limit() {
    for invalid in [
        r#"{"items":[{"path":"x"}],"truncated":false}"#,
        r#"{"items":[{"bytes":1}],"truncated":false}"#,
        r#"{"items":[{"path":"../secret","bytes":1}],"truncated":false}"#,
        r#"{"items":[{"path":"x","bytes":1.5}],"truncated":false}"#,
        r#"{"items":[{"path":"x","bytes":1},{"path":"x","bytes":1}],"truncated":false}"#,
    ] {
        assert!(read_inventory(invalid, 10).is_err(), "accepted {invalid}");
    }
    assert!(read_inventory(
        r#"{"items":[{"path":"a","bytes":0},{"path":"b","bytes":0}],"truncated":false}"#,
        1
    )
    .is_err());
}

#[test]
fn sorts_largest_ties_by_utf8_byte_ordinal() {
    let (items, truncated) = read_inventory(
        r#"{"items":[{"path":"𐀀.txt","bytes":5},{"path":".txt","bytes":5}],"truncated":false}"#,
        2,
    )
    .unwrap();
    let result = summarize(items, truncated).unwrap();
    assert_eq!(result["largestFiles"][0]["path"], ".txt");
    assert_eq!(result["largestFiles"][1]["path"], "𐀀.txt");
}

#[test]
fn rejects_missing_authority_and_preserves_opaque_handle_bytes() {
    let response = r#"{"items":[],"truncated":false}"#.to_string();
    let mut workspace = FakeWorkspace {
        search_result: response,
        ..Default::default()
    };
    let mut missing = json!({"kind":"tools","contributionId":"inspect","configuration":{},"input":{},"context":{"sessionId":"s","resourceHandles":{}}});
    assert!(handle(&missing.to_string(), &mut workspace).is_err());
    missing["context"]["resourceHandles"]["workspace"] = json!(" opaque host handle ");
    handle(&missing.to_string(), &mut workspace).unwrap();
    assert_eq!(workspace.search_calls[0].0, " opaque host handle ");
}
