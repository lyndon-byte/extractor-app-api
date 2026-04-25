import express from "express";
import cors from "cors";
import OpenAI from "openai";
import dotenv from "dotenv";
import multer from "multer";
import crypto from 'crypto';
import fs from "fs"
import { z } from 'zod'
import { generateText, Output } from 'ai'
import { openai } from '@ai-sdk/openai'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { serve } from 'inngest/express'
import { inngest,functions } from "./src/inngest/client.js"
import admin from 'firebase-admin';

dotenv.config();

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
    destination: (_req, _file, cb) => cb(null, "/tmp"),
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

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const app = express();

app.set('trust proxy', 1);

app.use(cors());

app.use(express.json());

app.use(
  "/api/inngest", 
  serve({
    client: inngest,
    functions: functions,
  })
);


const serviceAccount = {

  "type": process.env.FIREBASE_TYPE,
  "project_id": process.env.FIREBASE_PROJECT_ID,
  "private_key_id": process.env.FIREBASE_PRIVATE_KEY_ID,
  "private_key": process.env.FIREBASE_PRIVATE_KEY,
  "client_email": process.env.FIREBASE_CLIENT_EMAIL,
  "client_id": process.env.FIREBASE_CLIENT_ID,
  "auth_uri": process.env.FIREBASE_AUTH_URL,
  "token_uri": process.env.FIREBASE_TOKEN_URL,
  "auth_provider_x509_cert_url": process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
  "client_x509_cert_url": process.env.FIREBASE_CLIENT_CERT_URL,
  "universe_domain": process.env.FIREBASE_UNIVERS_DOMAIN,

};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const PORT = process.env.PORT || 3000;

const directClientOpenai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function auth(req, res, next) {

  const idToken = req.headers.authorization?.split('Bearer ')[1];
  
  if (!idToken) return res.status(401).send('Unauthorized');

  try {
    // Verify the token with Firebase
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken; // Token is valid, attach user data to request
    next();
  } catch (error) {
    res.status(401).send('Invalid token');

  }
}

// audioUpload.single("file"),

app.post("/transcribe", async (req, res) => {

  // if (!req.file) {
  //   return res.status(400).json({
  //     error_code: "NO_FILE",
  //     message: "No audio file provided",
  //   });
  // }

  // const { displayName } = req.body;

  try {

    // const  transcription = await directClientOpenai.audio.transcriptions.create({

    //   file:  fs.createReadStream(req.file.path),
    //   model: "gpt-4o-transcribe",
    //   prompt: `
      
    //       You are an expert email writer. The user will give you a raw, unedited voice note transcription. Your job is to turn it into a clean, professional email.

    //       Rules:
    //       - Preserve the sender's intent, tone, and key details exactly — do not add, remove, or assume information
    //       - Fix filler words, false starts, and rambling into clear, concise prose
    //       - Output only the email (subject line + body). No commentary, no explanation, no preamble.
    //       - Always include subject line on the output.

    //       ## Strictly follow this format:

    //       Subject: <subject>

    //       <body>

    //       Thanks,

    //       <first name of "${displayName}">


    //     `,      

    // }); 

    // const { output } = await generateText({
    
    //     model: openai("gpt-4o"),
    //     system: 'Extract subject and body from email message.',
    //     prompt: transcription.text,
    //     output: Output.object({
    //       schema: z.object({
    //         emailMessage: z.object({
    //           emailSubject: z.string(),
    //           emailBody: z.string()
    //         })
    //       })
    //     })
            
    // });

    // const ext = req.file.originalname.split('.').pop();

    // const uploadCommand = new PutObjectCommand({
    //   Bucket: process.env.R2_BUCKET_NAME,
    //   Key: `uploads/${Date.now()}-${crypto.randomUUID()}.${ext}`, // The name of the file in R2
    //   Body:  fs.createReadStream(req.file.path),
    //   ContentType: req.file.mimetype,
    // });

    // await r2Client.send(uploadCommand);

    await inngest.send({
      name: "app/voice.submitted",
      data: req.body, // your email model data
    });

    return res.json({ 

      //  subject: output.emailMessage.emailSubject,
      //  body: output.emailMessage.emailBody
      message: 'success'
      
    });

  } catch (err) {
    console.error("Transcription error:", err);
    return res.status(500).json({
      error_code: "TRANSCRIPTION_FAILED",
      message: err.message || "Failed to transcribe audio",
    });
  } finally {
    // fs.unlink(req.file.path, () => {});
  }
});


app.get("/test-db-get", async (req, res) => {

  try {

    const { uid } = req.query;
    const results = await getEmailsByUid(uid);

    if (results.length === 0) {
      return res.status(404).json({ message: 'No records found for this UID' });
    }

    res.json(results);

  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch data' });
  }

})

if (process.env.NODE_ENV !== 'production') {
  app.listen(3000, () => console.log('Server running on port 3000'));
}

if (!process.env.INNGEST_SIGNING_KEY) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Local server running on port ${PORT}`));
}

module.exports = app;