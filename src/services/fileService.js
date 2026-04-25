import 'dotenv/config'
import crypto from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from "fs"

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});


export async function uploadAudioFile(file) {

    try {

        const ext = file.originalname.split('.').pop();
        const fileName = `${Date.now()}-${crypto.randomUUID()}.${ext}`

        const uploadCommand = new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: `uploads/${fileName}`,
            Body:  fs.createReadStream(file.path),
            ContentType: file.mimetype,
        });

        await r2Client.send(uploadCommand);

        return `${process.env.R2_PUBLIC_URL}/uploads/${fileName}`

    } catch (err) { 

        console.error("Transcription error:", err);

    } finally {

        fs.unlink(file.path, () => {});

    }
    
}
