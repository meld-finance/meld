/**
 * Reads a server-sent event stream's `data:` payloads as JSON. Comment lines (keep-alives
 * such as `: OPENROUTER PROCESSING`) and the `[DONE]` sentinel are skipped.
 */
export async function* readEvents<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const decoder = new TextDecoder();
  let buffer = '';
  const parse = function* (block: string) {
    const data = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (data && data !== '[DONE]') yield JSON.parse(data) as T;
  };
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true }).replace(/\r\n/g, '\n');
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) yield* parse(block);
  }
  buffer += decoder.decode();
  if (buffer.trim()) yield* parse(buffer);
}
