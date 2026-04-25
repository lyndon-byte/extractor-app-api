// inngest/client.js
import 'dotenv/config'
import { Inngest } from "inngest";
import { createVoiceEmail } from "../services/emailService.js";

// Create a client to send and receive events
export const inngest = new Inngest({ 
    
    id: "extractor-app",
    eventKey: process.env.INNGEST_EVENT_KEY

});


const processVoiceEmail = inngest.createFunction(
  { 
    id: "process-voice-email", 
    triggers: [{ event: "app/voice.submitted" }] 
  },
  async ({ event, step }) => {

    const { payload } = event;

    const savedRecord = await step.run("save-to-db", async () => {
      return await createVoiceEmail(payload);
    });

    await step.sendEvent("trigger-notification", {
      name: "app/email.processed",
      data: { emailId: savedRecord.id, userUid: payload.uid },
    });

  }
);

export const functions = [processVoiceEmail];
