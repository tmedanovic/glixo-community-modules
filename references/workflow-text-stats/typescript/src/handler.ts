export const CONTRIBUTION_ID = 'text-stats';
export const MAXIMUM_TEXT_SCALARS = 65_536;

export interface TextStatsInput {
  readonly text: string;
  readonly includeWhitespace?: boolean;
  readonly minimumWordLength?: number;
}
export interface TextStatsResult { readonly wordCount: number; readonly characterCount: number; }
interface HostEnvelope {
  readonly kind: string;
  readonly contributionId: string;
  readonly input: unknown;
}

const stableErrorCodes = new Set([
  'guest_envelope_invalid', 'contribution_mismatch', 'input_invalid', 'text_required',
  'text_too_long', 'include_whitespace_invalid', 'minimum_word_length_out_of_range',
]);

// docs:snippet-start workflow-text-stats-handler:typescript
export function handleWorkflowTextStats(requestJson: string): TextStatsResult {
  if (new TextEncoder().encode(requestJson).length > 128 * 1024) throw 'guest_envelope_invalid';
  let envelope: HostEnvelope;
  try { envelope = JSON.parse(requestJson) as HostEnvelope; } catch { throw 'guest_envelope_invalid'; }
  if (!envelope || envelope.kind !== 'tools' || envelope.contributionId !== CONTRIBUTION_ID) throw 'contribution_mismatch';
  if (!isRecord(envelope.input)) throw 'input_invalid';
  const input = envelope.input;
  if (typeof input.text !== 'string') throw 'text_required';
  if (input.includeWhitespace !== undefined && typeof input.includeWhitespace !== 'boolean') throw 'include_whitespace_invalid';
  if (Object.hasOwn(input, 'minimumWordLength') && input.minimumWordLength === null) throw 'minimum_word_length_out_of_range';
  const minimumValue = input.minimumWordLength;
  const minimumWordLength = minimumValue === undefined ? 1 : typeof minimumValue === 'number' ? minimumValue : Number.NaN;
  if (!Number.isSafeInteger(minimumWordLength) || minimumWordLength < 1 || minimumWordLength > 128) throw 'minimum_word_length_out_of_range';
  const result = analyze(input.text, input.includeWhitespace ?? true, minimumWordLength);
  return result;
}

export function analyze(text: string, includeWhitespace = true, minimumWordLength = 1): TextStatsResult {
  if (!Number.isSafeInteger(minimumWordLength) || minimumWordLength < 1 || minimumWordLength > 128) throw 'minimum_word_length_out_of_range';
  const scalars = Array.from(text);
  if (scalars.length > MAXIMUM_TEXT_SCALARS) throw 'text_too_long';
  let wordCount = 0;
  let characterCount = 0;
  let wordLength = 0;
  for (const scalar of scalars) {
    if (isWhiteSpace(scalar.codePointAt(0)!)) {
      if (includeWhitespace) characterCount += 1;
      if (wordLength >= minimumWordLength) wordCount += 1;
      wordLength = 0;
    } else {
      characterCount += 1;
      wordLength += 1;
    }
  }
  if (wordLength >= minimumWordLength) wordCount += 1;
  return { wordCount, characterCount };
}

function isWhiteSpace(scalar: number): boolean {
  return scalar >= 0x0009 && scalar <= 0x000D || scalar === 0x0020 || scalar === 0x0085 || scalar === 0x00A0 || scalar === 0x1680
    || scalar >= 0x2000 && scalar <= 0x200A || scalar === 0x2028 || scalar === 0x2029 || scalar === 0x202F || scalar === 0x205F || scalar === 0x3000;
}
// docs:snippet-end workflow-text-stats-handler:typescript

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stableError(error: unknown): string {
  const code = typeof error === 'string' ? error : '';
  return stableErrorCodes.has(code) ? code : 'workflow_text_stats_failed';
}
