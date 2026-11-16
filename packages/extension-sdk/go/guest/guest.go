package guest

// Envelope is the direct host-stamped contribution invoke JSON object. It is
// deliberately not wrapped in a guest-authored request property.
type Endpoint struct {
	Name    string `json:"name"`
	Handle  string `json:"handle"`
	BaseURL string `json:"baseUrl"`
}
type Context struct {
	SessionID       string            `json:"sessionId"`
	ResourceHandles map[string]string `json:"resourceHandles"`
	Endpoints       []Endpoint        `json:"endpoints"`
}
type Envelope[T any] struct {
	Kind           string  `json:"kind"`
	ContributionID string  `json:"contributionId"`
	Configuration  T       `json:"configuration"`
	Input          any     `json:"input"`
	Context        Context `json:"context"`
}
