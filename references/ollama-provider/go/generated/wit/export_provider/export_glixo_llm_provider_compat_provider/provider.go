package export_glixo_llm_provider_compat_provider

import (
	"github.com/glixo-community/ollama-provider-go/generated/wit/glixo_llm_types_types"
	provider "github.com/glixo-community/ollama-provider-go/provider"
	types "go.bytecodealliance.org/pkg/wit/types"
)

func Describe(context glixo_llm_types_types.ProviderContext) types.Result[glixo_llm_types_types.ProviderDescriptor, string] {
	return provider.Describe(context)
}
func ValidateConfiguration(config string, context glixo_llm_types_types.ProviderContext) types.Result[glixo_llm_types_types.ConfigurationReport, string] {
	return provider.ValidateConfiguration(config, context)
}
func ListModels(context glixo_llm_types_types.ProviderContext) types.Result[[]string, string] {
	return provider.ListModels(context)
}
func Start(request glixo_llm_types_types.LlmRequest, context glixo_llm_types_types.ProviderContext) types.Result[uint32, string] {
	return provider.Start(request, context)
}
func Next(handle uint32) types.Result[types.Option[glixo_llm_types_types.ProviderEvent], string] {
	return provider.Next(handle)
}
func Cancel(handle uint32) { provider.Cancel(handle) }
func Drop(handle uint32)   { provider.Drop(handle) }
