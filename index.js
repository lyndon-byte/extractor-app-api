import express from "express";
import cors from "cors";
import OpenAI from "openai";
import dotenv from "dotenv";
import crypto from "crypto";
import multer from "multer";
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });



const ALLOWED_AUDIO_MIMETYPES = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
  "audio/flac",
  "audio/x-m4a",
]);

const audioUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_AUDIO_MIMETYPES.has(file.mimetype)) {
      cb(new Error("Unsupported audio format"), false);
    } else {
      cb(null, true);
    }
  }
});

const app = express();

app.set('trust proxy', 1);

app.use(cors());

app.use(express.json({
  limit: "50mb"
}));



const PORT = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function verifyToken(token) {

  if (!token) {
    throw {
      status: 401,
      error_code: "NO_TOKEN",
      message: "No token provided",
    };
  }

  if (!crypto.timingSafeEqual(Buffer.from(token), Buffer.from(process.env.SHARED_SECRET))) {
    throw {
      status: 403,
      error_code: "INVALID_TOKEN",
      message: "Invalid token",
    };
  }
}



async function auth(req, res, next) {

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error_code: "UNAUTHENTICATED",
      message: "Missing or invalid Authorization header",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    verifyToken(token);
    next();
  } catch (err) {
    return res.status(err.status || 500).json({
      error_code: "AUTH_ERROR",
      message: "Authentication failed",
    });
  }
}



app.post("/transcribe", auth, audioUpload.single("file"), async (req, res) => {

  if (!req.file) {
    return res.status(400).json({
      error_code: "NO_FILE",
      message: "No audio file provided",
    });
  }

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: "gpt-4o-transcribe",
      prompt: `
      
        You are an expert email writer. The user will give you a raw, unedited voice note transcription. Your job is to turn it into a clean, professional email that matches the tone, warmth, structure, and level of formality shown in the style samples below.

        Rules:
        - Preserve the sender's intent, tone, and key details exactly — do not add, remove, or assume information
        - Fix filler words, false starts, and rambling into clear, concise prose
        - Match the writing style of the samples: warm, direct, conversational yet professional
        - Output only the email (subject line + body). No commentary, no explanation, no preamble.

        ## Strictly follow this format:

        Subject: <subject>

        <body>

        ## Style Reference Emails:

          Sample Email #1

          Subject: Intro Regarding Chief of Staff

          Hi there Portia,

          It's wonderful to meet you! I was thrilled to hear that Liz is in the midst of hiring a Chief of Staff—I'm certain that hire will bring a huge amount of life to her day-to-day. I'd love to connect on Tuesday of next week when I'm back in the office. 3:00 PM EST works great for me! I'll keep an eye out for that invite. Looking forward to talking soon!

          Thanks,

          Connor

          Sample Email #2

          Subject: Personalized AI Workshop

          Hey Sarah,

          Apologies for the wait on this — and thank you so much for thinking ofme! This definitely sounds like an intriguing opportunity, and I'd love to hear more about what you're envisioning.

          That said, I want to be upfront: I probably won't be the right person to lead this one. We're expecting a baby girl sometime in the first half of May, so I'll be offline on paternity leave right around the time you're looking at for the in-person session.

          All that said, I would love to hop on a quick call to chat through this with you and see if I can get you pointed in the right direction. Even if the timing doesn't work for me to facilitate, I may be able to help you think through format, content, and who might be a great fit—there are also some additional MM coaches who could be a great fit for this! Would you be open to a quick call early next week to discuss?

          Thanks,

          Connor

          Sample Email #3

          Subject: Quick follow-up and resources

          Hey Larry,

          Really enjoyed getting to connect with you this afternoon. Super excited by what you're building and experimenting with. You gave me some much-needed inspiration to dive back into Claude Cowork and see just how much it can do now. I'll be very curious to hear your thoughts on OpenClaw once you get it up and running!

          On that note, I promised a couple videos from my favorite Openclaw content creators. If you only watch one, make it this: [The only OpenClaw tutorial you’ll ever need (March 2026 edition)](https://youtu.be/CxErCGVo-oo?si=Bl0NMjfX4Rpb7kyF). Here's another video with some valuable use-cases: [5 OpenClaw use cases you need to implement IMMEDIATELY](https://youtu.be/qRA0MyPlEPE?si=w75aXN2B8wrLueos). Finally, here's a deeper dive into the Mission Control: [OpenClaw is 100x better with this tool (Mission Control)](https://youtu.be/RhLpV6QDBFE?si=qsx-t3GKeugF9C65).

          I hope those videos help! And if you hit any snags (which is almost inevitable with Openclaw setup), don't forget to leverage AI! Copy and paste what you're experiencing into ChatGPT and ask for step-by-step guidance under the assumption that you do not have technical experience. It took a lot of back-and-forth (and a moment or three where I wanted throw my computer out the window), but I was finally able to get there with enough experimentation.

          Let me know if there's anything I can do to help!

          Thanks,

          Connor
        `
    });

    return res.json({ text: transcription.text });
  } catch (err) {
    console.error("Transcription error:", err);
    return res.status(500).json({
      error_code: "TRANSCRIPTION_FAILED",
      message: err.message || "Failed to transcribe audio",
    });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

app.listen(PORT, () => {
  console.log(`API + Socket running on port ${PORT}`);
});
