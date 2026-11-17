/** Validation of the /v1/generate request. Pure functions, no I/O. */

export const MAX_BODY_BYTES = 600 * 1024;
export const MAX_SYSTEM_INSTRUCTION_CHARS = 8000;
export const MAX_CONTENTS_ITEMS = 200;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_ANY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuidV4 = (s: string | null): s is string => s !== null && UUID_V4.test(s);
export const isUuid = (s: string | null): s is string => s !== null && UUID_ANY.test(s);

const TOP_LEVEL_KEYS = new Set(["systemInstruction", "contents", "tools", "generationConfig"]);
const GENERATION_CONFIG_KEYS = new Set(["temperature", "responseMimeType", "responseSchema"]);

export interface GenerateBody {
  systemInstruction?: string;
  contents: unknown[];
  tools?: unknown[];
  generationConfig?: {
    temperature?: number;
    responseMimeType?: string;
    responseSchema?: Record<string, unknown>;
  };
}

export type Validation = { ok: true; body: GenerateBody } | { ok: false; message: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const fail = (message: string): Validation => ({ ok: false, message });

/**
 * Only the listed keys are accepted. In particular there is no `model` and no
 * `maxOutputTokens`: the client cannot choose the model or the output size.
 */
export function validateGenerateBody(raw: unknown): Validation {
  if (!isPlainObject(raw)) return fail("Body must be a JSON object.");
  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.has(key)) return fail(`Unknown field "${key.slice(0, 40)}".`);
  }

  const body: GenerateBody = { contents: [] };

  const { systemInstruction, contents, tools, generationConfig } = raw;
  if (systemInstruction !== undefined) {
    if (typeof systemInstruction !== "string") return fail('"systemInstruction" must be a string.');
    if (systemInstruction.length > MAX_SYSTEM_INSTRUCTION_CHARS) {
      return fail(`"systemInstruction" is longer than ${MAX_SYSTEM_INSTRUCTION_CHARS} characters.`);
    }
    body.systemInstruction = systemInstruction;
  }

  if (!Array.isArray(contents) || contents.length === 0) {
    return fail('"contents" must be a non-empty array.');
  }
  if (contents.length > MAX_CONTENTS_ITEMS) {
    return fail(`"contents" has more than ${MAX_CONTENTS_ITEMS} items.`);
  }
  if (!contents.every(isPlainObject)) return fail('Every item of "contents" must be an object.');
  body.contents = contents;

  if (tools !== undefined) {
    if (!Array.isArray(tools) || !tools.every(isPlainObject)) {
      return fail('"tools" must be an array of objects.');
    }
    body.tools = tools;
  }

  if (generationConfig !== undefined) {
    if (!isPlainObject(generationConfig)) return fail('"generationConfig" must be an object.');
    for (const key of Object.keys(generationConfig)) {
      if (!GENERATION_CONFIG_KEYS.has(key)) {
        return fail(`Unknown field "generationConfig.${key.slice(0, 40)}".`);
      }
    }
    const out: NonNullable<GenerateBody["generationConfig"]> = {};
    const { temperature, responseMimeType, responseSchema } = generationConfig;
    if (temperature !== undefined) {
      if (typeof temperature !== "number" || !Number.isFinite(temperature)) {
        return fail('"generationConfig.temperature" must be a number.');
      }
      out.temperature = temperature;
    }
    if (responseMimeType !== undefined) {
      if (typeof responseMimeType !== "string" || responseMimeType.length > 100) {
        return fail('"generationConfig.responseMimeType" must be a short string.');
      }
      out.responseMimeType = responseMimeType;
    }
    if (responseSchema !== undefined) {
      if (!isPlainObject(responseSchema)) {
        return fail('"generationConfig.responseSchema" must be an object.');
      }
      out.responseSchema = responseSchema;
    }
    body.generationConfig = out;
  }

  return { ok: true, body };
}
