import { eq } from 'drizzle-orm';
import { db } from '../db.js';
import { voiceEmails } from '../schema.js';

export async function getEmailsByUid(targetUid) {
  return await db
    .select()
    .from(voiceEmails)
    .where(eq(voiceEmails.uid, targetUid));
}

export async function createVoiceEmail(data) {

  return await db.insert(voiceEmails).values({
    uid: data.uid,
    subject: data.subject,
    body: data.body,
    rawTranscription: data.rawTranscription,
    fileUrl: data.fileUrl
  }).returning(); 

}