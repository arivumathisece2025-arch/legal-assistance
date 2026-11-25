import assert from "node:assert/strict";
import test from "node:test";
import { GroqProvider, MockProvider } from "@workspace/core";
import { answerProvider, groqProvider, versionDiffProvider } from "../documents/providers";

test("answer and version-diff providers select the mock when MOCK_LLM=1", () => {
  const originalMock = process.env.MOCK_LLM;
  process.env.MOCK_LLM = "1";

  try {
    assert.ok(answerProvider() instanceof MockProvider);
    assert.ok(versionDiffProvider() instanceof MockProvider);
  } finally {
    if (originalMock === undefined) delete process.env.MOCK_LLM;
    else process.env.MOCK_LLM = originalMock;
  }
});

test("shared Groq providers use the configured smart model", () => {
  const originalMock = process.env.MOCK_LLM;
  const originalSmart = process.env.GROQ_MODEL_SMART;
  const originalFast = process.env.GROQ_MODEL_FAST;
  delete process.env.MOCK_LLM;
  process.env.GROQ_MODEL_SMART = "test-smart-model";
  process.env.GROQ_MODEL_FAST = "test-fast-model";

  try {
    assert.equal((answerProvider() as GroqProvider).modelLabel, "test-smart-model");
    assert.equal((versionDiffProvider() as GroqProvider).modelLabel, "test-smart-model");
    assert.ok(groqProvider() instanceof GroqProvider);
  } finally {
    if (originalMock === undefined) delete process.env.MOCK_LLM;
    else process.env.MOCK_LLM = originalMock;
    if (originalSmart === undefined) delete process.env.GROQ_MODEL_SMART;
    else process.env.GROQ_MODEL_SMART = originalSmart;
    if (originalFast === undefined) delete process.env.GROQ_MODEL_FAST;
    else process.env.GROQ_MODEL_FAST = originalFast;
  }
});