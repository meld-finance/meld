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
