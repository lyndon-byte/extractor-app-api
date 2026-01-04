import express from "express";
import axios from "axios";
import OpenAI from "openai";
import dotenv from "dotenv";
import crypto from "crypto"; // built-in
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { google } from "googleapis";
import multer from "multer";
import fs from "fs";
import { File } from "node:buffer";
import path from "path";
import {dynamicSchema,imageSchema,textSchema,dynamicSchemaForUpdate, estimationSchema, estimatedCaloriesSchema} from "./Schema/schema.js";
import os from "os"

dotenv.config(); 

if (!globalThis.File) {
  globalThis.File = File;
}

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + "-" + Date.now() + ext);
  },
});

const upload = multer({ storage });
const app = express();
const PORT = process.env.PORT || 3000;
const webhookDomain =  process.env.WEBHOOK_DOMAIN; 

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = "https://iqpblueprint.profitsolutions.com/api/google-callback"; 
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly","https://www.googleapis.com/auth/gmail.modify","https://www.googleapis.com/auth/calendar.events.owned"];


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
    return res.status(400).json({ error: "Missing headers" });
  }

  const rawBody = req.rawBody; // exact JSON string from Laravel

  const expected = crypto
    .createHmac("sha256", process.env.SHARED_SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  if (expected !== signature) {
    return res.status(403).json({ error: "Invalid signature" });
  }

  // Safe: now parsed AFTER signature check
  req.verifiedBody = JSON.parse(rawBody);

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

function generateJsonSchema(input) {
  return {
    name: input.schema_name,
    strict: true,
    schema: buildObjectSchema(input.fields)
  };
}

/** Build the root object schema */
function buildObjectSchema(fields) {
  const properties = {};
  const required = [];

  fields.forEach(field => {
    properties[field.key] = buildField(field);
    required.push(field.key);
  });

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}

/** Recursively build each field */
function buildField(field) {
  const base = {
    type: field.type,
    description: field.description || null
  };

  // If object → recurse
  if (field.type === "object") {
    const props = {};
    const req = [];

    field.properties.forEach(p => {
      props[p.key] = buildField(p);
      req.push(p.key);
    });

    base.properties = props;
    base.required = req;
    base.additionalProperties = false;
  }

  // If array → define items
  if (field.type === "array") {
    if (!field.items) {
      throw new Error(`Array field '${field.key}' must have 'items'.`);
    }

    // If items.type === "object", build deeper structure
    if (field.items.type === "object") {
      const props = {};
      const req = [];

      field.properties.forEach(p => {
        props[p.key] = buildField(p);
        req.push(p.key);
      });

      base.items = {
        type: "object",
        properties: props,
        required: req,
        additionalProperties: false
      };
    } else {
      // Simple arrays (string, number, boolean, etc.)
      base.items = {
        type: field.items.type
      };
    }
  }

  return base;
}


async function upsertSchemaFile(vectorStoreId,updatedSchemas) {

  const vectorFiles = await openai.vectorStores.files.list(vectorStoreId);

  if (vectorFiles.data.length > 0) {

    const vectorFile = vectorFiles.data[0];

    await openai.vectorStores.files.delete(
      vectorFile.id,
      { vector_store_id: vectorStoreId }
    );
    
    await openai.files.delete(vectorFile.id)

  } 

  const tempDir = os.tmpdir();
  const tempFilePath = path.join(tempDir, "schema.json");

  fs.writeFileSync(
    tempFilePath,
    JSON.stringify(updatedSchemas, null, 2),
    "utf-8"
  );
  
  const uploadedFile = await openai.files.create({
    file: fs.createReadStream(tempFilePath),
    purpose: "user_data",
  });

  await openai.vectorStores.files.create(
    vectorStoreId, 
    {file_id: uploadedFile.id,
  });

  fs.unlinkSync(tempFilePath);

  return {

    file_id: uploadedFile.id,

  };

}

async function generateSchemaFromAI(authType,orgId,vectorStoreId,docType) {

  let result = {};
  let suggestedFolderName = "";
  let acceptedFiles = [];
  let description = "";

  try {
    const completion = await openai.chat.completions.parse({
      model: "gpt-4o-2024-08-06",
      messages: [
        {
          role: "system",
          content: `
            You are an AI JSON Schema Generator.

            Your mission:
            1. Analyze the given document type.
            2. Generate the most complete and comprehensive JSON Schema possible.
            
            STRICT RULES:
            - schema name must use snake_case.
            - All field names must use snake_case.
            - Each property must have an appropriate type (string, object, array).
            - Include nested objects where applicable (e.g., addresses, work_history, education, items, totals).
            
            `
        },
        { 
          role: "user", 
          content: `Generate a schema for ${docType}. Include all universally applicable fields that typically exist in a ${docType}.` 
        },      
      ],
      response_format: {
        type: 'json_schema',
        json_schema: dynamicSchema 
      },
    });

    const parsed = completion.choices?.[0]?.message?.parsed;

    result = generateJsonSchema(parsed)
    suggestedFolderName = parsed.folder_name
    acceptedFiles = parsed.accepted_files
    description = parsed.description
    
  } catch (err) {
    console.error("AI Schema Generator Error:", err.response?.data || err);
    return null;
  }

  const responseData = {
    authType,                
    suggestedFolderName,
    acceptedFiles,
    description,
    orgId,
    docType,
    status: result ? "completed" : "failed",
    response: result,
    timestamp: Date.now(),
  };

  const responseSignature = crypto
    .createHmac("sha256", process.env.SHARED_SECRET)
    .update(JSON.stringify(responseData))
    .digest("hex");

  const { data: response } = await axios.post(`${webhookDomain}/receive-generated-schema`, responseData, {
    headers: { "X-Signature": responseSignature },
  });

  const schemaId = response?.newSchemaId
  const updatedSchemasReferences = response?.newSchemasReferences

  await upsertSchemaFile(vectorStoreId,updatedSchemasReferences);

  return { schema_id: schemaId, document_type: docType };

}



async function analyzeFile(

  authType,  
  fileType,
  fileExt,
  fileContent,
  vectorStoreId,
  orgId  

) {

  let extractedText = null;
  let extractedMeta = null;


  console.log(vectorStoreId)

  if (fileType === "image") {

    const response = await openai.responses.parse({

      model: "gpt-4o-2024-08-06",
      input: [
        {
          role: "system",
          content: `

            Extract all visible and readable text from the provided image.  
            Identify the document type based on the extracted content.
            e.g., 'resume', 'invoice'.

            After determining the document type:

            - Always use the file-search tool to locate and select the appropriate schema that best matches the identified document type from the vector store.
            - If a matching schema is found, return "schema_found": true.
            - If no matching schema is found, return "schema_found": false.
            Apply normalization rules to all detected dates:

            - Month + Year → MM/YYYY
            - Full dates → MM/DD/YYYY
            - Convert any month names (full or abbreviated) into their numeric equivalents.
            
            Return only the structured result according to the schema identified.
            
          `,
        },
        {
          role: "user",
          content: [
            {type: "input_text", text: "Extract text, determine the document type and get schema" },
            {
              type: "input_image",
              image_url: `data:image/${fileExt};base64,${fileContent}`,
            },
          ],
        },
      ],
      tools: [
        {
          type: "file_search", 
          vector_store_ids: [vectorStoreId],
        }
      ],
      text: {
        format: zodTextFormat(imageSchema,"data")
      }
    });

    console.log(response.output_parsed)

    extractedMeta = response.output_parsed
    extractedText = extractedMeta.text
  }

  if (fileType === "typical") {

    
    const response = await openai.responses.parse({

      model: "gpt-4o-2024-08-06",
      input: [
        {
          role: "system",
          content: `

            Analyze the provided content.  
            Identify the document type based on the content.
            e.g., 'resume', 'invoice'.

            After determining the document type:

            - Always use the file-search tool to locate and select the appropriate schema that best matches the identified document type from the vector store.
            - If a matching schema is found, return "schema_found": true.
            - If no matching schema is found, return "schema_found": false.
            Apply normalization rules to all detected dates:

            - Month + Year → MM/YYYY
            - Full dates → MM/DD/YYYY
            - Convert any month names (full or abbreviated) into their numeric equivalents.
            
            Return only the structured result according to the schema identified.
            
          `,
        },
        {
          role: "user",
          content: fileContent
        },
      ],
      tools: [
        {
          type: "file_search", 
          vector_store_ids: [vectorStoreId],
        }
      ],
      text: {
        format: zodTextFormat(textSchema,"data")
      }
    });

    console.log(response.output_parsed)

    extractedMeta = response.output_parsed;
    extractedText = fileContent
  }

  if(!extractedMeta.schema_found){

     const newSchema = await generateSchemaFromAI(   
        authType,
        orgId,
        vectorStoreId,
        extractedMeta.document_type,
    );
    
    console.log("new schema: " + newSchema)

    extractedMeta = newSchema

  } 

  return {

    content: extractedText,
    schemaId: extractedMeta.schema_id,
    docType: extractedMeta.document_type

  };

}





// Incoming webhook endpoint
app.post("/api/extract-data", verifySignature, async (req, res) => {

    const { authType, authSessionId, extraction_request, schema } = req.verifiedBody;

    console.log(schema)

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

    for (const requestData of extraction_request) {

      let parsedData = null;
    
      try {

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
            { role: "user", content: requestData.fileContent },
          ],
          response_format: {
            type: "json_schema",
            json_schema: schema
          },
        });
  
        parsedData = completion.choices?.[0]?.message?.parsed || null;


      } catch (err) {

        console.error("❌ OpenAI error:", err.response?.data || err.message || err);

      }
    
      const responseData = {
        authType,
        sessionId: authSessionId,
        extractionRequestId: requestData.extraction_request_id,
        status: parsedData ? "completed" : "failed",
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


app.post("/api/generate-schema",verifySignature, async (req, res) => {

    const { instruction, vectorStoreId, authSessionId, schemaId, authType  } = req.body;

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

    console.log("✅Request Receive");
    
    let result = {};
    let suggestedFolderName = "";
    let acceptedFiles = [];
    let description = "";
    
    try {

      const completion = await openai.chat.completions.parse({
        model: "gpt-4o-2024-08-06",
        messages: [
          { role: "system", 
            content: `

              You are an AI JSON Schema generator.

              Your job is to:
              1. Read the user's natural-language description of the data structure.
              2. Generate:
                - A JSON schema (pure JSON only)
              
              STRICT RULES:
              - schema name must use snake_case.
              - All field names must use snake_case.
              - Each property must have an appropriate type (string, object, array).
              - Include nested objects where applicable (e.g., addresses, work_history, education, items, totals).

            `
          },
          { role: "user", content: instruction },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: dynamicSchema 
        },
      });
      
      const parsedData = completion.choices?.[0]?.message?.parsed || null;
      
      result = generateJsonSchema(parsedData)
      suggestedFolderName = parsedData.folder_name
      acceptedFiles = parsedData.accepted_files
      description = parsedData.description

    } catch (err) {

      console.error("❌ OpenAI error:", err.response?.data || err.message || err);

    }
  
    const responseData = {
      authType,                
      schemaId,
      suggestedFolderName,
      acceptedFiles,
      description,
      sessionId: authSessionId,
      status: result ? "completed" : "failed",
      response: result,
      timestamp: Date.now(),
    };
  
    console.log("✅ Sending back:", responseData);
  
    const responseSignature = crypto
      .createHmac("sha256", process.env.SHARED_SECRET)
      .update(JSON.stringify(responseData))
      .digest("hex");
  
    
    const { data: response } = await axios.post(`${webhookDomain}/receive-generated-schema`, responseData, {
      headers: { "X-Signature": responseSignature },
    });
  
    const updatedSchemasReferences = response?.newSchemasReferences
  
    await upsertSchemaFile(vectorStoreId,updatedSchemasReferences);

  
});

app.post("/api/update-global-schema-fields",verifySignature, async (req, res) => {

    const { authSessionId, schemaId, schema  } = req.body;

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

    console.log("✅Request Receive");
    
    let result = {};
    
    try {

      const completion = await openai.chat.completions.parse({
        model: "gpt-4o-2024-08-06",
        messages: [
          { role: "system", 
            content: `

              You are an AI assistant that fix JSON Schema fields.

              Your job is to:
              1. Read the user's schema and look for errors.
              2. Generate:
                - A new JSON schema (pure JSON only)
              
              STRICT RULES:
              - schema name must use snake_case.
              - All field names must use snake_case.
              - Each property must have an appropriate type (string, object, array).
              - Include nested objects where applicable (e.g., addresses, work_history, education, items, totals).

            `
          },
          { role: "user", content: schema },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: dynamicSchemaForUpdate 
        },
      });
      
      const parsedData = completion.choices?.[0]?.message?.parsed || null;
      
      result = generateJsonSchema(parsedData)

    } catch (err) {

      console.error("❌ OpenAI error:", err.response?.data || err.message || err);

    }

    const responseData = {          
      schemaId,
      sessionId: authSessionId,
      response: result,
      timestamp: Date.now(),
    };

    console.log("✅ Sending back:", responseData);

    const responseSignature = crypto
      .createHmac("sha256", process.env.SHARED_SECRET)
      .update(JSON.stringify(responseData))
      .digest("hex");

    
    await axios.post(`${webhookDomain}/receive-updated-global-schema-fields`, responseData, {
      headers: { "X-Signature": responseSignature },
    });


});

app.post("/api/analyze-file-for-schema", verifySignature, async (req, res) => {

    const { 

      authType, 
      authSessionId, 
      fileId, 
      fileType,
      fileExt,
      fileContent,
      vectorStoreId,
      orgId  

    } = req.body;
    
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

    const { content, schemaId: returnedSchemaId, docType  } = await analyzeFile(
      
        authType,
        fileType,
        fileExt,
        fileContent,
        vectorStoreId,
        orgId  
      
    )

    const responseData = {

        authType,
        fileId,
        orgId,
        sessionId: authSessionId,
        response: {
          content,
          schemaId: returnedSchemaId,
          docType
        },
        timestamp: Date.now()
      
    };
    
    const responseSignature = crypto
      .createHmac("sha256", process.env.SHARED_SECRET)
      .update(JSON.stringify(responseData))
      .digest("hex");
  
    await axios.post(`${webhookDomain}/receive-file-schema-webhook`, responseData, {
      headers: { "X-Signature": responseSignature },
    });

})

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

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    const result = await gmail.users.labels.list({ userId: "me" });
    
    const profile = await gmail.users.getProfile({ userId: "me" });

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

app.post("/api/transcribe", upload.single("file"), verifySignature, async (req, res) => {

    const sessionId = req.headers['x-session-id'];
    const { transcriptionId, transcription_mode, timestamp_mode } = req.body;
    const filePath = req.file.path;

    // timestamp for request signature
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const ackData = {
        status: "accepted",
        note: "Processing, result will be sent to webhook",
        timestamp: timestamp,
    };

   const ackSignature = crypto
    .createHmac("sha256", process.env.SHARED_SECRET)
    .update(JSON.stringify(ackData))
    .digest("hex");
   
   res.setHeader("X-Signature", ackSignature)
   res.status(200).json(ackData);


   try {

      let result;

      if (transcription_mode === "speakers") {

        result = await openai.audio.transcriptions.create({
          file: fs.createReadStream(filePath),
          model: "gpt-4o-transcribe-diarize",
          response_format: "diarized_json",
          chunking_strategy: "auto",       
        });
        
      } else {

        result = await openai.audio.transcriptions.create({
          file: fs.createReadStream(filePath),
          model: "whisper-1",
          response_format: "verbose_json",
          timestamp_granularities: [timestamp_mode]
        });

      }

    
      const responseData = {
        success: true,
        sessionId: sessionId,
        transcriptionId: transcriptionId,
        duration: result.duration,
        text: result.text,
        segments:
        transcription_mode === "speakers"
          ? result.segments // diarized output
          : timestamp_mode === "segment"
          ? result.segments
          : result.words,
      };

      console.log("✅ Transcription completed successfully!");
      console.log(result);

      const responseSignature = crypto
        .createHmac("sha256", process.env.SHARED_SECRET)
        .update(`${timestamp}.${JSON.stringify(responseData)}`)
        .digest("hex");


      await axios.post(`${webhookDomain}/webhook`, responseData,{
        headers: { 
          "X-Signature": responseSignature,
          "X-Timestamp" : timestamp 
        }
      });

  } catch (error) {

    console.error("Transcription error:", error);

  } finally {

    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

});

app.post("/api/webhook-receiver", async (req, res) => {

    try {

      const payload = req.body; // receive the payload

      console.log("Received webhook payload:", payload);

      // Respond to webhook service
      res.status(200).json({ success: true, received: payload });

    } catch (error) {

      console.error("Webhook error:", error);
      res.status(500).json({ success: false });
    }

})

async function enrichFoodsWithCalories(detectedFoods) {

  const API_KEY = "H7tmFjyUfV5Pkbi3afkJz0XpwK2tgtDWwuBNTGQG";

  const realFoodData = [];

  for (const food of detectedFoods) {

    const response = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${API_KEY}&query=${encodeURIComponent(food.foodName)}`
    );

    const data = await response.json();

    const usdaFood = data.foods[0];

    let nutrients = [];

    if (Array.isArray(usdaFood.foodNutrients)) {
      nutrients = usdaFood.foodNutrients
        .filter(n => n.nutrientName && typeof n.value === "number")
        .map(n => ({
          nutrientName: n.nutrientName,
          value: n.value,
          unitName: n.unitName || null // optional: include unit
        }));
    }

    realFoodData.push({

      foodName: food.foodName,
      servingSizeUnit: usdaFood.servingSizeUnit,
      servingSize: usdaFood.servingSize,
      householdServingFullText: usdaFood.householdServingFullText,
      nutrients: nutrients

    });
  }

  return JSON.stringify(realFoodData);
}

app.post("/api/analyze-food-image", verifySignature , async (req, res) => {

  try {

    const { userId, fileExt, fileContent } = req.body;

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

    const response = await openai.responses.parse({

      model: "gpt-4o-2024-08-06",
      input: [
        {
          role: "system",
          content: `

          You are an AI vision-based food analysis assistant.
          
          Your task is to analyze a single image of a prepared dish and identify all visually distinct food items present. For each detected food item, you must estimate its serving size based solely on visual cues from the image.
          
          # Core Responsibilities

          Detect individual food items visible in the dish.
          Treat mixed dishes as separate components when visually distinguishable (e.g., rice and chicken, vegetables and meat).
          Provide reasonable visual estimates, not exact measurements.
          When uncertain, still provide the best plausible estimate based on common portion sizes.
          
          # Output Requirements
          
          You must respond only with JSON that strictly conforms to the provided schema.
          Do not include explanations, commentary, or additional fields.
          Do not include markdown or formatting outside the JSON object.
          Do not guess foods that are not visually present.
          
          # Field Instructions
          
          For each object in detectedFoods:
          
          [foodName]:
          
          Use a common, generic food name.
          
          Avoid brand names or overly specific culinary terms unless visually obvious.
          
          servingSizeUnit
          
          Use standard weight units only (g or oz).
          Use a single unit consistently per food item.
          
          [servingSize]:
          
          Provide a numeric estimate of the food’s weight in the specified unit.
          The value must be a number, not a string.
          
          [householdServingFullText]:
          
          Provide a human-readable serving approximation (e.g., “1 cup”, “2 slices”, “1 medium piece”).
          This value should align logically with the numeric serving size.
          
          # Estimation Guidelines
          
          Base estimates on typical household portions and visual scale references (plates, utensils, bowls).
          Prefer conservative estimates over extreme values.
          If multiple pieces of the same food are present, estimate the total combined serving.
          
          # Constraints
          
          Do not include nutritional data, calories, or macros.
          Do not infer ingredients that cannot be visually confirmed.
          Do not include confidence scores or uncertainty language in the output.
          Do not add or remove schema fields.
                      
          `,
        },
        {
          role: "user",
          content: [
            {type: "input_text", text: "Analyze the image" },
            {
              type: "input_image",
              image_url: `data:image/${fileExt};base64,${fileContent}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "food_weight_and_servings_estimation",
          strict: true,
          schema: estimationSchema.schema 
        }
      }
      // text: {
      //   format: zodTextFormat(estimationSchema,"data")
      // }
    });

    const realFoodData =  enrichFoodsWithCalories(response.output_parsed.detectedFoods)

    console.log(realFoodData)

    const estimatedFoodData = JSON.stringify(response.output_parsed)

    const estimatedCalories = await openai.responses.parse({

      model: "gpt-4o-2024-08-06",
      input: [
        {
          role: "system",
          content: `

          You are a nutrition calculation assistant.

          Your task is to calculate the calories for each detected food item based on:
          
          1. The AI-estimated serving sizes and units (from estimatedFoodData).
          2. The reference USDA food data (from realFoodData), which provides calorie information per standard serving.
          
          For each food item:
          
          - Use the estimated serving size and unit to compute the total calories.
          - Compare it to the USDA reference serving size and weight.
          - Do not modify the original food name or other metadata.
          
          Your response must strictly follow the provided JSON schema.
          Do not include explanations, commentary, or any extra fields.
                              
          `,
        },
        {
          role: "user",
          content: `

            estimated food data: ${estimatedFoodData}
            real USDA food data: ${realFoodData}
            
            Instructions:
            - estimatedFoodData contains AI-estimated servings/weights for each food.
            - realFoodData contains USDA reference info including standard serving sizes and calories per standard serving.
            - For each food in estimatedFoodData, calculate calories as:
                calculatedCaloriePerServing = (estimatedServing / USDAServingSize) * USDACalories
            - Return the final list of food objects with calculatedCaloriePerServing added.
          
            `,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "calorie_estimation",
          strict: true,
          schema: estimatedCaloriesSchema.schema 
        }
      }
    });

    const responseData = {
        userId,
        calorie: estimatedCalories.output_parsed,
        timestamp: Date.now()
    };
    
    const responseSignature = crypto
      .createHmac("sha256", process.env.SHARED_SECRET)
      .update(JSON.stringify(responseData))
      .digest("hex");

    await axios.post(`${webhookDomain}/api/receive-estimated-calorie`, responseData, {
      headers: { "X-Signature": responseSignature },
    });


  } catch (error) {

    console.error("api error:", error);
    res.status(500).json({ success: false });
  }

})



// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
