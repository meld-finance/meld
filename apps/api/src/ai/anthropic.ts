import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { PropertyEstimate, SecurityProfile, VehicleDetails, VehicleEstimate } from '@meld/shared';
import { z } from 'zod';
import { HttpError } from '../lib/http';
import { localDate } from '../lib/networth';
import { MAX_TOOL_ROUNDS, runTool, toolLabel, toToolJsonSchema, type ChatTool } from './chat-tools';
import { EQUITY_EXTRACTION_PROMPT, EquityExtractionSchema, normalizeEquityExtraction } from './equity-extraction';
import { EXTRACTION_PROMPT, ExtractionSchema, normalizeExtraction } from './insurance-extraction';
import { normalizeValuation, valuationPrompt, ValuationSchema } from './property-valuation';
import { normalizeVehicleValuation, vehicleValuationPrompt, VehicleValuationSchema } from './vehicle-valuation';
import { normalizeProfiles, ProfilesSchema, profilesPrompt, type SecurityDescription } from './security-profiles';
import type { AIProvider, ChatModelInfo, ChatTurnInput, ChatTurnResult, ExtractedEquityGrant, ExtractedPolicy, StoredChatMessage } from './provider';

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlock = Anthropic.Beta.BetaContentBlock;

const PROVIDER = 'anthropic';
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

function toToolDefinition(t: ChatTool, defer: boolean): Anthropic.Beta.BetaTool {
  return {
    name: t.name,
    description: t.description,
    input_schema: toToolJsonSchema(t.input) as Anthropic.Beta.BetaTool.InputSchema,
    ...(defer && t.deferLoading ? { defer_loading: true } : {}),
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

/** Picker labels for known chat models; others show their model ID. */
const CHAT_MODEL_INFO: Record<string, { label: string; note: string }> = {
  'claude-opus-5-5': { label: 'Claude Opus 5.5', note: 'Most capable' },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5', note: 'Balanced' },
  'claude-haiku-5-5': { label: 'Claude Haiku 5.5', note: 'Lowest cost' },
};

export type AnthropicChatEffort = 'low' | 'medium' | 'high';

export class AnthropicProvider implements AIProvider {
  readonly name = PROVIDER;
  private client: Anthropic;
  private chatModels: string[];
  private noDeferredTools = new Set<string>();

  /** `chatModels` are offered in the Ask picker; the first is the default. */
  constructor(
    apiKey: string,
    private model: string,
    private lookupModel: string,
    chatModels: string[],
    private chatEffort?: AnthropicChatEffort,
  ) {
    this.client = new Anthropic({ apiKey });
    this.chatModels = [...new Set(chatModels)];
  }

  private effortFor(model: string): AnthropicChatEffort {
    if (this.chatEffort) return this.chatEffort;
    return model.includes('opus') ? 'medium' : 'low';
  }

  async listChatModels(): Promise<ChatModelInfo[]> {
    return this.chatModels.map((model) => ({
      model,
      label: CHAT_MODEL_INFO[model]?.label ?? model,
      note: CHAT_MODEL_INFO[model]?.note ?? null,
      local: false,
    }));
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

  async extractEquityGrantFromPdf(pdf: Buffer): Promise<ExtractedEquityGrant> {
    const response = await this.client.beta.messages
      .parse({
        model: this.model,
        max_tokens: 16000,
        ...FALLBACK,
        output_config: { effort: 'medium', format: betaZodOutputFormat(EquityExtractionSchema) },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') },
              },
              { type: 'text', text: EQUITY_EXTRACTION_PROMPT },
            ],
          },
        ],
      })
      .catch(toHttpError);

    if (response.stop_reason === 'refusal') throw new HttpError(422, 'The AI declined to read this document.');
    if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
      throw new HttpError(422, 'Couldn’t read RSU grant details from this document. Enter them by hand instead.');
    }
    return normalizeEquityExtraction(response.parsed_output);
  }

  async extractEquityGrantFromText(text: string): Promise<ExtractedEquityGrant> {
    const response = await this.client.beta.messages
      .parse({
        model: this.lookupModel,
        max_tokens: 16000,
        ...FALLBACK,
        output_config: { effort: 'low', format: betaZodOutputFormat(EquityExtractionSchema) },
        messages: [{ role: 'user', content: `${EQUITY_EXTRACTION_PROMPT}\n\n---\n\n${text}` }],
      })
      .catch(toHttpError);

    if (response.stop_reason === 'refusal') throw new HttpError(422, 'The AI declined to parse this vesting schedule.');
    if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
      throw new HttpError(422, 'Couldn’t read a vesting schedule from that text. Enter the grant by hand instead.');
    }
    return normalizeEquityExtraction(response.parsed_output);
  }

  async estimatePropertyValue(address: string): Promise<PropertyEstimate> {
    const raw = await this.searchAndParse(valuationPrompt(address, localDate()), ValuationSchema, 'look up this address');
    const result = normalizeValuation(raw, address);
    if (!('value' in result)) throw new HttpError(422, result.warnings.join(' '));
    return result;
  }

  async estimateVehicleValue(vehicle: VehicleDetails): Promise<VehicleEstimate> {
    const raw = await this.searchAndParse(vehicleValuationPrompt(vehicle, localDate()), VehicleValuationSchema, 'look up this vehicle');
    const result = normalizeVehicleValuation(raw);
    if (!('value' in result)) throw new HttpError(422, result.warnings.join(' '));
    return result;
  }

  /** Runs a web-search lookup to a structured answer, resuming the turn when searching pauses it. */
  private async searchAndParse<T>(prompt: string, schema: z.ZodType<T>, task: string): Promise<T> {
    const messages: MessageParam[] = [{ role: 'user', content: prompt }];
    for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
      const response = await this.client.beta.messages
        .parse({
          model: this.lookupModel,
          max_tokens: 16000,
          ...FALLBACK,
          // Each search is a sequential step, so time grows with the budget. Most sites' pages either
          // show up in the first few searches or not at all, and pricing pages often block fetches.
          output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
          tools: [
            { type: 'web_search_20260209', name: 'web_search', max_uses: 8 },
            { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 2 },
          ],
          messages,
        })
        .catch(toHttpError);

      // Searching hit the server's step limit; send the turn back as is and it resumes.
      if (response.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
        continue;
      }
      if (response.stop_reason === 'refusal') throw new HttpError(422, `The AI declined to ${task}.`);
      if (!response.parsed_output) throw new HttpError(422, 'Couldn’t put together an estimate. Enter the value by hand instead.');
      return response.parsed_output;
    }
    throw new HttpError(504, 'Looking up the value took too long. Try again, or enter it by hand.');
  }

  async profileSecurities(securities: SecurityDescription[]): Promise<(SecurityProfile | null)[]> {
    const response = await this.client.beta.messages
      .parse({
        model: this.lookupModel,
        max_tokens: 16000,
        ...FALLBACK,
        // Fund make-up is reference knowledge; no search needed for approximate weights.
        output_config: { effort: 'low', format: betaZodOutputFormat(ProfilesSchema) },
        messages: [{ role: 'user', content: profilesPrompt(securities) }],
      })
      .catch(toHttpError);
    if (response.stop_reason === 'refusal') throw new HttpError(422, 'The AI declined to look up these holdings.');
    if (!response.parsed_output) throw new HttpError(422, 'Couldn’t work out what these holdings contain. Try again later.');
    return normalizeProfiles(response.parsed_output, securities.length);
  }

  async chat({ model, system, snapshot, history, userText, tools, onEvent, signal }: ChatTurnInput): Promise<ChatTurnResult> {
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
    const effort = this.effortFor(model);
    const hasDeferred = tools.some((t) => t.deferLoading);

    const runStream = (useDeferred: boolean) => {
      const toolDefs: Anthropic.Beta.BetaToolUnion[] = useDeferred
        ? [
            { type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' },
            ...tools.map((t) => toToolDefinition(t, true)),
          ]
        : tools.map((t) => toToolDefinition(t, false));
      const stream = this.client.beta.messages.stream(
        {
          model,
          max_tokens: 64000,
          ...FALLBACK,
          output_config: { effort },
          // Caches the growing conversation across rounds and follow-up turns.
          cache_control: { type: 'ephemeral' },
          system: [
            // Dedicated breakpoint on the static prompt keeps `tools + SYSTEM_PROMPT` cached across new sessions.
            { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
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
      stream.on('contentBlock', (block) => {
        if (block.type === 'tool_use') {
          onEvent({ type: 'lookup', label: toolLabel(toolsByName.get(block.name), block.name, block.input) });
        }
      });
      stream.on('text', (text) => {
        streamedText = true;
        onEvent({ type: 'text', text });
      });
      return stream.finalMessage();
    };

    for (let step = 0; step < MAX_TOOL_ROUNDS; step++) {
      const useDeferred = hasDeferred && !this.noDeferredTools.has(model);
      let message: Anthropic.Beta.BetaMessage;
      try {
        message = await runStream(useDeferred);
      } catch (err) {
        if (
          useDeferred &&
          err instanceof Anthropic.BadRequestError &&
          /defer_loading|tool_search/i.test(err.message)
        ) {
          this.noDeferredTools.add(model);
          message = await runStream(false).catch(toHttpError);
        } else {
          toHttpError(err);
        }
      }

      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      // A truncated tool call can't be answered or replayed, so the whole turn fails instead.
      if (message.stop_reason === 'max_tokens' && toolUses.length) {
        throw new HttpError(502, 'The answer was cut off. Try a narrower question.');
      }

      const lookups = toolUses.map((u) => toolLabel(toolsByName.get(u.name), u.name, u.input));
      const assistantContent = message.content as Anthropic.Beta.BetaContentBlockParam[];
      messages.push({ role: 'assistant', content: assistantContent });
      stored.push({
        role: 'assistant',
        content: { provider: PROVIDER, native: assistantContent, display: { text: textOf(message.content), lookups } },
      });

      if (message.stop_reason === 'pause_turn') continue;
      if (message.stop_reason === 'refusal') return { messages: stored, outcome: 'refused' };
      if (message.stop_reason === 'max_tokens') return { messages: stored, outcome: 'truncated' };
      if (message.stop_reason !== 'tool_use' || !toolUses.length) return { messages: stored, outcome: 'complete' };

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
