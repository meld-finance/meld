import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { HttpError } from '../lib/http';
import { EXTRACTION_PROMPT, ExtractionSchema, normalizeExtraction } from './insurance-extraction';
import type { AIProvider, ExtractedPolicy } from './provider';

/** Turns SDK errors into messages the app can show; never forwards raw error bodies. */
function toHttpError(err: unknown): never {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    throw new HttpError(502, 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.');
  }
  if (err instanceof Anthropic.RateLimitError) throw new HttpError(503, 'The AI is rate limited. Try again in a minute.');
  if (err instanceof Anthropic.BadRequestError) throw new HttpError(422, `The AI couldn’t process this request: ${err.message}`);
  if (err instanceof Anthropic.APIError) throw new HttpError(502, 'The AI service had a problem. Try again shortly.');
  throw err;
}

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
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
        // If a safety classifier declines, the API retries on a fallback model in the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
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
}
