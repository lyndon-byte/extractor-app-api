import express from "express";
import axios from "axios";
import OpenAI from "openai";
import dotenv from "dotenv";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";

dotenv.config(); 

const app = express();
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Schema for events
const CalendarEvent = z.object({
  name: z.string(),
  date: z.string(),
  participants: z.array(z.string()),
});

app.use(express.json());

// Incoming webhook endpoint
app.post("/extract-declared-data", async (req, res) => {
  try {
    const { message } = req.body; // assume incoming JS==ON has { "message": "..." }
    console.log("📩 Incoming:", message);

    // Call OpenAI to parse the event
    const completion = await openai.chat.completions.parse({
      model: "gpt-4o-2024-08-06",
      messages: [
        { role: "system", content: "Extract the event information." },
        { role: "user", content: message },
      ],
      response_format: zodResponseFormat(CalendarEvent, "event"),
    });

    const event = completion.choices[0].message.parsed;
    console.log("✅ Parsed event:", event);

    // Forward to another webhook URL
    const webhookUrl = "https://example.com/webhook"; // change this
    await axios.post(webhookUrl, event);

    // Respond to sender
    res.status(200).json({
      message: "Event received, parsed, and forwarded",
      event,
    });
  } catch (error) {
    console.error("❌ Error:", error.message);
    res.status(500).json({ error: "Failed to process event" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
