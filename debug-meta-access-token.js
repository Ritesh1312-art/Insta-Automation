const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env');
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
  console.log('=== ACCURATE META API DEEP DIAGNOSTIC ===\n');

  const connection = await prisma.metaConnection.findFirst({ where: { connectionStatus: 'CONNECTED' } });
  if (!connection) {
    console.log('No connected Meta connection in database!');
    return;
  }

  const accessToken = decryptToken(connection.accessTokenEncrypted);
  console.log(`Connected Instagram Username: @${connection.instagramUsername}`);
  console.log(`Page ID: ${connection.facebookPageId}`);

  // 1. Debug Access Token
  console.log('\n--- 1. TOKEN SCOPES & APP ID ---');
  const debugRes = await fetch(`https://graph.facebook.com/v19.0/debug_token?input_token=${accessToken}&access_token=${accessToken}`);
  const debugData = await debugRes.json();
  console.log(JSON.stringify(debugData, null, 2));

  // 2. Check Permissions granted by user token
  console.log('\n--- 2. USER PERMISSIONS GRANTED ---');
  const permRes = await fetch(`https://graph.facebook.com/v19.0/me/permissions?access_token=${accessToken}`);
  const permData = await permRes.json();
  console.log(JSON.stringify(permData, null, 2));

  // 3. Check Subscribed Webhook Apps on Facebook Page
  console.log('\n--- 3. PAGE SUBSCRIBED APPS ---');
  const subRes = await fetch(`https://graph.facebook.com/v19.0/${connection.facebookPageId}/subscribed_apps?access_token=${accessToken}`);
  const subData = await subRes.json();
  console.log(JSON.stringify(subData, null, 2));
}

main().finally(() => prisma.$disconnect());
