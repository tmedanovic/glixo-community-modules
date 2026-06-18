export interface TeamsChannelThreadParts {
  channelId: string;
  rootMessageId: string | null;
}

export function isTeamsChannelThreadId(threadId: string | null | undefined): boolean {
  return parseTeamsChannelThreadId(threadId) !== null;
}

export function parseTeamsChannelThreadId(threadId: string | null | undefined): TeamsChannelThreadParts | null {
  const raw = threadId?.trim() ?? '';
  if (!raw) return null;
  const match = raw.match(/^(.*@thread\.tacv2)(?::(.+))?$/i);
  if (!match?.[1]) return null;
  const rootMessageId = match[2]?.trim() || null;
  return { channelId: match[1], rootMessageId };
}

/** Stable thread key for channel root posts and replies (matches genie-server shape). */
export function teamsChannelThreadId(parts: TeamsChannelThreadParts, messageId: string): string {
  return `teams:${parts.channelId}:${parts.rootMessageId ?? messageId}`;
}

/** Conversation row key — group channel replies under the root thread. */
export function resolveChannelConversationThreadId(parsed: { threadId: string; messageId: string }): string {
  const parts = parseTeamsChannelThreadId(parsed.threadId);
  if (!parts) return parsed.threadId;
  if (parts.rootMessageId) return `${parts.channelId}:${parts.rootMessageId}`;
  return parts.channelId;
}

export function buildMessageExternalId(parsed: { threadId: string; messageId: string }): string {
  const channelThread = parseTeamsChannelThreadId(parsed.threadId);
  if (!channelThread) return `teams:${parsed.threadId}:${parsed.messageId}`;
  const threadKey = teamsChannelThreadId(channelThread, parsed.messageId);
  return `${threadKey}:${parsed.messageId}`;
}
