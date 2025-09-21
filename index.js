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

app.use(bodyParser.json());


const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Schema for events
const CalendarEvent = z.object({
  name: z.string(),
  date: z.string(),
  participants: z.array(z.string()),
});



function verifySignature(req, res, next) {
  const signature = req.headers["x-signature"];
  const expected = crypto
    .createHmac("sha256", process.env.SHARED_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (signature !== expected) {
    return res.status(403).json({ error: "Invalid signature" });
  }
  next();
}


// Incoming webhook endpoint
app.post("/api/extract-data", verifySignature, async (req, res) => {

    const { message } = req.body;

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

    try {
      
      const completion = await openai.responses.create({
        model: "gpt-5",
        input: message,
      });
  
      const responseText = completion.output_text;
  
      const responseData = {
        status: "completed",
        from: "express",
        original: message,
        response: responseText,
        timestamp: Date.now(),
      };
  
      const responseSignature = crypto
        .createHmac("sha256", process.env.SHARED_SECRET)
        .update(JSON.stringify(responseData))
        .digest("hex");
  
      await axios.post(webhookUrl, responseData, {
        headers: { "X-Signature": responseSignature },
      });
  
      console.log("✅ Completion sent to Laravel webhook");
    } catch (err) {
      console.error("❌ OpenAI or webhook error:", err);
    }

    
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
