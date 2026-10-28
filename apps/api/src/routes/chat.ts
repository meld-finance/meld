import {
  ChatSendRequest,
  type ChatModelList,
  type ChatMessageView,
  type ChatSessionDetail,
  type ChatSessionSummary,
  type ChatStreamEvent,
} from '@meld/shared';
import { asc, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createChatModels } from '../ai/chat-models';
import { createChatTools } from '../ai/chat-tools';
import { buildSnapshot, SYSTEM_PROMPT } from '../ai/prompt';
import type { ChatTurnResult, StoredChatMessage } from '../ai/provider';
import { chatMessages, chatSessions } from '../db/schema';
import { HttpError, IdParams, parse } from '../lib/http';
import type { AppDeps } from '../server';

type MessageRow = { id: string; role: 'user' | 'assistant'; content: unknown; createdAt: Date };

const OUTCOME_NOTES: Partial<Record<ChatTurnResult['outcome'], string>> = {
  refused: 'Sorry, I can’t help with that request.',
  truncated: '*(The answer was cut off. Ask me to continue.)*',
  step_limit: '*(I stopped after many lookups without finishing. Try a more specific question.)*',
};

/** Folds tool round-trips into the assistant message they belong to. */
export function toViews(rows: MessageRow[]): ChatMessageView[] {
  const views: ChatMessageView[] = [];
  for (const row of rows) {
    const display = (row.content as StoredChatMessage['content']).display;
    if (!display) continue;
    const last = views.at(-1);
    if (row.role === 'assistant' && last?.role === 'assistant') {
      last.text = [last.text, display.text].filter(Boolean).join('\n\n');
      last.lookups.push(...display.lookups);
      continue;
    }
    views.push({
      id: row.id,
      role: row.role,
      text: display.text,
      lookups: [...display.lookups],
      createdAt: row.createdAt.toISOString(),
    });
  }
  return views;
}

const summaryColumns = {
  id: chatSessions.id,
  title: chatSessions.title,
  createdAt: chatSessions.createdAt,
  updatedAt: chatSessions.updatedAt,
};

const toSummary = (s: { id: string; title: string | null; createdAt: Date; updatedAt: Date }): ChatSessionSummary => ({
  ...s,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

function titleFrom(text: string) {
  const line = text.trim().split('\n')[0]!;
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
}

export async function registerChatRoutes(app: FastifyInstance, { env, db, ai }: AppDeps) {
  const tools = createChatTools(db);
  const chatModels = createChatModels(env, ai);

  async function loadSession(id: string) {
    const session = await db.query.chatSessions.findFirst({ where: eq(chatSessions.id, id) });
    if (!session) throw new HttpError(404, 'Conversation not found');
    return session;
  }

  const loadMessages = (sessionId: string) =>
    db
      .select({ id: chatMessages.id, role: chatMessages.role, content: chatMessages.content, createdAt: chatMessages.createdAt })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(asc(chatMessages.createdAt));

  app.get('/chat/sessions', async () =>
    (await db.select(summaryColumns).from(chatSessions).orderBy(desc(chatSessions.updatedAt)).limit(100)).map(toSummary),
  );

  app.get('/chat/models', (): Promise<ChatModelList> => chatModels.list());

  app.post('/chat/sessions', async () => {
    await chatModels.resolve(undefined);
    const [row] = await db
      .insert(chatSessions)
      .values({ context: await buildSnapshot(db) })
      .returning(summaryColumns);
    return toSummary(row!);
  });

  app.get('/chat/sessions/:id', async (req): Promise<ChatSessionDetail> => {
    const session = await loadSession(parse(IdParams, req.params).id);
    return { ...toSummary(session), messages: toViews(await loadMessages(session.id)) };
  });

  app.delete('/chat/sessions/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const [row] = await db.delete(chatSessions).where(eq(chatSessions.id, id)).returning({ id: chatSessions.id });
    if (!row) throw new HttpError(404, 'Conversation not found');
    return { ok: true };
  });

  /** Streams the answer as server-sent events (see ChatStreamEvent). */
  app.post('/chat/sessions/:id/messages', async (req, reply) => {
    const { text, model: modelId } = parse(ChatSendRequest, req.body);
    const { provider, model } = await chatModels.resolve(modelId);
    const session = await loadSession(parse(IdParams, req.params).id);
    const history = (await loadMessages(session.id)).map((r) => ({
      role: r.role,
      content: r.content as StoredChatMessage['content'],
    }));

    reply.hijack();
    const res = reply.raw;
    // Keep headers set by earlier hooks (CORS); undefined values aren't valid here.
    const hookHeaders = Object.fromEntries(Object.entries(reply.getHeaders()).filter(([, v]) => v !== undefined));
    res.writeHead(200, {
      ...(hookHeaders as Record<string, string | number | string[]>),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    const send = (event: ChatStreamEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    // Stop generating (and save nothing) if the client goes away mid-answer.
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });

    try {
      const result = await provider.chat({
        model,
        system: SYSTEM_PROMPT,
        snapshot: session.context ?? (await buildSnapshot(db)),
        history,
        userText: text,
        tools,
        onEvent: send,
        signal: abort.signal,
      });

      const note = OUTCOME_NOTES[result.outcome];
      const lastDisplay = result.messages.filter((m) => m.role === 'assistant').at(-1)?.content.display;
      if (note && lastDisplay) lastDisplay.text = [lastDisplay.text, note].filter(Boolean).join('\n\n');

      // Explicit, increasing timestamps keep the order stable (now() is fixed within a transaction).
      const base = Date.now();
      const title = session.title ?? titleFrom(text);
      const inserted = await db.transaction(async (tx) => {
        const rows = await tx
          .insert(chatMessages)
          .values(result.messages.map((m, i) => ({ sessionId: session.id, role: m.role, content: m.content, createdAt: new Date(base + i) })))
          .returning({ id: chatMessages.id, role: chatMessages.role, content: chatMessages.content, createdAt: chatMessages.createdAt });
        await tx.update(chatSessions).set({ title, updatedAt: new Date(base) }).where(eq(chatSessions.id, session.id));
        return rows;
      });
      const answer = toViews(inserted).at(-1);
      if (answer?.role === 'assistant') send({ type: 'done', message: answer, title });
      else send({ type: 'error', error: 'No answer was produced. Try again.' });
    } catch (err) {
      if (abort.signal.aborted) return;
      if (err instanceof HttpError) {
        send({ type: 'error', error: err.message });
      } else {
        req.log.error({ err }, 'Chat turn failed');
        send({ type: 'error', error: 'Something went wrong answering that. Try again.' });
      }
    } finally {
      res.end();
    }
  });
}
