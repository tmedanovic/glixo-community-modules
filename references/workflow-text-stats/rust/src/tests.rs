use crate::{analyze, handle, StatsResult};
use serde_json::Value;

#[test]
fn unicode_scalar_and_whitespace_behavior_matches_shared_cases() {
    let project_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let source_path = project_root.join("../../_shared/goldens/workflow-text-stats/cases.json");
    let scaffold_path = project_root.join("shared/goldens/workflow-text-stats/cases.json");
    let cases_path = if source_path.exists() { source_path } else { scaffold_path };
    let cases: Value = serde_json::from_str(&std::fs::read_to_string(cases_path).unwrap()).unwrap();
    for case in cases["cases"].as_array().unwrap() {
        let actual: Value = serde_json::from_str(&handle(&case["request"].to_string()).unwrap()).unwrap();
        assert_eq!(actual, case["expectedResponse"], "case {}", case["id"]);
    }
}

#[test]
fn combined_marks_and_all_whitespace_boundaries_are_counted_consistently() {
    assert_eq!(analyze("e\u{301}\u{00A0}x\u{2003}🧭", false, 2).unwrap(), StatsResult { word_count: 1, character_count: 4 });
    assert!(analyze("x", true, 0).is_err());
    assert!(analyze(&"x".repeat(65_537), true, 1).is_err());
}
