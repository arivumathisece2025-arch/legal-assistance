function hashStringFNV1a(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash *= 0x100000001b3n;
  }
  return hash.toString(16).padStart(16, "0");
}

function nodeHash(payload: string): string | undefined {
  if (typeof process === "undefined" || !process.versions?.node) {
    return undefined;
  }

  try {
    const builtinCrypto = typeof process.getBuiltinModule === "function" ? process.getBuiltinModule("node:crypto") : undefined;
    const createHash =
      typeof builtinCrypto?.createHash === "function"
        ? builtinCrypto.createHash.bind(builtinCrypto)
        : Function("return require('node:crypto').createHash")() as
            | ((algorithm: string) => {
                update: (value: string, encoding?: string) => { digest: (encoding?: string) => string };
              })
            | undefined;

    if (typeof createHash !== "function") return undefined;
    return createHash("sha256").update(payload, "utf8").digest("hex");
  } catch {
    return undefined;
  }
}

export const DEFAULT_LLM_MODEL = "default";
export const CLASSIFICATION_PROMPT_VERSION = "classification.v1";

const cache = new Map<string, unknown>();

export function hashCacheKey(normalizedInput: string, model: string, promptVersion: string): string {
  const payload = `${normalizedInput}|${model}|${promptVersion}`;
  return nodeHash(payload) ?? hashStringFNV1a(payload);
}

export function getCacheValue<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}

export function setCacheValue<T>(key: string, value: T): T {
  cache.set(key, value);
  return value;
}

export function clearCache(): void {
  cache.clear();
}
