import { ChatGPTCallback, type ChatGPTStatus } from '@meld/shared';
import type { FastifyInstance } from 'fastify';
import type { ChatGPTAuth } from '../ai/chatgpt-auth';
import { parse } from '../lib/http';

/** Settings → AI: signing in with ChatGPT so Ask Meld can use the user's plan. */
export async function registerChatGPTRoutes(app: FastifyInstance, auth: ChatGPTAuth) {
  app.addHook('onClose', async () => auth.close());

  app.get('/ai/chatgpt', async (): Promise<ChatGPTStatus> => auth.status());

  /** Returns the ChatGPT page to open; the browser comes back to Meld's loopback listener. */
  app.post('/ai/chatgpt/sign-in', async (): Promise<{ authorizeUrl: string }> => ({ authorizeUrl: await auth.startSignIn() }));

  app.post('/ai/chatgpt/callback', async (req): Promise<ChatGPTStatus> => {
    await auth.finishFromUrl(parse(ChatGPTCallback, req.body).url);
    return auth.status();
  });

  app.delete('/ai/chatgpt', async (): Promise<{ revoked: boolean }> => ({ revoked: await auth.signOut() }));
}
