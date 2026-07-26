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
  const connection = await prisma.metaConnection.findFirst({ where: { connectionStatus: 'CONNECTED' } });
  if (!connection) { console.log('No connection'); return; }
  const accessToken = decryptToken(connection.accessTokenEncrypted);
  const igId = connection.instagramAccountId; // 17841439216724676
  const shaluIgsid = '1684299182797183';
  const bhaktiIgsid = '1398151212169513';

  console.log('=== TESTING REAL-TIME META FOLLOW STATUS CHECK API ===\n');

  // Test 1: Query IGSID fields
  console.log('--- Test 1: IGSID fields check ---');
  const res1 = await fetch(`https://graph.facebook.com/v19.0/${bhaktiIgsid}?fields=id,username,name,is_user_follow_business&access_token=${accessToken}`);
  console.log('IGSID fields result:', await res1.json());

  // Test 2: Query IG Business Account followers / follows edge
  console.log('\n--- Test 2: IG Account followers list ---');
  const res2 = await fetch(`https://graph.facebook.com/v19.0/${igId}/followers?access_token=${accessToken}`);
  console.log('Followers endpoint result:', await res2.json());

  // Test 3: Query Page subscribers or business discovery
  console.log('\n--- Test 3: User relationship check ---');
  const res3 = await fetch(`https://graph.facebook.com/v19.0/${igId}?fields=followers_count,follows_count,username&access_token=${accessToken}`);
  console.log('IG Account metrics:', await res3.json());
}

main().finally(() => prisma.$disconnect());
