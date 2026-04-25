import 'dotenv/config'
import { Inngest } from "inngest";
import { createVoiceEmail } from "../services/emailService.js";
import { uploadAudioFile } from '../services/fileService.js';

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

    const { data } = event;

    const fileUrl = await step.run("upload-audio", async () => {
      return await uploadAudioFile(data.file);
    });

    await step.run("save-to-db", async () => {

      return await createVoiceEmail({

          uid: data.uid,
          subject: data.subject,
          body: data.body,
          rawTranscription: data.transcription,
          fileUrl: fileUrl

      });

    });


  }
);

export const functions = [processVoiceEmail];
