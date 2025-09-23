import express from "express";
import axios from "axios";
import OpenAI from "openai";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import crypto from "crypto"; // built-in
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";

dotenv.config(); 

const app = express();
const PORT = process.env.PORT || 3000;
const webhookUrl =  process.env.WEBHOOK_URL; 

app.use(express.json({ limit: "50mb" }));
app.use(bodyParser.json({ limit: "50mb" })); 


const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Schema for events

const Resume = z.object({
  name: z.string(),
  email: z.string().email(),
  phone: z.string().nullable(),
  summary: z.string().nullable(),
  skills: z.array(z.string()),
  experience: z.array(
    z.object({
      company: z.string().nullable(),
      role: z.string().nullable(),
      startDate: z.string().nullable(),
      endDate: z.string().nullable(),
      description: z.string().nullable(),
    })
  ),
});



function verifySignature(req, res, next) {

    const signature = req.headers["x-signature"];
    const timestamp = req.headers["x-timestamp"];

    if (!signature || !timestamp) {
      return res.status(400).json({ error: "invalid session" });
    }

    // prevent replay attacks (5 minute tolerance window)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp)) > 300) {
      return res.status(401).json({ error: "session expired" });
    }

    // calculate expected signature
    const expected = crypto
      .createHmac("sha256", process.env.SHARED_SECRET)
      .update(`${timestamp}.${req.rawBody}`)
      .digest("hex");

    if (signature !== expected) {
      return res.status(403).json({ error: "Invalid signature" });
    }

    next();
}


// Incoming webhook endpoint
app.post("/api/extract-data", verifySignature,async (req, res) => {

    const files = req.body; 

    const ackData = {
      status: "accepted",
      note: "Processing with OpenAI, result will be sent to webhook",
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
            response_format: zodResponseFormat(Resume, "data"),
          });
    
          parsedData = completion.choices?.[0]?.message?.parsed || null;
        } else {
          const completion = await openai.chat.completions.parse({
            model: "gpt-4o-2024-08-06",
            messages: [
              { role: "system", content: "Extract the information." },
              { role: "user", content: file.fileContent },
            ],
            response_format: zodResponseFormat(Resume, "data"),
          });
    
          parsedData = completion.choices?.[0]?.message?.parsed || null;
        }
      } catch (err) {
        console.error("❌ OpenAI error:", err.response?.data || err.message);
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
    
      await axios.post(webhookUrl, responseData, {
        headers: { "X-Signature": responseSignature },
      });
    }

    
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
