import type { z } from "zod";

export interface LLMProvider {
  readonly modelLabel?: string;
  completeJson<T>(system: string, user: string, schema: z.ZodType<T>): Promise<T>;
  completeText?(
    system: string,
    user: string,
    onToken: (token: string) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<string>;
}
