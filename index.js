import express from "express";
import axios from "axios";
import OpenAI from "openai";
import dotenv from "dotenv";
import crypto from "crypto"; // built-in
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { google } from "googleapis";
import multer from "multer";
import fs from "fs";


dotenv.config(); 

const upload = multer({ dest: "uploads/" });
const app = express();
const PORT = process.env.PORT || 3000;
const webhookDomain =  process.env.WEBHOOK_DOMAIN; 

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = "https://get-assessment.freeaireport.com/api/google-callback"; 
const SCOPES = ["https://www.googleapis.com/auth/gmail.r eadonly","https://www.googleapis.com/auth/gmail.modify"];


const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);

app.use(express.json({
  limit: "50mb",
  verify: (req, res, buf) => {
    req.rawBody = buf.toString(); // ✅ exact raw payload for signature
  }
}));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });


function verifySignature(req, res, next) {
  const signature = req.headers["x-signature"];
  const timestamp = req.headers["x-timestamp"];

  if (!signature || !timestamp) {
    return res.status(400).json({ error: "Invalid Session" });
  }

  // replay attack protection (5 minutes window)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) {
    return res.status(401).json({ error: "Session expired" });
  }

  // expected signature = HMAC(timestamp + '.' + rawBody)
  const expected = crypto
    .createHmac("sha256", process.env.SHARED_SECRET)
    .update(`${timestamp}.${req.rawBody}`)
    .digest("hex");

  if (signature !== expected) {
    return res.status(403).json({ error: "Invalid signature" });
  }

  next();
}

function getHeader(headers, name) {
  const found = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return found ? found.value : "";
}

// Helper: recursively extract plain text body
function getBody(payload) {
  let body = "";
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body.data) {
        body += Buffer.from(part.body.data, "base64").toString("utf8");
      } else if (part.parts) {
        body += getBody(part);
      }
    }
  } else if (payload.body && payload.body.data) {
    body += Buffer.from(payload.body.data, "base64").toString("utf8");
  }
  return body;
}


const JsonSchema = z.object({
  name: z.string(),
  schema: z.string(),
});


// Incoming webhook endpoint
app.post("/api/extract-data", verifySignature, async (req, res) => {

    const { files, schema } = req.body;

    const ackData = {
      status: "accepted",
      note: "Processing, result will be sent to webhook",
      timestamp: Date.now(),
    };

    const ackSignature = crypto
      .createHmac("sha256", process.env.SHARED_SECRET)
      .update(JSON.stringify(ackData))
      .digest("hex");
  
    res.setHeader("X-Signature", ackSignature);
    res.status(200).json(ackData);

    for (const file of files) {

      let parsedData = null;
    
      try {
        if (file.fileType === "image") {
          const completion = await openai.chat.completions.parse({
            model: "gpt-4o-2024-08-06",
            messages: [
              { role: "system", content: `Extract information on the image.  
                If any dates are present, normalize them into a valid date format:
                - Month + Year → MM/YYYY (e.g., "Aug 2022" → "08/2022").
                - Full date → MM/DD/YYYY if day is available.
                Use numeric months (e.g., "January" → "1").` 
              },
              {
                role: "user",
                content: [
                  { type: "text", text: "Please extract information from the image." },
                  {
                    type: "image_url",
                    image_url: { url: `data:image/${file.fileExt};base64,${file.fileContent}` },
                  },
                ],
              },
            ],
            response_format: {
              type: "json_schema",
              json_schema: schema
            },
          });
    
          parsedData = completion.choices?.[0]?.message?.parsed || null;

        } else {
          const completion = await openai.chat.completions.parse({
            model: "gpt-4o-2024-08-06",
            messages: [
              {
                role: "system",
                content: `
                  Extract the information. 
                  If any dates are present, normalize them into a valid date format:
                  - Month + Year → MM/YYYY (e.g., "Aug 2022" → "08/2022").
                  - Full date → MM/DD/YYYY if day is available.
                  Use numeric months (e.g., "January" → "1").
                `,
              },
              { role: "user", content: file.fileContent },
            ],
            response_format: {
              type: "json_schema",
              json_schema: schema
            },
          });
    
          parsedData = completion.choices?.[0]?.message?.parsed || null;
        }
      } catch (err) {

        console.error("❌ OpenAI error:", err.response?.data || err.message || err);

      }
    
      const responseData = {
        sessionId: file.sessionId,
        fileId: file.fileId,
        status: parsedData ? "completed" : "failed",
        from: "express",
        response: parsedData,
        timestamp: Date.now(),
      };
    
      console.log("✅ Sending back:", responseData);
    
      const responseSignature = crypto
        .createHmac("sha256", process.env.SHARED_SECRET)
        .update(JSON.stringify(responseData))
        .digest("hex");
    
      await axios.post(`${webhookDomain}/receive-extracted-data-webhook`, responseData, {
        headers: { "X-Signature": responseSignature },
      });
    }

    
});


app.post("/api/generate-schema", verifySignature, async (req, res) => {

    const { instruction, sessionId } = req.body;

    let result = {};

    const ackData = {
      status: "accepted",
      note: "Processing, result will be sent to webhook",
      timestamp: Date.now(),
    };

    const ackSignature = crypto
      .createHmac("sha256", process.env.SHARED_SECRET)
      .update(JSON.stringify(ackData))
      .digest("hex");

    res.setHeader("X-Signature", ackSignature);
    res.status(200).json(ackData);

  
    try {

      const completion = await openai.chat.completions.parse({
        model: "gpt-4o-2024-08-06",
        messages: [
          { role: "system", content: "Generate a JSON Schema compatible with Structured Outputs based on the user’s instructions. Exclude the $schema key. Use a lowercase, underscore-separated schema name for compatibility." },
          { role: "user", content: instruction },
        ],
        response_format: zodResponseFormat(JsonSchema, "data"),
      });
      
      const parsedData = completion.choices?.[0]?.message?.parsed || null;
      
      result = {
        name: parsedData.name,
        schema: JSON.parse(parsedData.schema)
      }
      

    } catch (err) {

      console.error("❌ OpenAI error:", err.response?.data || err.message || err);

    }
  
    const responseData = {
      sessionId: sessionId,
      status: result ? "completed" : "failed",
      from: "express",
      response: result,
      timestamp: Date.now(),
    };
  
    console.log("✅ Sending back:", responseData);
  
    const responseSignature = crypto
      .createHmac("sha256", process.env.SHARED_SECRET)
      .update(JSON.stringify(responseData))
      .digest("hex");
  
    await axios.post(`${webhookDomain}/receive-generated-schema`, responseData, {
      headers: { "X-Signature": responseSignature },
    });
  

  
});

app.get("/api/auth-google", (req, res) => {
  
  const url = oauth2Client.generateAuthUrl({

    access_type: "offline",       // needed for refresh_token
    prompt: "consent",   
    scope: SCOPES,

  });
  res.redirect(url);

});

// Step 2: Handle callback and exchange code for tokens
app.get("/api/google-callback", async (req, res) => {

  try {

    const code = req.query.code;
    const { tokens } = await oauth2Client.getToken(code);

    console.log('Tokens:',tokens)

    // Set credentials
    oauth2Client.setCredentials(tokens);

    // Get user email
    // const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    // const userInfo = await oauth2.userinfo.get();
    // const email = userInfo.data.email;

    // // Save user tokens (use DB in real apps)
    // users[email] = {
    //   refresh_token: tokens.refresh_token,
    //   access_token: tokens.access_token,
    // };

    // Start watching Gmail inbox for this user
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    const result = await gmail.users.labels.list({ userId: "me" });
    
    const profile = await gmail.users.getProfile({ userId: "me" });

    await gmail.users.watch({
      userId: "me",
      requestBody: {
        topicName: "projects/database-test-edc41/topics/received-emails",
        labelIds: ["INBOX"],
      },
    });
    res.json({

      message: "Authenticated with Gmail API",
      profile: profile,
      labels: result.data.labels,

    });

    
  } catch (err) {
    console.error("Auth error:", err);
    res.status(500).send("Authentication failed");
  }

});

app.post("/api/gmail-received-email-notification", (req, res) => {
  try {
    console.log("📩 New Gmail Pub/Sub Notification:", req.body);

    // The body will contain message.data (Base64 encoded)
    // Decode it to get historyId & email
    if (req.body.message && req.body.message.data) {
      const data = Buffer.from(req.body.message.data, "base64").toString("utf8");
      const parsed = JSON.parse(data);
      console.log("Decoded notification:", parsed);

      // parsed looks like:
      // { emailAddress: "user@gmail.com", historyId: "12345" }
    }

    res.status(200).send(); // must reply 200 to Google
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).send();
  }
});

app.post("/api/view-email", async (req, res) => {

  const {access_token,refresh_token,message_id} = req.body;

  oauth2Client.setCredentials({

    access_token: access_token,
    refresh_token: refresh_token

 })

 
  try {

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const email = await gmail.users.messages.get({
      userId: "me",
      id: message_id,
      format: "full", 
    });

    const message = email.data;

    const result = {
      id: message.id,
      threadId: message.threadId,
      subject: getHeader(message.payload.headers, "Subject"),
      from: getHeader(message.payload.headers, "From"),
      to: getHeader(message.payload.headers, "To"),
      body: getBody(message.payload),
      attachments: [],
    };
    
  
    // If you want attachments
    if (message.payload.parts) {
      for (const part of message.payload.parts) {
        if (part.filename && part.body.attachmentId) {
          console.log("📎 Attachment:", part.filename);

          const attachment = await gmail.users.messages.attachments.get({
            userId: "me",
            messageId: message.id,
            id: part.body.attachmentId,
          });

          // Attachment data is base64url encoded
          result.attachments.push({
            filename: part.filename,
            mimeType: part.mimeType,
            size: part.body.size,
            data: attachment.data.data, // base64url encoded
          });
        }
      }
    }

    res.json(result);


  } catch (err) {
    console.error("Error fetching message:", err);
    res.status(500).json(err.message);
  }


});

app.get("/api/google-logout", async (req, res) => {

    const token = req.query.token;

    await oauth2Client.revokeCredentials(token);

    res.status(200).json('all tokens was revoked!');


});

app.post("/api/unsubscribe-gmail", async (req, res) => {

    const {access_token,refresh_token} = req.body;
    
    oauth2Client.setCredentials({

       access_token: access_token,
       refresh_token: refresh_token

    })

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const gmailResponse = await gmail.users.stop({
      userId: "me",
    });

    console.log("🛑 Watch stopped:", gmailResponse.data);

    res.status(200).json('gmail was unsubscribed!');


});

app.post("/api/transcribe", [upload.single("file"), verifySignature], async (req, res) => {
  try {

    const filePath = req.file.path;

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "gpt-4o-transcribe",
    });

    fs.unlinkSync(filePath); // cleanup temporary file

    console.log("transcription", transcription.text);

    res.json({ text: transcription.text });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
