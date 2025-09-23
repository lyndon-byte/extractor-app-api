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
  phone: z.string().optional(),
  summary: z.string().optional(),
  skills: z.array(z.string()),
  experience: z.array(
    z.object({
      company: z.string(),
      role: z.string(),
      startDate: z.string(),
      endDate: z.string().optional(),
      description: z.string().optional(),
    })
  ),
  education: z.array(
    z.object({
      school: z.string(),
      degree: z.string(),
      fieldOfStudy: z.string().optional(),
      startDate: z.string(),
      endDate: z.string().optional(),
    })
  ),
});



function verifySignature(req, res, next) {
  const signature = req.headers["x-signature"];
  const expected = crypto
    .createHmac("sha256", process.env.SHARED_SECRET)
    .update(req.rawBody)
    .digest("hex");

  if (signature !== expected) {
    return res.status(403).json({ error: "Invalid signature" });
  }
  next();
}


// Incoming webhook endpoint
app.post("/api/extract-data", async (req, res) => {

    console.log("BODY RECEIVED:", req.body);

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

      async function getData() {

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
                    image_url: { url: file.fileContent },
                  },
                ],
              },
            ],
            response_format: zodResponseFormat(Resume, "data"),
          });
    
          return completion.choices[0].message.parsed;
        } else {
          try {
            const completion = await openai.chat.completions.parse({
              model: "gpt-4o-2024-08-06",
              messages: [
                { role: "system", content: "Extract the information." },
                { role: "user", content: file.fileContent },
              ],
              response_format: zodResponseFormat(Resume, "data"),
            });
    
            return completion.choices[0].message.parsed;
          } catch (err) {
            console.error("❌ OpenAI or webhook error:", err);
            return null;
          }
        }
      }
    
      const parsedData = await getData(); // ✅ Wait for result
    
      const responseData = {
        sessionId: file.sessionId,
        status: "completed",
        from: "express",
        response: parsedData,
        timestamp: Date.now(),
      };

      console.log(responseData);
    
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
