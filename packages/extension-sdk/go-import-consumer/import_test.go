package consumer

import (
	"testing"

	"github.com/tmedanovic/glixo-community-modules/packages/extension-sdk/go/guest"
	"github.com/tmedanovic/glixo-community-modules/packages/extension-sdk/go/httpbroker"
)

func TestCleanConsumerImports(t *testing.T) {
	envelope := guest.Envelope[string]{Kind: "contribution", ContributionID: "sample", Configuration: "config"}
	if envelope.Kind != "contribution" || httpbroker.DefaultReadBytes == 0 {
		t.Fatal("Go SDK import did not expose its public API")
	}
}
