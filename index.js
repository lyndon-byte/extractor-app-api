import express from "express";
import cors from "cors";
import OpenAI from "openai";
import dotenv from "dotenv";
import multer from "multer";
import Pusher from 'pusher'
import fs from "fs"
import { z } from 'zod'
import { 
  convertToModelMessages, 
  streamText, 
  Output, 
} from 'ai'
import { openai } from '@ai-sdk/openai'
import { saveChat,getChatsByUserId, getMessagesByChatId } from "./src/chat-store.js";
import admin from 'firebase-admin';
import { createSubscription, updateSubscription } from "./src/subcription-store.js";
import { logger } from "./src/logger.js";
import verifyWebhookSignature from "./src/middleware/verify-webhook.js";

dotenv.config();

const MIN_MESSAGES_REQUIRED = 1;
const MAX_MESSAGES_ALLOWED = 25;

const generateEmailRequestSchema = z.object({
  messages: z.array(z.any()).min(MIN_MESSAGES_REQUIRED, {
    message: `messages must contain at least ${MIN_MESSAGES_REQUIRED} item(s)`,
  }).refine((messages) => messages.length < MAX_MESSAGES_ALLOWED, {
    message: "This session has reached the maximum number of messages. Create a new session to continue with a fresh email draft."          
  }),
  chatId: z.string().optional(),
});

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


const app = express();

app.set('trust proxy', 1);

app.use(cors());

app.use(express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
}));
app.use(express.urlencoded({ extended: true }));

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

const pusher = new Pusher({

  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true

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




app.post("/api/transcribe", auth, audioUpload.single("file"), async (req, res) => {
  

  if (!req.file) {
    return res.status(400).json({
      error_code: "NO_FILE",
      message: "No audio file provided",
    });
  }


  try {

    const transcription = await directClientOpenai.audio.transcriptions.create({

      file:  fs.createReadStream(req.file.path),
      model: "gpt-4o-transcribe"
        
    }); 

    return res.json({ transcription: transcription.text });


  } catch (err) {

    console.error("Transcription error:", err);
    return res.status(500).json({
      error_code: "TRANSCRIPTION_FAILED",
      message: err.message || "Failed to transcribe audio",
    });

  } 
});


app.post("/api/generate-email", auth, async (req, res) => {

    let messages;
    let chatId;

    try {
      const parsed = generateEmailRequestSchema.parse(req.body);
      messages = parsed.messages;
      chatId = parsed.chatId;

    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        return res.status(400).send(validationError.errors.map((err) => err.message).join('; '));
      }
      throw validationError;
    }

    const displayName = req.user.name;
    const uid = req.user.uid

    const output = streamText({

        model:  openai("gpt-5-mini"),
        system: `

            You are an expert email writer. The user will give you a raw, unedited voice note transcription. Your job is to turn it into a clean, professional email.

            Rules:
            - Preserve the sender's intent, tone, and key details exactly — do not add, remove, or assume information
            - Fix filler words, false starts, and rambling into clear, concise prose
            - Generate BOTH:
              - emailSubject → subject line only
              - emailBody → body content only
            - NEVER include the subject line inside emailBody
            - NEVER include "Subject:" inside emailBody
            - Output must strictly match the schema fields
            - Do not include commentary, explanations, markdown, or extra formatting

            emailBody format:
            <body>

            Thanks,
            <first name of ${displayName}>

        `,   
        messages: await convertToModelMessages(messages),
        output: Output.object({
          schema: z.object({
            emailMessage: z.object({
              emailSubject: z.string(),
              emailBody: z.string()
            })
          })
        })
    });

    return output.pipeUIMessageStreamToResponse(res,{
      originalMessages: messages,
      onFinish: async ({ messages }) => {

          await saveChat({
            userId: uid,
            chatId,
            messages: messages, 
          });
      }
    });

  
})

app.get("/api/chats", auth, async (req, res) => {
  
  const page = parseInt(req.query.page) || 1;
  const limit = 10;

  const userChats = await getChatsByUserId({ 
    userId: req.user.uid, 
    page, 
    limit 
  });
  
  res.json(userChats);

});

app.get("/api/messages", auth, async (req, res) => {
  
  const chatId = req.query.chatId || '';
  
  const chatMessages = await getMessagesByChatId({ 
    chatId, 
    userId: req.user.uid,
  });
  
  res.json(chatMessages);
  
});


async function modifySubscription({subscriptionId,status}){

      try {

        const result = await updateSubscription(subscriptionId,status);

          if (!result.success) {
            logger.error('Update subscription failed', {
              id,
              updateData,
              error: result.error,
            });

            if (result.error === 'Subscription not found') {
              return res.status(404).json(result);
            }

            return res.status(500).json(result);
          }

          logger.info('Subscription updated successfully', {
            id,
            updatedRecord: result.data,
          });

          return res.json(result);

      } catch (err) {

          logger.error('Unexpected error during subscription update', {
            id,
            updateData,
            err,
          });

          return res.status(500).json({
            success: false,
            error: 'Unexpected server error',
          });
          
      }
  
}

app.post('/subscription/webhook', verifyWebhookSignature, async (req, res) => {

    const subscriptionEvent = req.body;

    const eventName = subscriptionEvent.meta.event_name;
    const subscriptionId = subscriptionEvent.data.attributes.subscription_id;

    switch (eventName) {

      case "subscription_payment_success":

        if(subscriptionEvent.data.attributes.billing_reason === 'initial'){

            const userId = subscriptionEvent.meta.custom_data.user_id;
            const name = subscriptionEvent.data.attributes.user_name;
            const email = subscriptionEvent.data.attributes.user_email;

            try {

              const result = await createSubscription({userId,subscriptionId,name,email})

              if (!result.success) {

                logger.error('Create subscription failed', {
                  input: req.body,
                  error: result.error,
                });

                return res.status(500).json(result);

              }

              logger.info('Subscription created successfully', {
                subscription: result.data,
              });



              await pusher.trigger(
                `private-user-${userId}`,
                'subscription-payment',
                {
                  message: 'subscription payment successful',
                  userId,
                  subscriptionId
                }
              );

              return res.status(200).json(result);


          } catch (err) {

            logger.error('Unexpected error during subscription creation', {
              input: req.body,
              err,
            });

            return res.status(500).json({
              success: false,
              error: 'Unexpected server error',
            });

          }

      }


      case "subscription_cancelled":

          await modifySubscription(subscriptionId,'cancelled');

      case "subscription_expired":

          await modifySubscription(subscriptionId,'expired');

      case "subscription_payment_failed":

          await modifySubscription(subscriptionId,'expired');
      
      case "subscription_cancelled":

          await modifySubscription(subscriptionId,'cancelled');
       
      default:
        console.log("Unknown subscription event."); 
    }

    
    res.sendStatus(200);

});

app.post('/pusher/auth', (req, res) => {

  const socketId = req.body.socket_id;
  const channel = req.body.channel_name;

  if (!socketId || !channel) {

    logger.error('Missing socket_id or channel_name');

    return res.status(400).json({
      error: 'Missing socket_id or channel_name',
    });

  }

  const auth = pusher.authorizeChannel(socketId, channel);

  res.send(auth);

});

app.listen(PORT, () => {

  console.log(`API + Socket running on port ${PORT}`);

});
