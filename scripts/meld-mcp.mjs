#!/usr/bin/env node
// Thin stdio-to-Streamable-HTTP bridge for MCP clients that only speak stdio.
//
// Usage:
//   MELD_MCP_TOKEN="meld_mcp_..." MELD_URL="http://127.0.0.1:47800/api/mcp" node scripts/meld-mcp.mjs
import { createInterface } from 'node:readline';

const url = process.env.MELD_URL || 'http://127.0.0.1:47800/api/mcp';
const token = process.env.MELD_MCP_TOKEN || '';

if (!token) {
  console.error('meld-mcp: MELD_MCP_TOKEN is required');
  process.exit(1);
}

function writeOut(line) {
  process.stdout.write(`${line}\n`);
}

function writeJsonRpcError(id, code, message) {
  if (id === undefined || id === null) return;
  writeOut(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
}

async function handleLine(raw) {
  const line = raw.trim();
  if (!line) return;

  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    writeOut(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
    return;
  }

  const id = parsed && typeof parsed === 'object' ? parsed.id : undefined;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: line,
    });
  } catch (err) {
    console.error(`meld-mcp: connection failed (${url}): ${err instanceof Error ? err.message : err}`);
    writeJsonRpcError(id, -32000, `Cannot reach Meld MCP at ${url}`);
    return;
  }

  if (res.status === 202 || res.status === 204) {
    await res.body?.cancel();
    return;
  }

  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`meld-mcp: HTTP ${res.status}: ${body}`);
    writeJsonRpcError(id, -32000, `Meld MCP returned HTTP ${res.status}`);
    return;
  }

  if (contentType.includes('text/event-stream') && res.body) {
    const decoder = new TextDecoder();
    let buffer = '';
    const flushBlock = (block) => {
      const data = block
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n')
        .trim();
      if (data) writeOut(data);
    };
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) flushBlock(block);
    }
    buffer += decoder.decode();
    if (buffer.trim()) flushBlock(buffer);
    return;
  }

  const text = (await res.text()).trim();
  if (text) writeOut(text);
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
const pending = new Set();
let closed = false;

rl.on('line', (line) => {
  const p = handleLine(line).finally(() => {
    pending.delete(p);
    if (closed && pending.size === 0) process.exit(0);
  });
  pending.add(p);
});

rl.on('close', () => {
  closed = true;
  if (pending.size === 0) process.exit(0);
});
