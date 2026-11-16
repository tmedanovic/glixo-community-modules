#[cfg(test)]
mod tests {
    use crate::analyze;
    use serde_json::json;
    #[test]
    fn completed_keeps_actual_usage_distinct_from_estimates_and_never_returns_text() {
        let result = analyze(&json!({"schemaVersion":1,"operation":"completed","completion":{"latencyMilliseconds":41,"actualUsage":{"inputTokens":31,"outputTokens":12,"totalTokens":43},"estimatedInputCharacters":250,"estimatedOutputCharacters":82,"rawPrompt":"must not copy"}})).unwrap();
        assert_eq!(result["observation"]["actualUsage"]["inputTokens"],31);
        assert_eq!(result["observation"]["textStatisticsAreEstimates"],true);
        assert!(!result.to_string().contains("must not copy"));
    }
    #[test]
    fn committed_reads_only_counts() {
        let result = analyze(&json!({"schemaVersion":1,"operation":"committed","committedMessage":{"role":"user","attachmentCount":1,"parts":[{"text":"never return"}]}})).unwrap();
        assert_eq!(result["observation"]["userMessageCount"],1);
        assert!(!result.to_string().contains("never return"));
    }
}
