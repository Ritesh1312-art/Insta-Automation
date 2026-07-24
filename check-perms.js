// Check what exact permissions our token has and what endpoint works
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '');
  });
}
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();

function decryptToken(enc) {
  const [ivHex, tagHex, data] = enc.split(':');
  const key = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex');
  const dec = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  dec.setAuthTag(Buffer.from(tagHex, 'hex'));
  return dec.update(data, 'hex', 'utf8') + dec.final('utf8');
}

async function main() {
  const connection = await prisma.metaConnection.findFirst({ where: { connectionStatus: 'CONNECTED' } });
  const accessToken = decryptToken(connection.accessTokenEncrypted);

  console.log('=== TOKEN PERMISSIONS CHECK ===\n');
  
  // Check token debug info
  const debugRes = await fetch(`https://graph.facebook.com/debug_token?input_token=${accessToken}&access_token=${accessToken}`);
  const debugData = await debugRes.json();
  console.log('Token Info:', JSON.stringify(debugData.data || debugData, null, 2));

  console.log('\n=== PAGE PERMISSIONS ===\n');
  const permRes = await fetch(`https://graph.facebook.com/v19.0/${connection.facebookPageId}/permissions?access_token=${accessToken}`);
  const permData = await permRes.json();
  console.log('Page Permissions:', JSON.stringify(permData, null, 2));
  
  console.log('\n=== INSTAGRAM ACCOUNT PERMISSIONS ===\n');
  const igPermRes = await fetch(`https://graph.facebook.com/v19.0/${connection.instagramAccountId}?fields=id,username&access_token=${accessToken}`);
  const igPermData = await igPermRes.json();
  console.log('IG Account:', JSON.stringify(igPermData, null, 2));

  // Try using page access token instead
  console.log('\n=== GETTING PAGE ACCESS TOKEN ===\n');
  const pageTokenRes = await fetch(`https://graph.facebook.com/v19.0/${connection.facebookPageId}?fields=access_token&access_token=${accessToken}`);
  const pageTokenData = await pageTokenRes.json();
  const pageToken = pageTokenData.access_token;
  console.log('Page Access Token obtained:', pageToken ? 'YES ✅' : 'NO ❌');
  
  if (pageToken) {
    console.log('\n=== TEST WITH PAGE ACCESS TOKEN ===');
    // Get latest comment
    const ev = await prisma.webhookEvent.findFirst({
      where: { commenterUsername: { notIn: ['stuti.ritesh90'] } },
      orderBy: { createdAt: 'desc' }
    });
    
    if (ev) {
      // Try direct DM with page token
      const testRes = await fetch(`https://graph.facebook.com/v19.0/${connection.instagramAccountId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: ev.commenterId },
          message: { text: 'Test with page token' },
          access_token: pageToken
        })
      });
      const testData = await testRes.json();
      console.log(`DM to ${ev.commenterUsername} with page token:`, JSON.stringify(testData));

      // Try private reply using page token via /me/messages  
      const testRes2 = await fetch(`https://graph.facebook.com/v19.0/me/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pageToken}` },
        body: JSON.stringify({
          recipient: { comment_id: ev.commentId },
          message: { text: 'Private reply test with page token' }
        })
      });
      const testData2 = await testRes2.json();
      console.log(`Private reply with page token:`, JSON.stringify(testData2));
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
