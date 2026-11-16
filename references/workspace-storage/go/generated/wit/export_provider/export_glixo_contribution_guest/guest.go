package export_glixo_contribution_guest

import (
	"github.com/glixo-community/glixo-contribution-guest-go/guest"
	abitypes "go.bytecodealliance.org/pkg/wit/types"
)

// Invoke is the generated WIT export target and delegates to the injected-state adapter.
func Invoke(requestJSON string) abitypes.Result[string, string] {
	return guest.Invoke(requestJSON)
}
