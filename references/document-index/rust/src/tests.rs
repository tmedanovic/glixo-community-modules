use crate::{handle, read_inventory};
use glixo_extension_sdk::workspace::Workspace;
use serde_json::{json, Value};

#[derive(Default)]
struct FakeWorkspace {
    search_result: String,
    reads: Vec<(String, String, u32)>,
    read_results: std::collections::BTreeMap<String, String>,
    searches: Vec<(String, String, u32)>,
}
impl Workspace for FakeWorkspace {
    fn search(&mut self, handle: &str, query: &str, limit: u32) -> Result<String, String> {
        self.searches.push((handle.into(), query.into(), limit));
        Ok(self.search_result.clone())
    }
    fn read(&mut self, handle: &str, path: &str, max_bytes: u32) -> Result<String, String> {
        self.reads.push((handle.into(), path.into(), max_bytes));
        self.read_results
            .get(path)
            .cloned()
            .ok_or_else(|| "test_read_missing".into())
    }
}

fn request(input: Value, handle: &str) -> String {
    json!({"kind":"dataSources","contributionId":"search","configuration":{},"input":input,
        "context":{"sessionId":"test-session","resourceHandles":{"workspace":handle}}})
    .to_string()
}

#[test]
fn shared_path_golden_sorts_and_reads_only_the_selected_handle() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../_shared/goldens/document-index/path-substring.json"
    ))
    .unwrap();
    let mut workspace = FakeWorkspace {
        search_result: fixture["hostSearchResult"].to_string(),
        read_results: serde_json::from_value(fixture["hostReadResults"].clone()).unwrap(),
        ..Default::default()
    };
    let query = fixture["query"].as_str().unwrap();
    let limit = fixture["limit"].as_u64().unwrap();
    let result: Value = serde_json::from_str(
        &handle(
            &request(json!({"query":query,"limit":limit}), "opaque-selected"),
            &mut workspace,
        )
        .unwrap(),
    )
    .unwrap();
    let expected_paths: Vec<String> =
        serde_json::from_value(fixture["expectedPaths"].clone()).unwrap();
    let actual_paths = result["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["path"].as_str().unwrap().to_owned())
        .collect::<Vec<_>>();
    assert_eq!(actual_paths, expected_paths);
    assert_eq!(
        workspace.searches,
        vec![("opaque-selected".into(), "docs/".into(), 3)]
    );
    assert_eq!(
        workspace.reads,
        vec![
            ("opaque-selected".into(), "docs/api.md".into(), 4096),
            ("opaque-selected".into(), "docs/guide.md".into(), 4096),
        ]
    );
}

#[test]
fn bounds_reads_and_excerpts_by_bytes_without_splitting_utf8() {
    let mut workspace = FakeWorkspace {
        search_result: r#"{"items":[{"path":"z/big.txt","bytes":4097},{"path":"a/small.txt","bytes":4}],"truncated":true}"#.into(),
        read_results: [("a/small.txt".into(), "a€".into())].into(),
        ..Default::default()
    };
    let result: Value = serde_json::from_str(
        &handle(
            &request(json!({"query":"small","excerptBytes":2}), " h "),
            &mut workspace,
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(result["items"][0]["path"], "a/small.txt");
    assert_eq!(result["items"][0]["excerpt"], "a");
    assert_eq!(result["items"][0]["excerptTruncated"], true);
    assert_eq!(result["items"][1]["excerpt"], Value::Null);
    assert_eq!(
        workspace.reads,
        vec![(" h ".into(), "a/small.txt".into(), 4096)]
    );
    assert_eq!(result["truncated"], true);
}

#[test]
fn enforces_utf16_query_length_and_search_result_bounds() {
    let query = format!("{}😀", "x".repeat(126));
    let mut workspace = FakeWorkspace {
        search_result: r#"{"items":[],"truncated":false}"#.into(),
        ..Default::default()
    };
    handle(&request(json!({"query":query}), "h"), &mut workspace).unwrap();
    let too_long = format!("{}x", "x".repeat(126) + "😀");
    assert!(handle(&request(json!({"query":too_long}), "h"), &mut workspace).is_err());
    assert!(read_inventory(
        r#"{"items":[{"path":"a","bytes":0},{"path":"b","bytes":0}],"truncated":false}"#,
        1
    )
    .is_err());
}

#[test]
fn rejects_unsafe_duplicate_or_incomplete_search_items_and_oversized_reads() {
    for invalid in [
        r#"{"items":[{"path":"../secret","bytes":1}],"truncated":false}"#,
        r#"{"items":[{"path":"x","bytes":1},{"path":"x","bytes":1}],"truncated":false}"#,
        r#"{"items":[{"path":"x"}],"truncated":false}"#,
    ] {
        assert!(read_inventory(invalid, 10).is_err(), "accepted {invalid}");
    }
    let mut workspace = FakeWorkspace {
        search_result: r#"{"items":[{"path":"a.md","bytes":10}],"truncated":false}"#.into(),
        read_results: [("a.md".into(), "x".repeat(4097))].into(),
        ..Default::default()
    };
    assert!(handle(&request(json!({"query":"x"}), "h"), &mut workspace).is_err());
}

#[test]
fn rejects_missing_host_handle_and_preserves_handle_as_an_opaque_token() {
    let mut workspace = FakeWorkspace {
        search_result: r#"{"items":[],"truncated":false}"#.into(),
        ..Default::default()
    };
    let missing = json!({"kind":"dataSources","contributionId":"search","configuration":{},"input":{"query":"x"},"context":{"sessionId":"s","resourceHandles":{}}});
    assert!(handle(&missing.to_string(), &mut workspace).is_err());
    handle(&request(json!({"query":"x"}), "opaque "), &mut workspace).unwrap();
    assert_eq!(workspace.searches[0].0, "opaque ");
}
