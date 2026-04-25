CREATE TABLE "voice_emails" (
	"id" serial PRIMARY KEY NOT NULL,
	"uid" varchar(255) NOT NULL,
	"subject" varchar(255),
	"body" text,
	"raw_transcription" text,
	"file_url" varchar(512),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
