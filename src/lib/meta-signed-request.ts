import crypto from 'crypto';

interface MetaSignedRequestPayload {
  algorithm?: string;
  user_id?: string;
}

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function parseMetaSignedRequest(signedRequest: string): MetaSignedRequestPayload | null {
  const [encodedSignature, encodedPayload, ...extraParts] = signedRequest.split('.');
  const appSecret = process.env.META_APP_SECRET;
  if (!encodedSignature || !encodedPayload || extraParts.length || !appSecret) return null;

  const expectedSignature = crypto.createHmac('sha256', appSecret).update(encodedPayload).digest();
  const receivedSignature = decodeBase64Url(encodedSignature);
  if (receivedSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(receivedSignature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(decodeBase64Url(encodedPayload).toString('utf8')) as MetaSignedRequestPayload;
    return payload.algorithm === 'HMAC-SHA256' && typeof payload.user_id === 'string' ? payload : null;
  } catch {
    return null;
  }
}
