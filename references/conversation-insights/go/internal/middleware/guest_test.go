package middleware

import (
  "encoding/json"
  "strings"
  "testing"
)

func TestGuestBehavior(t *testing.T) {
  got,err:=Invoke(`{"kind":"messageMiddleware","contributionId":"conversation-insights","configuration":{},"input":{"schemaVersion":1,"operation":"completed","completion":{"latencyMilliseconds":41,"actualUsage":{"inputTokens":31,"outputTokens":12,"totalTokens":43},"estimatedInputCharacters":250,"estimatedOutputCharacters":82,"prompt":"do not return"}}}`); if err!=nil {t.Fatal(err)}
  if strings.Contains(got,"do not return") {t.Fatal("guest copied prompt content")}; var out map[string]any; if err=json.Unmarshal([]byte(got),&out);err!=nil{t.Fatal(err)}
  obs:=out["observation"].(map[string]any); usage:=obs["actualUsage"].(map[string]any); if usage["inputTokens"]!=float64(31)||obs["textStatisticsAreEstimates"]!=true{t.Fatalf("unexpected observation: %#v",obs)}
}
func gotString(v any) string { b,_:=json.Marshal(v);return string(b) }
