namespace ContributionWorld.wit.Exports.glixo.contribution.v1_0_0;

public static class GuestExportsImpl
{
    // docs:snippet-start workflow-text-stats-guest:csharp
    public static string Invoke(string requestJson)
    {
        try { return Glixo.Reference.WorkflowTextStats.Handler.Invoke(requestJson); }
        catch (Exception error)
        {
            var code = error is InvalidOperationException && error.Message.Length is > 0 and <= 96
                && error.Message.All(character => char.IsAsciiLetterOrDigit(character) || character == '_')
                ? error.Message
                : "guest_request_invalid";
            throw new ContributionWorld.WitException<string>(code, 0);
        }
    }
    // docs:snippet-end workflow-text-stats-guest:csharp
}
