import { Router, type IRouter } from "express";
import multer from "multer";
import { createLogger } from "../lib/secureLogger";
import { rateLimit } from "../middlewares/rateLimit";
import { appendAuditLog } from "../lib/auditLog";

const secureLogger = createLogger("api-server");

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});
const allowedAudioTypes = new Set(["audio/webm", "audio/wav", "audio/mpeg", "audio/mp4", "audio/ogg"]);

const router: IRouter = Router();

const languageMap: Record<string, string> = {
  en: "en",
  ta: "ta",
  hi: "hi",
};

router.post("/audio/transcribe", rateLimit({ limit: 10, intervalMs: 60_000 }), (req, res, next): void => {
  audioUpload.single("audio")(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ code: "AUDIO_TOO_LARGE", message: "Audio exceeds the 5 MB limit." });
      return;
    }
    if (error) {
      next(error);
      return;
    }
    next();
  });
}, async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "Audio file required" });
    return;
  }
  if (!allowedAudioTypes.has(req.file.mimetype)) {
    res.status(415).json({ code: "UNSUPPORTED_AUDIO_TYPE", message: "Unsupported audio type." });
    return;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({ code: "AUDIO_TRANSCRIPTION_FAILED", message: "Transcription failed." });
    return;
  }

  const language = languageMap[(req.body?.language as string | undefined) ?? "en"] ?? "en";
  const configuredModel = process.env.GROQ_MODEL_AUDIO?.trim();
  const englishOnlyModel = Boolean(configuredModel && /english|(?:^|[-_])en(?:$|[-_])/i.test(configuredModel));
  const model = (language === "ta" || language === "hi") && englishOnlyModel
    ? "whisper-large-v3"
    : configuredModel || "whisper-large-v3";

  const form = new FormData();
  form.append(
    "file",
    new Blob([req.file.buffer as unknown as Uint8Array<ArrayBuffer>], { type: req.file.mimetype }),
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
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      secureLogger.error("Audio transcription provider failed", { status: response.status });
      res.status(500).json({ code: "AUDIO_TRANSCRIPTION_FAILED", message: "Transcription failed." });
      return;
    }

    const payload = (await response.json()) as { text?: string };
    appendAuditLog("AUDIO_TRANSCRIBE", req.session?.userId ?? "unknown", {
      fileSizeBytes: req.file.size,
      mimeType: req.file.mimetype,
      language,
    });
    res.json({ text: payload.text ?? "", language });
  } catch {
    res.status(500).json({ code: "AUDIO_TRANSCRIPTION_FAILED", message: "Transcription failed." });
  }
});

export default router;