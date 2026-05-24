import crypto from 'crypto'

export default function verifyWebhookSignature(req, res, next) {

  const incomingSignature =
    req.header('X-Signature');

  const payload = req.rawBody;

  const expectedSignature = crypto
    .createHmac(
      'sha256',
      process.env.SHARED_SECRET
    )
    .update(payload)
    .digest('hex');

  if (incomingSignature !== expectedSignature) {
    return res.status(401).json({
      success: false,
      error: 'Invalid signature',
    });
  }

  next();

}