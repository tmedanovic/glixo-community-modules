package middleware

import (
  "encoding/json"
  "strings"
  "testing"
)

func TestGuestBehavior(t *testing.T) {
  input:=object{"schemaVersion":json.Number("1"),"operation":"before-provider","conversation":object{"messages":[]any{object{"id":"m","role":"user","isHostAuthority":false,"parts":[]any{object{"id":"p","kind":"text","text":"café 🧪"},object{"id":"image","kind":"image","text":"café 🧪"}}},object{"id":"sys","role":"system","isHostAuthority":true,"parts":[]any{object{"id":"s","kind":"text","text":"café 🧪"}}}}}}
  config:=object{"rules":[]any{object{"match":"café 🧪","replacement":"[secret]"}}}; got,err:=Redact(input,config);if err!=nil{t.Fatal(err)}; patches:=got["textPatches"].([]object);if len(patches)!=1||patches[0]["text"]!="[secret]"{t.Fatalf("unexpected patches: %#v",patches)};if strings.Contains(gotString(got),"café"){t.Fatal("result contains original text")}
  _,err=Redact(input,object{"rules":make([]any,65)});if err==nil{t.Fatal("expected too many rules to fail closed")}
  if _,err=parseRules(object{});err==nil{t.Fatal("missing configuration must fail closed")}
}
func gotString(v any) string { b,_:=json.Marshal(v);return string(b) }
