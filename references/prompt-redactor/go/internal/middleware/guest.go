package middleware

import (
    "bytes"
    "encoding/json"
    "errors"
    "io"
    "strings"
    "unicode/utf8"
)

type object = map[string]any
type Rule struct { Match string `json:"match"`; Replacement string `json:"replacement"` }
func asObject(v any) object { x,_:=v.(map[string]any); return x }
func parseRules(config object) ([]Rule,error) {
    raw,exists:=config["rules"]; if !exists { return nil,errors.New("redaction_rules_invalid") }
    items,ok:=raw.([]any); if !ok || len(items)>64 { return nil,errors.New("redaction_rules_invalid") }
    rules:=make([]Rule,0,len(items))
    for _,item:=range items { m:=asObject(item); from,fok:=m["match"].(string); to,tok:=m["replacement"].(string); if !fok||!tok||from==""||utf8.RuneCountInString(from)>512||utf8.RuneCountInString(to)>1024 { return nil,errors.New("redaction_rule_invalid") }; rules=append(rules,Rule{from,to}) }
    return rules,nil
}

// docs:snippet-start prompt-redactor-handler:go
func PreviewText(text string,rules []Rule)(string,error) {
    for _,rule:=range rules { if rule.Match==""||utf8.RuneCountInString(rule.Match)>512||utf8.RuneCountInString(rule.Replacement)>1024 { return "",errors.New("redaction_rule_invalid") }; text=strings.ReplaceAll(text,rule.Match,rule.Replacement) }
    return text,nil
}
func Redact(input,configuration object)(object,error) {
    if input["schemaVersion"]!=json.Number("1") && input["schemaVersion"]!=float64(1) { return nil,errors.New("middleware_schema_unsupported") }
    if input["operation"]!="before-provider" { return nil,errors.New("operation_unsupported") }
    conversation:=asObject(input["conversation"]); raw,ok:=conversation["messages"].([]any); if !ok { return nil,errors.New("conversation_missing") }
    rules,err:=parseRules(configuration); if err!=nil { return nil,err }
    patches:=make([]object,0)
    for _,value:=range raw { message:=asObject(value); if message["role"]!="user"||message["isHostAuthority"]!=false { continue }; messageID,mok:=message["id"].(string); parts,pok:=message["parts"].([]any); if !mok||!pok { continue }
        for _,pv:=range parts { part:=asObject(pv); if part["kind"]!="text" { continue }; partID,iok:=part["id"].(string); text,tok:=part["text"].(string); if !iok||!tok { continue }; updated,e:=PreviewText(text,rules); if e!=nil { return nil,e }; if updated!=text { patches=append(patches,object{"messageId":messageID,"partId":partID,"text":updated}) } }
    }
    audit:="no-change"; if len(patches)>0 { audit="redaction-applied" }; return object{"textPatches":patches,"auditDescription":audit},nil
}
// docs:snippet-end prompt-redactor-handler:go

func Invoke(requestJSON string)(string,error) {
    decoder:=json.NewDecoder(bytes.NewBufferString(requestJSON)); decoder.UseNumber(); var envelope object
    if err:=decoder.Decode(&envelope);err!=nil{return "",errors.New("guest_envelope_invalid")}; if _,err:=decoder.Token();err!=io.EOF{return "",errors.New("guest_envelope_invalid")}
    if envelope["kind"]!="messageMiddleware"||envelope["contributionId"]!="prompt-redactor" { return "",errors.New("guest_envelope_invalid") }
    input:=asObject(envelope["input"]); if input==nil{return "",errors.New("guest_envelope_invalid")}; config:=asObject(envelope["configuration"]); if config==nil{config=object{}}
    result,err:=Redact(input,config); if err!=nil{return "",err}; data,err:=json.Marshal(result); if err!=nil{return "",errors.New("guest_result_invalid")}; return string(data),nil
}
