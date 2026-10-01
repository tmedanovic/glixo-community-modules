package llm

type ToolCallDetails struct {
	ID                string  `json:"id"`
	Name              string  `json:"name"`
	ArgumentsFragment *string `json:"arguments-fragment,omitempty"`
	Complete          bool    `json:"complete"`
}

type Usage struct {
	InputTokens     uint32  `json:"input-tokens"`
	OutputTokens    uint32  `json:"output-tokens"`
	CachedTokens    *uint32 `json:"cached-tokens,omitempty"`
	ReasoningTokens *uint32 `json:"reasoning-tokens,omitempty"`
	TotalTokens     *uint32 `json:"total-tokens,omitempty"`
}

type Event struct {
	RequestID          string  `json:"request-id"`
	Part               any     `json:"part,omitempty"`
	Usage              *Usage  `json:"usage,omitempty"`
	Finish             string  `json:"finish,omitempty"`
	ProviderRequestID  *string `json:"provider-request-id,omitempty"`
	ProviderResponseID *string `json:"provider-response-id,omitempty"`
}
