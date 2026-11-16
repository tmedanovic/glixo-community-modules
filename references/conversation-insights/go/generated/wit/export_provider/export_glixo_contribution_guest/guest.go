package export_glixo_contribution_guest

import (
    "github.com/glixo-community/glixo-contribution-guest-go/internal/middleware"
    types "go.bytecodealliance.org/pkg/wit/types"
)

func Invoke(requestJSON string) types.Result[string,string] {
    output,err:=middleware.Invoke(requestJSON)
    if err!=nil { return types.Err[string,string](err.Error()) }
    return types.Ok[string,string](output)
}
