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
import { cancelSubscription, checkSubscription, createCheckoutLink, createSubscription, getSubscriptionOnAPI, updateSubscription, canSendMessage,incrementMessageCount } from "./src/subcription.js";
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

    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;

    next()

  } catch (error) {

    res.status(401).send('Invalid token');

  }
}

async function checkSubscriptionMiddleware(req, res, next){

  try {

    const result = await checkSubscription({userId: req.user.uid});

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error_code: 'SUBSCRIPTION_CHECK_FAILED',
        message: 'Unable to verify subscription status. Please try again.',
      });
    }

    if (result.data) {

      if (result.data.status !== 'active') {
        return res.status(403).json({
          success: false,
          error_code: 'SUBSCRIPTION_INACTIVE',
          message: `Your subscription is ${result.data.status}. Please renew your plan to continue.`,
        });
      }

      return next();

    }

    const isAllowed = await canSendMessage({ userId: req.user.uid });

    console.log(isAllowed)

    if (!isAllowed) {
      return res.status(403).json({
        success: false,
        error_code: 'FREE_TIER_LIMIT_REACHED',
        message: 'You have reached the 9 email limit for this month. Upgrade to a plan to continue.',
      });
    }

    return next();

  } catch (err) {

    logger.error('Unexpected error in checkSubscriptionMiddleware', { uid: req.user.uid, err });

    return res.status(500).json({
      success: false,
      error_code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred. Please try again.',
    });

  }

}


app.post("/api/transcribe", auth, checkSubscriptionMiddleware, audioUpload.single("file"), async (req, res) => {
  

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

    await incrementMessageCount({userId: uid});

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

        const result = await updateSubscription({subscriptionId,status});

          if (!result.success) {

            logger.error('Update subscription failed', {
              subscriptionId,
              error: result.error,
            });

          }

          logger.info('Subscription updated successfully', {
            subscriptionId,
            updatedRecord: result.data,
          });

      } catch (err) {

          logger.error('Unexpected error during subscription update', {
            subscriptionId,
            err
          });
          
      }
  
}

async function addSubscription({userId,subscriptionId,name,email}){


     try {

          const result = await createSubscription({userId,subscriptionId,name,email})

          if (!result.success) {

              logger.error('Create subscription failed', {
                error: result.error,
              });

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

      } catch (err) {

          logger.error('Unexpected error during subscription creation', {
            err,
          });

      }

}


app.post('/subscription/webhook', verifyWebhookSignature, async (req, res) => {

    const subscriptionEvent = req.body;

    const eventName = subscriptionEvent.meta.event_name;
    // Invoice events (payment_success, payment_failed) carry subscription_id in attributes.
    // Subscription events (cancelled, expired) are the subscription itself — ID is data.id.
    const subscriptionId = subscriptionEvent.data.attributes.subscription_id ?? subscriptionEvent.data.id;

    switch (eventName) {

      case "subscription_payment_success":

        if(subscriptionEvent.data.attributes.billing_reason === 'initial'){

            const userId = subscriptionEvent.meta.custom_data.user_id;
            const name = subscriptionEvent.data.attributes.user_name;
            const email = subscriptionEvent.data.attributes.user_email;

            await addSubscription({userId,subscriptionId,name,email})
        }

        break;

      case "subscription_cancelled":

          await modifySubscription({ subscriptionId, status: 'cancelled' });
          break;

      case "subscription_expired":

          await modifySubscription({subscriptionId, status: 'expired'});
          break;

      case "subscription_payment_failed":

          await modifySubscription({subscriptionId, status: 'expired'});
          break;
      
      default:
        break; 
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


app.post('/api/create-checkout-link', auth, async (req, res) => {

    const { email, name } = req.body;

    const uid = req.user.uid;

    try {

      const result = await createCheckoutLink({email,name,uid});

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: result.error,
        });
      }

      return res.json({
        success: true,
        url:
          result.data.data.attributes.url,
      });

    } catch (error) {
      logger.error(
        '[API] Unexpected error',
        error
      );

      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);


app.get('/api/get-subscription-on-api', auth, async (req, res) => {

    const { subId } = req.query;

    try {

      const result = await getSubscriptionOnAPI({subId});

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: result.error,
        });
      }

      const attributes = result.data.data.attributes;

      return res.json({
        success: true,
        data: {
          sub_id: result.data.data.id,
          product_name: attributes.product_name,
          card_brand: attributes.card_brand,
          card_last_four: attributes.card_last_four,
          update_payment_url: attributes.urls.update_payment_method,
          status: attributes.status
        }
      });

    } catch (error) {
      logger.error(
        '[API] Unexpected error',
        error
      );

      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);


app.get('/api/subscriptions', auth, async (req, res) => {

    const userId = req.user.uid;
        
    const result = await checkSubscription({userId});

    if (!result.success) {
      return res.status(500).json(result);
    }

    return res.json(result);

  }
);

app.delete('/api/cancel-subscriptions', auth, async (req, res) => {

    const subId = req.body.subId;

    const result = await cancelSubscription({subId});

    if (!result.success) {
      return res.status(500).json(result);
    }

    return res.json({
      success: true,
      message:
        'Subscription cancelled successfully',
      data: result.data,
      
    });
  }
);

app.listen(PORT, () => {

  console.log(`API + Socket running on port ${PORT}`);

});
