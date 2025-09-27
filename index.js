import express from "express";
import axios from "axios";
import OpenAI from "openai";
import dotenv from "dotenv";
import crypto from "crypto"; // built-in
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";

dotenv.config(); 

const app = express();
const PORT = process.env.PORT || 3000;
const webhookDomain =  process.env.WEBHOOK_DOMAIN; 

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
              { role: "system", content: "Extract information on the image using the given schema" },
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
              { role: "system", content: "Extract the information." },
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

app.post("/api/authenticate", async (req, res) => {

  const data = req.body;

  console.log("✅ Authenticated Creds:", data);

  res.status(200).json('sucess');

});


// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
