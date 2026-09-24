/**
 * server/api/explain.ts
 * ---------------------------------------------------------------------------
 * Serverless proxy ที่ยืนคั่นระหว่าง client กับผู้ให้บริการ LLM (Anthropic
 * หรือ OpenAI) — หน้าที่หลัก: ซ่อน API key, กันสแปมแบบง่ายๆ, ส่งผลลัพธ์กลับ
 * ทั้งแบบ stream และ JSON ก้อนเดียว, และส่งสัญญาณ fallback ที่ชัดเจนเมื่อ
 * ปลายทางล่ม
 *
 * ⚠️ หมายเหตุสำคัญเรื่องขอบเขต (อ่านก่อนต่อกับ client จริง):
 *
 * 1. ไฟล์นี้ "ไม่ประกอบ prompt เอง" — รับ `prompt` ที่ประกอบเสร็จแล้วจาก
 *    client (จาก PromptBuilder.ts ของโปรเจกต์หลัก ซึ่งบังคับ LLM ให้ตอบเป็น
 *    JSON ตาม ExplanationResponse contract ผ่าน system prompt อยู่แล้ว) แล้ว
 *    proxy นี้แค่ส่งต่อ ไม่ validate/parse โครงสร้าง 5 ส่วนนั้นเลย เพราะไม่มี
 *    เนื้อไฟล์จริงของ PromptBuilder.ts ให้เห็นในเซสชันนี้ การไปเดา field
 *    name ของ contract นั้นแล้ว hardcode ไว้ในนี้เสี่ยงพังตอนประกอบรวม —
 *    ฝั่ง client ต้องเป็นคน `JSON.parse(response.text)` เองแล้ว validate ตาม
 *    contract ของตัวเอง
 * 2. `ExplainResponseBody` (ทั้ง success/error) เป็น contract ที่ไฟล์นี้
 *    นิยามขึ้นเอง — ไม่ได้อ้างอิงจาก field name ใดๆ ที่มีอยู่แล้วในโปรเจกต์
 *    หลัก เพราะไม่เห็นเนื้อไฟล์จริง ถ้าฝั่ง client (เช่น useEngine.ts หรือ
 *    ตัวเรียก PromptBuilder) คาดหวัง shape อื่น ต้องปรับให้ตรงกับที่นี่ หรือ
 *    บอก shape จริงมาแล้วจะแก้ให้ตรงกัน
 * 3. Rate limiter เป็นแบบ **in-memory ต่อ isolate เท่านั้น** (Map ธรรมดา) —
 *    Cloudflare Workers/Vercel Edge อาจรันหลาย isolate พร้อมกันคนละเครื่อง
 *    คนละภูมิภาค ดังนั้นนี่ไม่ใช่ global rate limit ที่แม่นยำ 100% เป็นแค่
 *    เกราะป้องกันสแปมเบื้องต้นชั้นแรก ถ้าต้องการกันสแปมจริงจังระดับโปรดักชัน
 *    ต้องใช้ store ภายนอกที่แชร์กันได้ (Cloudflare KV/Durable Objects, Redis/
 *    Upstash เป็นต้น) แทน Map นี้
 * 4. Streaming ส่งต่อ SSE ดิบๆ จากผู้ให้บริการตรงๆ ไม่ได้แปลงให้เป็นรูปแบบ
 *    กลางระหว่าง Anthropic กับ OpenAI (ทั้งสองใช้ event shape ต่างกันเล็กน้อย)
 *    — client ต้องรู้ provider ที่ตั้งค่าไว้แล้ว parse ให้ตรงกับของตัวเอง
 * 5. ไม่มีการใช้ `any` ที่ไหนเลยในไฟล์นี้ (ตามข้อกำหนด TypeScript strict ของ
 *    โปรเจกต์) รวมถึง Node.js adapter ก็จงใจไม่พึ่ง `Buffer`/`@types/node`
 *    เพื่อไม่บังคับให้โปรเจกต์ที่โฟกัส edge runtime ต้องติดตั้ง Node types
 * ---------------------------------------------------------------------------
 */

// ============================================================================
// Public contract
// ============================================================================

export interface ExplainRequestBody {
  /** prompt ที่ประกอบเสร็จแล้วจาก PromptBuilder.ts ฝั่ง client — proxy นี้ส่งต่อดิบๆ ไม่แก้ไข */
  readonly prompt: string;
  /** ตัวระบุฝั่ง client สำหรับแยก rate limit ราย session/ผู้ใช้ — ถ้าไม่ส่งมาจะ fallback ไปใช้ IP แทน */
  readonly clientId?: string;
  /** true = ขอ SSE stream กลับ, false/ไม่ส่งมา = รอผลเต็มแล้วคืน JSON ก้อนเดียว (default false) */
  readonly stream?: boolean;
}

export interface ExplainSuccessResponse {
  readonly ok: true;
  /** ข้อความดิบจาก LLM — ควรเป็น JSON string ตาม ExplanationResponse contract ของฝั่ง client เพราะ prompt บังคับไว้แล้ว (ดูหมายเหตุข้อ 1 บนสุดของไฟล์) proxy นี้ไม่ validate shape นั้นเอง */
  readonly text: string;
  readonly provider: LlmProvider;
  readonly model: string;
}

export type ExplainErrorCode = 'invalid_request' | 'rate_limited' | 'upstream_error' | 'upstream_unavailable';

export interface ExplainErrorResponse {
  readonly ok: false;
  readonly code: ExplainErrorCode;
  readonly message: string;
  /** true = สัญญาณให้ client สลับไปใช้ lessonTemplates.ts (fallback ภาษาไทย rule-based) แทนการรอ LLM */
  readonly fallback: boolean;
  /** ใส่มาเฉพาะตอน code === 'rate_limited' */
  readonly retryAfterMs?: number;
}

export type ExplainResponseBody = ExplainSuccessResponse | ExplainErrorResponse;

export type LlmProvider = 'anthropic' | 'openai';

export interface ExplainEnvConfig {
  readonly apiKey: string;
  readonly provider: LlmProvider;
  readonly model: string;
  readonly rateLimitMaxRequests: number;
  readonly rateLimitWindowMs: number;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 10;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const MAX_TOKENS = 1024;

// ============================================================================
// Rate limiting — ดูหมายเหตุข้อ 3 บนสุดของไฟล์เรื่องข้อจำกัด
// ============================================================================

interface RateLimitBucket {
  count: number;
  windowStartMs: number;
}

const rateLimitBuckets = new Map<string, RateLimitBucket>();
const RATE_LIMIT_CLEANUP_THRESHOLD = 5000;

function cleanupExpiredBuckets(windowMs: number): void {
  if (rateLimitBuckets.size < RATE_LIMIT_CLEANUP_THRESHOLD) return;
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets) {
    if (now - bucket.windowStartMs >= windowMs) rateLimitBuckets.delete(key);
  }
}

function checkRateLimit(clientKey: string, maxRequests: number, windowMs: number): { readonly allowed: boolean; readonly retryAfterMs: number } {
  cleanupExpiredBuckets(windowMs);

  const now = Date.now();
  const bucket = rateLimitBuckets.get(clientKey);

  if (!bucket || now - bucket.windowStartMs >= windowMs) {
    rateLimitBuckets.set(clientKey, { count: 1, windowStartMs: now });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (bucket.count < maxRequests) {
    bucket.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  return { allowed: false, retryAfterMs: windowMs - (now - bucket.windowStartMs) };
}

// ============================================================================
// Provider adapters
// ============================================================================

interface ProviderRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

function buildAnthropicRequest(env: ExplainEnvConfig, prompt: string, stream: boolean): ProviderRequest {
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.model,
      max_tokens: MAX_TOKENS,
      stream,
      messages: [{ role: 'user', content: prompt }],
    }),
  };
}

function buildOpenAiRequest(env: ExplainEnvConfig, prompt: string, stream: boolean): ProviderRequest {
  return {
    url: 'https://api.openai.com/v1/chat/completions',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.apiKey}`,
    },
    body: JSON.stringify({
      model: env.model,
      max_tokens: MAX_TOKENS,
      stream,
      messages: [{ role: 'user', content: prompt }],
    }),
  };
}

function buildProviderRequest(env: ExplainEnvConfig, prompt: string, stream: boolean): ProviderRequest {
  return env.provider === 'openai' ? buildOpenAiRequest(env, prompt, stream) : buildAnthropicRequest(env, prompt, stream);
}

interface AnthropicMessageResponse {
  readonly content?: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
}

async function extractAnthropicText(response: Response): Promise<string> {
  const data = (await response.json()) as AnthropicMessageResponse;
  const textBlock = data.content?.find((block) => block.type === 'text');
  if (!textBlock?.text) throw new Error('Anthropic response did not contain a text block');
  return textBlock.text;
}

interface OpenAiChatResponse {
  readonly choices?: ReadonlyArray<{ readonly message?: { readonly content?: string } }>;
}

async function extractOpenAiText(response: Response): Promise<string> {
  const data = (await response.json()) as OpenAiChatResponse;
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI response did not contain message content');
  return text;
}

async function extractProviderText(env: ExplainEnvConfig, response: Response): Promise<string> {
  return env.provider === 'openai' ? extractOpenAiText(response) : extractAnthropicText(response);
}

// ============================================================================
// Response helpers
// ============================================================================

function jsonResponse(body: ExplainResponseBody, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

function getClientIp(request: Request): string | null {
  return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '(ไม่สามารถอ่านเนื้อหา error จาก upstream ได้)';
  }
}

// ============================================================================
// Core handler — ใช้ Web-standard Request/Response ล้วนๆ เพื่อให้พอร์ตข้าม runtime ได้
// ============================================================================

export async function handleExplainRequest(request: Request, env: ExplainEnvConfig): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, code: 'invalid_request', message: 'ใช้ได้เฉพาะ POST เท่านั้น', fallback: false }, 405);
  }

  let body: ExplainRequestBody;
  try {
    body = (await request.json()) as ExplainRequestBody;
  } catch {
    return jsonResponse({ ok: false, code: 'invalid_request', message: 'JSON body ไม่ถูกต้อง', fallback: false }, 400);
  }

  if (!body.prompt || typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
    return jsonResponse({ ok: false, code: 'invalid_request', message: 'ต้องระบุ "prompt" เป็น string ที่ไม่ว่างเปล่า', fallback: false }, 400);
  }

  const clientKey = body.clientId?.trim() || getClientIp(request) || 'unknown';
  const rateLimit = checkRateLimit(clientKey, env.rateLimitMaxRequests, env.rateLimitWindowMs);
  if (!rateLimit.allowed) {
    return jsonResponse(
      {
        ok: false,
        code: 'rate_limited',
        message: 'ส่งคำขอถี่เกินไป กรุณาลองใหม่อีกครั้งในอีกสักครู่',
        fallback: true,
        retryAfterMs: rateLimit.retryAfterMs,
      },
      429,
      { 'retry-after': Math.ceil(rateLimit.retryAfterMs / 1000).toString() },
    );
  }

  const wantsStream = body.stream === true;
  const providerRequest = buildProviderRequest(env, body.prompt, wantsStream);

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(providerRequest.url, {
      method: 'POST',
      headers: providerRequest.headers,
      body: providerRequest.body,
    });
  } catch (err) {
    return jsonResponse(
      {
        ok: false,
        code: 'upstream_unavailable',
        message: `เชื่อมต่อผู้ให้บริการ LLM ไม่ได้: ${err instanceof Error ? err.message : String(err)}`,
        fallback: true,
      },
      503,
    );
  }

  if (!upstreamResponse.ok) {
    const errorText = await safeReadText(upstreamResponse);
    return jsonResponse(
      {
        ok: false,
        code: 'upstream_error',
        message: `ผู้ให้บริการ LLM ตอบกลับด้วยสถานะ ${upstreamResponse.status}: ${errorText}`,
        fallback: true,
      },
      502,
    );
  }

  if (wantsStream) {
    if (!upstreamResponse.body) {
      return jsonResponse(
        { ok: false, code: 'upstream_error', message: 'ผู้ให้บริการ LLM ไม่ส่ง stream body กลับมาทั้งที่ขอ stream', fallback: true },
        502,
      );
    }
    // ส่งต่อ SSE stream ดิบๆ ตรงๆ — ดูหมายเหตุข้อ 4 บนสุดของไฟล์
    return new Response(upstreamResponse.body, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    });
  }

  try {
    const text = await extractProviderText(env, upstreamResponse);
    return jsonResponse({ ok: true, text, provider: env.provider, model: env.model }, 200);
  } catch (err) {
    return jsonResponse(
      {
        ok: false,
        code: 'upstream_error',
        message: `แปลผลลัพธ์จาก LLM ไม่ได้: ${err instanceof Error ? err.message : String(err)}`,
        fallback: true,
      },
      502,
    );
  }
}

// ============================================================================
// Env resolution — ใช้ร่วมกันทุก platform adapter
// ============================================================================

interface RawEnvInput {
  readonly apiKey: string | undefined;
  readonly provider: string | undefined;
  readonly model: string | undefined;
  readonly rateLimitMax: string | undefined;
  readonly rateLimitWindowMs: string | undefined;
}

function resolveEnvConfig(raw: RawEnvInput): ExplainEnvConfig {
  if (!raw.apiKey) {
    throw new Error('ไม่พบ API key ของ LLM ใน environment configuration (LLM_API_KEY)');
  }
  const provider: LlmProvider = raw.provider === 'openai' ? 'openai' : 'anthropic';
  return {
    apiKey: raw.apiKey,
    provider,
    model: raw.model ?? (provider === 'openai' ? DEFAULT_OPENAI_MODEL : DEFAULT_ANTHROPIC_MODEL),
    rateLimitMaxRequests: raw.rateLimitMax ? Number.parseInt(raw.rateLimitMax, 10) : DEFAULT_RATE_LIMIT_MAX_REQUESTS,
    rateLimitWindowMs: raw.rateLimitWindowMs ? Number.parseInt(raw.rateLimitWindowMs, 10) : DEFAULT_RATE_LIMIT_WINDOW_MS,
  };
}

/** อ่าน env var แบบไม่ต้องพึ่ง type ของ `process` จาก @types/node — ใช้ได้ทั้งใน Node จริงและ runtime อื่นที่ดันมี process แปะไว้บน globalThis */
function readGlobalEnvVar(name: string): string | undefined {
  const proc = (globalThis as { readonly process?: { readonly env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

// ============================================================================
// Platform adapter: Cloudflare Workers
// ============================================================================

export interface CloudflareWorkerEnv {
  readonly LLM_API_KEY: string;
  readonly LLM_PROVIDER?: string;
  readonly LLM_MODEL?: string;
  readonly RATE_LIMIT_MAX?: string;
  readonly RATE_LIMIT_WINDOW_MS?: string;
}

/** ประเภทของ ExecutionContext แบบย่อ (เฉพาะส่วนที่ต้องใช้จริง) — ไม่ import จาก '@cloudflare/workers-types' เพื่อไม่บังคับให้ต้องติดตั้งแพ็กเกจนั้นถ้ายังไม่ได้ตัดสินใจ deploy บน Cloudflare */
export interface MinimalExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export default {
  async fetch(request: Request, env: CloudflareWorkerEnv, _ctx: MinimalExecutionContext): Promise<Response> {
    let config: ExplainEnvConfig;
    try {
      config = resolveEnvConfig({
        apiKey: env.LLM_API_KEY,
        provider: env.LLM_PROVIDER,
        model: env.LLM_MODEL,
        rateLimitMax: env.RATE_LIMIT_MAX,
        rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
      });
    } catch (err) {
      return jsonResponse({ ok: false, code: 'invalid_request', message: err instanceof Error ? err.message : String(err), fallback: false }, 500);
    }
    return handleExplainRequest(request, config);
  },
};

// ============================================================================
// Platform adapter: Vercel Edge Function
// ============================================================================

export const config = { runtime: 'edge' } as const;

export async function vercelEdgeHandler(request: Request): Promise<Response> {
  let envConfig: ExplainEnvConfig;
  try {
    envConfig = resolveEnvConfig({
      apiKey: readGlobalEnvVar('LLM_API_KEY'),
      provider: readGlobalEnvVar('LLM_PROVIDER'),
      model: readGlobalEnvVar('LLM_MODEL'),
      rateLimitMax: readGlobalEnvVar('RATE_LIMIT_MAX'),
      rateLimitWindowMs: readGlobalEnvVar('RATE_LIMIT_WINDOW_MS'),
    });
  } catch (err) {
    return jsonResponse({ ok: false, code: 'invalid_request', message: err instanceof Error ? err.message : String(err), fallback: false }, 500);
  }
  return handleExplainRequest(request, envConfig);
}

export { vercelEdgeHandler as vercelDefaultExport };

// ============================================================================
// Platform adapter: plain Node.js (Express custom route, raw http.createServer,
// หรือ Vercel Node Function ที่ไม่ได้ตั้ง runtime เป็น 'edge')
// ============================================================================

/** duck type ของ req แบบขั้นต่ำที่สุดที่พอจะอ่าน body/headers ได้ — ทั้ง raw http.IncomingMessage และ Express req เข้ากับ interface นี้ได้พอดีโดยไม่ต้อง import จาก 'node:http' */
export interface NodeCompatibleRequest {
  readonly method?: string;
  readonly headers: Record<string, string | string[] | undefined>;
  on(event: 'data', listener: (chunk: Uint8Array) => void): void;
  on(event: 'end', listener: () => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
}

/** เช่นเดียวกัน — ทั้ง raw http.ServerResponse และ Express res เข้ากับ interface นี้ได้พอดี */
export interface NodeCompatibleResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  write(chunk: string): void;
  end(chunk?: string): void;
}

function concatUint8Arrays(chunks: readonly Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function readNodeRequestBody(req: NodeCompatibleRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(new TextDecoder().decode(concatUint8Arrays(chunks))));
    req.on('error', (err) => reject(err));
  });
}

function toWebHeaders(headers: Record<string, string | string[] | undefined>): Headers {
  const webHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) webHeaders.append(key, v);
    } else {
      webHeaders.set(key, value);
    }
  }
  return webHeaders;
}

function writeNodeJsonResponse(res: NodeCompatibleResponse, status: number, body: ExplainResponseBody): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

export async function handleExplainRequestNode(req: NodeCompatibleRequest, res: NodeCompatibleResponse): Promise<void> {
  let envConfig: ExplainEnvConfig;
  try {
    envConfig = resolveEnvConfig({
      apiKey: readGlobalEnvVar('LLM_API_KEY'),
      provider: readGlobalEnvVar('LLM_PROVIDER'),
      model: readGlobalEnvVar('LLM_MODEL'),
      rateLimitMax: readGlobalEnvVar('RATE_LIMIT_MAX'),
      rateLimitWindowMs: readGlobalEnvVar('RATE_LIMIT_WINDOW_MS'),
    });
  } catch (err) {
    writeNodeJsonResponse(res, 500, {
      ok: false,
      code: 'invalid_request',
      message: err instanceof Error ? err.message : String(err),
      fallback: false,
    });
    return;
  }

  const bodyText = await readNodeRequestBody(req);
  const webRequest = new Request('https://internal.local/api/explain', {
    method: req.method ?? 'POST',
    headers: toWebHeaders(req.headers),
    body: bodyText,
  });

  const webResponse = await handleExplainRequest(webRequest, envConfig);

  res.statusCode = webResponse.status;
  webResponse.headers.forEach((value, key) => res.setHeader(key, value));

  if (!webResponse.body) {
    res.end();
    return;
  }

  const reader = webResponse.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(decoder.decode(value, { stream: true }));
  }
  res.end();
}
