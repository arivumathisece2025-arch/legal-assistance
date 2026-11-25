import { GroqProvider, MockProvider, type LLMProvider } from "@workspace/core";
import { createLogger } from "../lib/secureLogger";

const secureLogger = createLogger("api-server");

export function groqProvider(model?: string): GroqProvider {
  return new GroqProvider({
    ...(model ? { model } : {}),
    onUpstreamError: (status, upstreamBody) => {
      secureLogger.error("LLM upstream request failed", { status, body: upstreamBody });
    },
  });
}

function configuredSmartProvider(): LLMProvider {
  if (process.env.MOCK_LLM === "1") {
    return new MockProvider();
  }

  const smartModel = process.env.GROQ_MODEL_SMART ?? process.env.GROQ_MODEL_FAST;
  return groqProvider(smartModel);
}

export function answerProvider(): LLMProvider {
  return configuredSmartProvider();
}

export function versionDiffProvider(): LLMProvider {
  return configuredSmartProvider();
}