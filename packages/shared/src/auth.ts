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
  /** Cloud AI (ANTHROPIC_API_KEY) is set up: home and vehicle value lookups and policy PDF reading. */
  cloudAI: boolean;
};
