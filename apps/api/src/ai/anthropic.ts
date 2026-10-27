import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { PropertyEstimate } from '@meld/shared';
import { z } from 'zod';
import { HttpError } from '../lib/http';
import { localDate } from '../lib/networth';
import { maskNumbers, type ChatTool } from './chat-tools';
import { EXTRACTION_PROMPT, ExtractionSchema, normalizeExtraction } from './insurance-extraction';
import { normalizeValuation, valuationPrompt, ValuationSchema } from './property-valuation';
import type { AIProvider, ChatTurnInput, ChatTurnResult, ExtractedPolicy, StoredChatMessage } from './provider';

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlock = Anthropic.Beta.BetaContentBlock;

const PROVIDER = 'anthropic';
/** Tool rounds per user message before giving up. */
const MAX_STEPS = 12;
/** Times a paused server-tool turn (web search) is resumed before giving up. */
const MAX_CONTINUATIONS = 4;
// If a safety classifier declines, the API retries on a fallback model in the same call.
const FALLBACK: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: 'default' } = {
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
};

/** Turns SDK errors into messages the app can show; never forwards raw error bodies. */
function toHttpError(err: unknown): never {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    throw new HttpError(502, 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.');
  }
  if (err instanceof Anthropic.RateLimitError) throw new HttpError(503, 'The AI is rate limited. Try again in a minute.');
  if (err instanceof Anthropic.BadRequestError) throw new HttpError(422, `The AI couldn’t process this request: ${err.message}`);
  if (err instanceof Anthropic.APIUserAbortError) throw err;
  if (err instanceof Anthropic.APIError) throw new HttpError(502, 'The AI service had a problem. Try again shortly.');
  if (err instanceof Anthropic.AnthropicError) {
    // E.g. a streamed tool input that wasn't valid JSON.
    throw new HttpError(502, 'The AI returned a response Meld couldn’t read. Try asking again.');
  }
  throw err;
}

function toToolDefinition(t: ChatTool): Anthropic.Beta.BetaTool {
  return {
    name: t.name,
    description: t.description,
    input_schema: z.toJSONSchema(t.input, { io: 'input' }) as Anthropic.Beta.BetaTool.InputSchema,
    // Stream tool inputs as generated; inputs are validated with Zod before running.
    eager_input_streaming: true,
  };
}

const textOf = (content: ContentBlock[]) =>
  content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

/** Earlier turns from another provider are replayed as plain text. */
function toParam(m: StoredChatMessage): MessageParam | null {
  if (m.content.provider === PROVIDER) return { role: m.role, content: m.content.native } as MessageParam;
  return m.content.display ? { role: m.role, content: m.content.display.text } : null;
}

async function runTool(tool: ChatTool | undefined, input: unknown): Promise<{ content: string; isError: boolean }> {
  if (!tool) return { content: 'Unknown tool.', isError: true };
  const parsed = tool.input.safeParse(input);
  if (!parsed.success) return { content: `Invalid input: ${z.prettifyError(parsed.error)}`, isError: true };
  try {
    return { content: JSON.stringify(maskNumbers(await tool.run(parsed.data))), isError: false };
  } catch {
    return { content: 'The lookup failed. Answer with what you have, or try different input.', isError: true };
  }
}

export class AnthropicProvider implements AIProvider {
  readonly name = PROVIDER;
  private client: Anthropic;

  constructor(
    apiKey: string,
    private model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async extractInsurancePolicy(pdf: Buffer): Promise<ExtractedPolicy> {
    const response = await this.client.beta.messages
      .parse({
        model: this.model,
        max_tokens: 16000,
        ...FALLBACK,
        output_config: { effort: 'medium', format: betaZodOutputFormat(ExtractionSchema) },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') },
              },
              { type: 'text', text: EXTRACTION_PROMPT },
            ],
          },
        ],
      })
      .catch(toHttpError);

    if (response.stop_reason === 'refusal') throw new HttpError(422, 'The AI declined to read this document.');
    if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
      throw new HttpError(422, 'Couldn’t read policy details from this document. Enter them by hand instead.');
    }
    return normalizeExtraction(response.parsed_output);
  }

  async estimatePropertyValue(address: string): Promise<PropertyEstimate> {
    const messages: MessageParam[] = [{ role: 'user', content: valuationPrompt(address, localDate()) }];
    for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
      const response = await this.client.beta.messages
        .parse({
          model: this.model,
          max_tokens: 16000,
          ...FALLBACK,
          output_config: { effort: 'medium', format: betaZodOutputFormat(ValuationSchema) },
          tools: [
            // Units need more searching: one page per site for the exact unit, then comparables.
            { type: 'web_search_20260209', name: 'web_search', max_uses: 16 },
            { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 8 },
          ],
          messages,
        })
        .catch(toHttpError);

      // Searching hit the server's step limit; send the turn back as is and it resumes.
      if (response.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
        continue;
      }
      if (response.stop_reason === 'refusal') throw new HttpError(422, 'The AI declined to look up this address.');
      if (!response.parsed_output) throw new HttpError(422, 'Couldn’t put together an estimate. Enter the value by hand instead.');
      const result = normalizeValuation(response.parsed_output, address);
      if (!('value' in result)) throw new HttpError(422, result.warnings.join(' '));
      return result;
    }
    throw new HttpError(504, 'Looking up the value took too long. Try again, or enter it by hand.');
  }

  async chat({ system, snapshot, history, userText, tools, onEvent, signal }: ChatTurnInput): Promise<ChatTurnResult> {
    const toolDefs = tools.map(toToolDefinition);
    const toolsByName = new Map(tools.map((t) => [t.name, t]));
    const userContent: Anthropic.Beta.BetaContentBlockParam[] = [{ type: 'text', text: userText }];
    const messages: MessageParam[] = [
      ...history.map(toParam).filter((m): m is MessageParam => m !== null),
      { role: 'user', content: userContent },
    ];
    const stored: StoredChatMessage[] = [
      { role: 'user', content: { provider: PROVIDER, native: userContent, display: { text: userText, lookups: [] } } },
    ];
    let streamedText = false;

    for (let step = 0; step < MAX_STEPS; step++) {
      const stream = this.client.beta.messages.stream(
        {
          model: this.model,
          max_tokens: 64000,
          ...FALLBACK,
          output_config: { effort: 'high' },
          // Caches the stable prefix (tools, system, earlier turns) across requests.
          cache_control: { type: 'ephemeral' },
          system: [
            { type: 'text', text: system },
            { type: 'text', text: snapshot },
          ],
          tools: toolDefs,
          messages,
        },
        { signal },
      );
      stream.on('streamEvent', (event) => {
        // Separate answer text that resumes after a tool call.
        if (event.type === 'content_block_start' && event.content_block.type === 'text' && streamedText) {
          onEvent({ type: 'text', text: '\n\n' });
        }
      });
      stream.on('text', (text) => {
        streamedText = true;
        onEvent({ type: 'text', text });
      });
      const message = await stream.finalMessage().catch(toHttpError);

      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      // A truncated tool call can't be answered or replayed, so the whole turn fails instead.
      if (message.stop_reason === 'max_tokens' && toolUses.length) {
        throw new HttpError(502, 'The answer was cut off. Try a narrower question.');
      }

      const lookups = toolUses.map((u) => {
        const t = toolsByName.get(u.name);
        const parsed = t?.input.safeParse(u.input);
        return t && parsed?.success ? t.label(parsed.data) : u.name;
      });
      const assistantContent = message.content as Anthropic.Beta.BetaContentBlockParam[];
      messages.push({ role: 'assistant', content: assistantContent });
      stored.push({
        role: 'assistant',
        content: { provider: PROVIDER, native: assistantContent, display: { text: textOf(message.content), lookups } },
      });

      if (message.stop_reason === 'refusal') return { messages: stored, outcome: 'refused' };
      if (message.stop_reason === 'max_tokens') return { messages: stored, outcome: 'truncated' };
      if (message.stop_reason !== 'tool_use' || !toolUses.length) return { messages: stored, outcome: 'complete' };

      lookups.forEach((label) => onEvent({ type: 'lookup', label }));
      // All results go back in one message, in order, so parallel calls stay paired.
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(
        toolUses.map(async (u) => {
          const r = await runTool(toolsByName.get(u.name), u.input);
          return { type: 'tool_result', tool_use_id: u.id, content: r.content, is_error: r.isError || undefined };
        }),
      );
      messages.push({ role: 'user', content: results });
      stored.push({ role: 'user', content: { provider: PROVIDER, native: results, display: null } });
    }
    return { messages: stored, outcome: 'step_limit' };
  }
}
