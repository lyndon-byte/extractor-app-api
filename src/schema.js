import { pgTable, serial, text, varchar, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const voiceEmails = pgTable('voice_emails', {
  id: serial('id').primaryKey(),
  uid: varchar('uid', { length: 255 }).notNull(), 
  subject: varchar('subject', { length: 255 }),
  body: text('body'),
  rawTranscription: text('raw_transcription'),
  fileUrl: varchar('file_url', { length: 512 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .default(sql`now()`)
    .$onUpdate(() => new Date()),
});
