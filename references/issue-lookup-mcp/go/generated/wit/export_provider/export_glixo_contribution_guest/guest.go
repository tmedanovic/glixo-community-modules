package export_glixo_contribution_guest

import (
	"encoding/json"
	"fmt"

	"github.com/glixo-community/glixo-contribution-guest-go/internal/issuelookup"
	"github.com/glixo/extension-sdk-go/httpbroker"
	"github.com/glixo-community/glixo-contribution-guest-go/generated/wit/glixo_http_broker"
	withttp "github.com/glixo-community/glixo-contribution-guest-go/generated/wit/glixo_http_types"
	abitypes "go.bytecodealliance.org/pkg/wit/types"
)

type hostBroker struct{}

func (hostBroker) HTTPStart(request httpbroker.Request) (uint32, error) {
	headers := make([]withttp.Header, 0, len(request.Headers))
	for _, header := range request.Headers { headers = append(headers, withttp.Header{Name:header.Name,Value:header.Value}) }
	body := abitypes.None[[]uint8]()
	if request.Body != nil { body = abitypes.Some(request.Body) }
	str := func(value *string) abitypes.Option[string] { if value==nil{return abitypes.None[string]()};return abitypes.Some(*value) }
	u32 := func(value *uint32) abitypes.Option[uint32] { if value==nil{return abitypes.None[uint32]()};return abitypes.Some(*value) }
	u16 := func(value *uint16) abitypes.Option[uint16] { if value==nil{return abitypes.None[uint16]()};return abitypes.Some(*value) }
	witRequest:=withttp.HttpRequest{Url:request.URL,Method:request.Method,Headers:headers,Body:body,ContentType:str(request.ContentType),
		TimeoutMs:u32(request.TimeoutMS),MaxResponseBytes:u32(request.MaxResponseBytes),AcceptedStatusMin:u16(request.AcceptedStatusMin),
		AcceptedStatusMax:u16(request.AcceptedStatusMax),EndpointHandle:str(request.EndpointHandle),SecretHandle:str(request.SecretHandle),
		AuthHeader:str(request.AuthHeader),AuthScheme:str(request.AuthScheme)}
	result:=glixo_http_broker.HttpStart(witRequest);if result.IsErr(){return 0,fmt.Errorf("%s",result.Err())};return result.Ok(),nil
}

func (hostBroker) HTTPStatus(handle uint32)(uint16,error){result:=glixo_http_broker.HttpStatus(handle);if result.IsErr(){return 0,fmt.Errorf("%s",result.Err())};return result.Ok(),nil}
func (hostBroker) HTTPResponseHeaders(handle uint32)([]httpbroker.Header,error){
	result:=glixo_http_broker.HttpResponseHeaders(handle);if result.IsErr(){return nil,fmt.Errorf("%s",result.Err())}
	generated:=result.Ok();headers:=make([]httpbroker.Header,0,len(generated));for _,h:=range generated{headers=append(headers,httpbroker.Header{Name:h.Name,Value:h.Value})};return headers,nil
}
func (hostBroker) HTTPRead(handle,maxBytes uint32)([]byte,bool,error){
	result:=glixo_http_broker.HttpRead(handle,maxBytes);if result.IsErr(){return nil,false,fmt.Errorf("%s",result.Err())}
	chunk:=result.Ok();if chunk.IsNone(){return nil,false,nil};return chunk.Some(),true,nil
}
func (hostBroker) HTTPCancel(handle uint32){glixo_http_broker.HttpCancel(handle)}
func (hostBroker) HTTPDrop(handle uint32){glixo_http_broker.HttpDrop(handle)}

func Invoke(requestJSON string) abitypes.Result[string,string]{
	result,err:=issuelookup.Lookup(requestJSON,hostBroker{});if err!=nil{return abitypes.Err[string,string](err.Error())}
	encoded,err:=json.Marshal(result);if err!=nil{return abitypes.Err[string,string]("guest_response_invalid")};return abitypes.Ok[string,string](string(encoded))
}
