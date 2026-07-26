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
  console.log('=== AUDIT OF ALL 5 PLATFORMS & CONFIGURATION ===\n');

  // 1. Check Meta Connection in DB
  const connection = await prisma.metaConnection.findFirst({ where: { connectionStatus: 'CONNECTED' } });
  console.log('1. DATABASE META CONNECTION:');
  console.log(`   Username  : @${connection?.instagramUsername}`);
  console.log(`   IG Account: ${connection?.instagramAccountId}`);
  console.log(`   Page ID   : ${connection?.facebookPageId}`);
  console.log(`   Status    : ${connection?.connectionStatus}`);

  // 2. Check Active Automations
  const automations = await prisma.automation.findMany({
    where: { status: 'ACTIVE' },
    include: { resource: true, media: true }
  });
  console.log('\n2. ACTIVE AUTOMATION ON DASHBOARD:');
  automations.forEach(a => {
    console.log(`   Name      : ${a.name}`);
    console.log(`   ID        : ${a.id}`);
    console.log(`   Resource  : ${a.resource?.url || a.resource?.textContent || '❌ NONE'}`);
    console.log(`   Template  : ${a.dmMessageTemplate}`);
    console.log(`   PublicRep : ${a.publicReplyEnabled ? 'ENABLED' : 'DISABLED'}`);
  });

  // 3. Check App Permissions via Graph API
  if (connection) {
    const accessToken = decryptToken(connection.accessTokenEncrypted);
    console.log('\n3. META DEVELOPER APP PERMISSIONS AUDIT:');
    const debugRes = await fetch(`https://graph.facebook.com/debug_token?input_token=${accessToken}&access_token=${accessToken}`);
    const debugData = await debugRes.json();
    console.log('   App ID    :', debugData.data?.app_id);
    console.log('   Is Valid  :', debugData.data?.is_valid);
    console.log('   Scopes    :', (debugData.data?.scopes || []).join(', '));

    // Test sending DM to a test recipient
    console.log('\n4. META LIVE DM DELIVERY API RESPONSE:');
    const testRes = await fetch(`https://graph.facebook.com/v19.0/me/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        recipient: { id: '1398151212169513' }, // bhakti
        message: { text: 'Audit test DM' }
      })
    });
    const testData = await testRes.json();
    console.log('   Response  :', JSON.stringify(testData));
  }
}

main().finally(() => prisma.$disconnect());
