// FORCE REPROCESS a specific event to see exact error
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
  console.log('=== FORCE REPROCESS TEST ===\n');

  const connection = await prisma.metaConnection.findFirst({ where: { connectionStatus: 'CONNECTED' } });
  const accessToken = decryptToken(connection.accessTokenEncrypted);
  
  // Get bhakti's last comment event
  const ev = await prisma.webhookEvent.findFirst({
    where: { commenterUsername: 'bhakti_ka_safar1' },
    orderBy: { createdAt: 'desc' }
  });
  if (!ev) { console.log('No event found'); return; }
  console.log(`Event: ${ev.id} | Comment: "${ev.commentText}"`);
  console.log(`CommentID: ${ev.commentId} | CommenterID: ${ev.commenterId}`);

  // Get active automation
  const automation = await prisma.automation.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { updatedAt: 'desc' },
    include: { resource: true }
  });
  console.log(`\nAutomation: "${automation?.name}" | Resource: ${automation?.resource?.url || automation?.resource?.textContent || 'NONE'}`);

  const resourceValue = automation?.resource?.url || automation?.resource?.textContent || '';
  const igUsername = connection.instagramUsername || 'stuti.ritesh90';

  // Try TEMPLATE DM (2-button card)
  console.log('\n--- Test 1: Template DM (2-button card) ---');
  const templatePayload = {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'generic',
        elements: [{
          title: `Hey @bhakti_ka_safar1! 🎁`,
          subtitle: `Follow @${igUsername} to unlock your prompt link below! 🚀`,
          buttons: [
            { type: 'web_url', url: `https://instagram.com/${igUsername}`, title: '👉 Follow Profile' },
            { type: 'postback', title: '✨ Get Prompt', payload: `GET_PROMPT_POSTBACK_${automation?.id}` }
          ]
        }]
      }
    }
  };
  const templateRes = await fetch(`https://graph.facebook.com/v19.0/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ recipient: { comment_id: ev.commentId }, message: templatePayload })
  });
  const templateData = await templateRes.json();
  console.log('Template DM Result:', JSON.stringify(templateData));

  // Try plain text DM
  console.log('\n--- Test 2: Plain Text DM ---');
  const plainRes = await fetch(`https://graph.facebook.com/v19.0/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      recipient: { comment_id: ev.commentId },
      message: { text: `Hi bhakti_ka_safar1! Check out @${igUsername} 👉 Follow karein aur prompt pao!` }
    })
  });
  const plainData = await plainRes.json();
  console.log('Plain DM Result:', JSON.stringify(plainData));

  // Try DIRECT DM (not comment_id, but user id)
  console.log('\n--- Test 3: Direct Message to IGSID ---');
  const directRes = await fetch(`https://graph.facebook.com/v19.0/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      recipient: { id: ev.commenterId },
      message: { text: `Hi! Follow @${igUsername} aur prompt pao! 🎁` }
    })
  });
  const directData = await directRes.json();
  console.log('Direct DM Result:', JSON.stringify(directData));
  
  // Try public reply
  console.log('\n--- Test 4: Public Comment Reply ---');
  const pubRes = await fetch(`https://graph.facebook.com/v19.0/${ev.commentId}/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ message: 'Sent! Check DMs 📩' })
  });
  const pubData = await pubRes.json();
  console.log('Public Reply Result:', JSON.stringify(pubData));
}

main().catch(console.error).finally(() => prisma.$disconnect());
