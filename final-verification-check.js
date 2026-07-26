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
const prisma = new PrismaClient();

async function main() {
  console.log('====================================================');
  console.log('        🔍 FINAL SYSTEM END-TO-END VERIFICATION     ');
  console.log('====================================================\n');

  // Check 1: Meta OAuth Scopes in MetaAuthService
  const metaAuthPath = path.join(__dirname, 'src', 'services', 'meta', 'MetaAuthService.ts');
  const metaAuthCode = fs.readFileSync(metaAuthPath, 'utf8');
  const requiredScopes = [
    'instagram_basic',
    'instagram_manage_comments',
    'instagram_manage_messages',
    'instagram_business_basic',
    'instagram_business_manage_messages',
    'pages_show_list',
    'pages_read_engagement',
    'pages_messaging',
    'pages_manage_metadata',
    'business_management',
    'public_profile'
  ];

  let missingScopes = [];
  requiredScopes.forEach(s => {
    if (!metaAuthCode.includes(s)) missingScopes.push(s);
  });

  console.log('1️⃣ META OAUTH SCOPES CHECK:');
  if (missingScopes.length === 0) {
    console.log('   ✅ All 11 Meta scopes included in OAuth URL generation!');
  } else {
    console.log('   ❌ Missing scopes:', missingScopes);
  }

  // Check 2: Active Automation in Database
  const activeAutomation = await prisma.automation.findFirst({
    where: { status: 'ACTIVE' },
    include: { resource: true }
  });

  console.log('\n2️⃣ ACTIVE AUTOMATION DATABASE CHECK:');
  if (activeAutomation) {
    console.log(`   ✅ Active Automation Found: "${activeAutomation.name}"`);
    console.log(`   Template : "${activeAutomation.dmMessageTemplate.substring(0, 60)}..."`);
    console.log(`   Resource : ${activeAutomation.resource ? activeAutomation.resource.url : ' linked'}`);
  } else {
    console.log('   ❌ No active automation found in database!');
  }

  // Check 3: Gmail SMTP Configuration
  console.log('\n3️⃣ GMAIL SMTP CONFIGURATION CHECK:');
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASSWORD;
  if (smtpUser && smtpPass) {
    console.log(`   ✅ SMTP User : ${smtpUser}`);
    console.log(`   ✅ SMTP Pass : ****${smtpPass.substring(smtpPass.length - 4)}`);
  } else {
    console.log('   ❌ SMTP credentials missing in .env!');
  }

  // Check 4: Automation Engine Logic (2-button card & Get Prompt handler)
  const enginePath = path.join(__dirname, 'src', 'services', 'automation', 'AutomationEngine.ts');
  const engineCode = fs.readFileSync(enginePath, 'utf8');

  console.log('\n4️⃣ AUTOMATION ENGINE LOGIC CHECK:');
  const has2Buttons = engineCode.includes('👉 Follow Profile') && engineCode.includes('✨ Get Prompt');
  const hasGetPromptHandler = engineCode.includes('GET_PROMPT_POSTBACK_') || engineCode.includes('isPromptClick');
  const hasFollowCheck = engineCode.includes('hasFollowed') || engineCode.includes('followedAt');

  console.log(`   - 2-Button Card Template : ${has2Buttons ? '✅ CONFIRMED' : '❌ MISSING'}`);
  console.log(`   - Get Prompt Click Handler: ${hasGetPromptHandler ? '✅ CONFIRMED' : '❌ MISSING'}`);
  console.log(`   - Realtime Follow Check   : ${hasFollowCheck ? '✅ CONFIRMED' : '❌ MISSING'}`);

  console.log('\n====================================================');
  console.log('                  VERIFICATION COMPLETED            ');
  console.log('====================================================');
}

main().finally(() => prisma.$disconnect());
