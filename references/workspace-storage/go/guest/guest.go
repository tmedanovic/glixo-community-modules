package guest

import (
	"fmt"

	"github.com/glixo-community/glixo-contribution-guest-go/generated/wit/glixo_contribution_broker"
	"github.com/glixo-community/glixo-contribution-guest-go/storage"
	"go.bytecodealliance.org/pkg/wit/types"
)

type hostState struct{}

func (hostState) Get(key string) (string, bool, error) {
	result := glixo_contribution_broker.StateGet(key)
	if result.IsErr() { return "", false, fmt.Errorf("%s", result.Err()) }
	value := result.Ok()
	if value.IsNone() { return "", false, nil }
	return value.Some(), true, nil
}
func (hostState) Set(key, value string) error {
	result := glixo_contribution_broker.StateSet(key, value)
	if result.IsErr() { return fmt.Errorf("%s", result.Err()) }
	return nil
}
func (hostState) List(prefix string) ([]string, error) {
	result := glixo_contribution_broker.StateList(prefix)
	if result.IsErr() { return nil, fmt.Errorf("%s", result.Err()) }
	return result.Ok(), nil
}
func (hostState) Delete(key string) (bool, error) {
	result := glixo_contribution_broker.StateDelete(key)
	if result.IsErr() { return false, fmt.Errorf("%s", result.Err()) }
	return result.Ok(), nil
}

// Invoke is called by componentize-go's generated generic guest export shim.
func Invoke(requestJSON string) types.Result[string, string] {
	response, err := storage.Handle(requestJSON, hostState{})
	if err != nil { return types.Err[string, string](err.Error()) }
	return types.Ok[string, string](response)
}
