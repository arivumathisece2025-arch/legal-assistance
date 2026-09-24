import type { z } from "zod";

export interface LLMProvider {
  completeJson<T>(system: string, user: string, schema: z.ZodType<T>): Promise<T>;
}
