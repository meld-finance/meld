import { z } from 'zod';

export const LoginRequest = z.object({
  passphrase: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const LoginResponse = z.object({
  token: z.string(),
  expiresAt: z.string(),
});
export type LoginResponse = z.infer<typeof LoginResponse>;

/** What this install can do, so the app can offer a feature or explain how to turn it on. */
export type AppFeatures = {
  /** Cloud AI (an Anthropic or OpenRouter key) is set up: home and vehicle value lookups and policy PDF reading. */
  cloudAI: boolean;
  /** Which one runs those features, so the app can say where documents and lookups go. */
  cloudAIProvider: 'anthropic' | 'openrouter' | null;
  /** The version running, when known (the Mac app passes it; Docker and dev read apps/desktop/package.json). */
  version: string | null;
};
