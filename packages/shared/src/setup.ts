import { z } from 'zod';

/** Before login: whether first-run setup is still needed and what this install can change. */
export type SetupStatus = {
  /** Passphrase and Plaid keys are set; false means the app shows the setup wizard. */
  configured: boolean;
  /** Settings can be changed from the app (they live in Meld's settings file, not only in .env). */
  editable: boolean;
  /** The desktop app can turn on phone access over Tailscale. */
  phoneAccess: boolean;
  /** Unlocking takes a passphrase; false means it was turned off and the app opens straight in. */
  passphrase: boolean;
};

export const PlaidEnvironment = z.enum(['sandbox', 'production']);
export type PlaidEnvironment = z.infer<typeof PlaidEnvironment>;

export const PlaidKeys = z.object({
  clientId: z.string().trim().min(1, 'Enter your Plaid client ID'),
  sandboxSecret: z.string().trim().default(''),
  productionSecret: z.string().trim().default(''),
  env: PlaidEnvironment,
});
export type PlaidKeys = z.infer<typeof PlaidKeys>;

export const AISettings = z.object({
  anthropicApiKey: z.string().trim().default(''),
  /** Empty turns Ollama off. */
  ollamaUrl: z.union([z.url(), z.literal('')]).default(''),
  /** Empty offers every installed model that supports tool calling. */
  ollamaModels: z.array(z.string()).default([]),
  /** From Settings: drop the saved key (an empty field otherwise keeps it). */
  removeAnthropicKey: z.boolean().default(false),
});
export type AISettings = z.infer<typeof AISettings>;

export const Passphrase = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(200);

export const SetupRequest = z.object({
  /** Omitted: no passphrase, so anyone who can reach Meld can use it. */
  passphrase: Passphrase.optional(),
  plaid: PlaidKeys,
  ai: AISettings,
});
export type SetupRequest = z.input<typeof SetupRequest>;

/**
 * A change from Settings. Omitted sections are left alone, and so is a secret left
 * empty, since the app only ever sees secrets masked.
 */
export const SettingsUpdate = z.object({
  /** `next: null` turns the passphrase off. `current` is needed unless it's off already. */
  passphrase: z.object({ current: z.string().default(''), next: Passphrase.nullable() }).optional(),
  plaid: PlaidKeys.optional(),
  ai: AISettings.optional(),
});
export type SettingsUpdate = z.input<typeof SettingsUpdate>;

/** Current settings, with secrets masked to their last 4 characters. */
export type SettingsView = {
  editable: boolean;
  /** Unlocking takes a passphrase. */
  passphrase: boolean;
  plaid: { clientId: string; sandboxSecret: string; productionSecret: string; env: PlaidEnvironment };
  ai: { anthropicApiKey: string; ollamaUrl: string; ollamaModels: string[] };
  /** Settings fixed by the environment (.env), which the app can't change. */
  fromEnv: ('plaid' | 'ai' | 'passphrase')[];
};

export const PlaidKeyTest = z.object({
  clientId: z.string().trim().min(1, 'Enter your Plaid client ID'),
  secret: z.string().trim().default(''),
  env: PlaidEnvironment,
});
export type PlaidKeyTest = z.input<typeof PlaidKeyTest>;

export const AnthropicKeyTest = z.object({ apiKey: z.string().trim().default('') });
export type AnthropicKeyTest = z.input<typeof AnthropicKeyTest>;

export type KeyTestResult = { ok: true } | { ok: false; error: string };

export const OllamaDetectRequest = z.object({ url: z.union([z.url(), z.literal('')]).default('') });
export type OllamaDetectRequest = z.input<typeof OllamaDetectRequest>;

export type OllamaDetectResult =
  | { found: true; url: string; models: string[] }
  | { found: false; tried: string[] };

/** Reaching Meld from a phone over Tailscale (desktop app only). */
export type PhoneAccess =
  /** Tailscale isn't installed on this computer. */
  | { state: 'not-installed' }
  /** Installed, but not signed in or not connected. */
  | { state: 'not-running' }
  /** Connected, but the tailnet doesn't have HTTPS certificates turned on, which `tailscale serve` needs. */
  | { state: 'no-https'; machine: string }
  | { state: 'off'; machine: string }
  | { state: 'on'; machine: string; url: string };

export const PhoneAccessUpdate = z.object({ enabled: z.boolean() });
export type PhoneAccessUpdate = z.infer<typeof PhoneAccessUpdate>;

/** Ask Meld on the user's own ChatGPT plan, through Sign in with ChatGPT. */
export type ChatGPTStatus =
  | { state: 'signed-out'; error: string | null }
  /** Waiting for the browser to come back from ChatGPT's sign-in page. */
  | { state: 'pending'; authorizeUrl: string }
  | { state: 'signed-in'; email: string | null };

export const ChatGPTCallback = z.object({
  /** The address the browser landed on after signing in, for when it couldn't reach Meld itself. */
  url: z.string().trim().min(1, 'Paste the address from your browser').max(4000),
});
export type ChatGPTCallback = z.infer<typeof ChatGPTCallback>;
