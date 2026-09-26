import { Router, type IRouter } from "express";
import multer from "multer";

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const router: IRouter = Router();

const languageMap: Record<string, string> = {
  en: "en",
  ta: "ta",
  hi: "hi",
};

router.post("/audio/transcribe", audioUpload.single("audio"), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "Audio file required" });
    return;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GROQ_API_KEY is not configured" });
    return;
  }

  const model = process.env.GROQ_MODEL_AUDIO ?? "whisper-large-v3";
  const language = languageMap[(req.body?.language as string | undefined) ?? "en"] ?? "en";

  const form = new FormData();
  form.append(
    "file",
    new Blob([Uint8Array.from(req.file.buffer)], { type: req.file.mimetype || "audio/webm" }),
    req.file.originalname || "audio.webm",
  );
  form.append("model", model);
  form.append("language", language);

  try {
    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });

    if (!response.ok) {
      const message = await response.text();
      res.status(response.status).json({ error: `Groq transcription failed: ${message}` });
      return;
    }

    const payload = (await response.json()) as { text?: string };
    res.json({ text: payload.text ?? "", language });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Transcription failed" });
  }
});

export default router;