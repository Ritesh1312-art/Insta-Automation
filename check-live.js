const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve(data); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== Checking Live Vercel Deployment ===\n');
  
  // 1. Check stats
  const stats = await get('https://insta-automation-vert.vercel.app/api/stats');
  console.log('1. Stats API:', JSON.stringify(stats));
  
  // 2. Check OAuth URL - what redirect_uri is being sent?
  const authUrl = await get('https://insta-automation-vert.vercel.app/api/auth/meta/url');
  console.log('\n2. OAuth URL Response:', JSON.stringify(authUrl));
  
  if (authUrl.url) {
    const urlObj = new URL(authUrl.url);
    console.log('\n   --- OAuth URL Parameters ---');
    for (const [key, val] of urlObj.searchParams.entries()) {
      console.log(`   ${key}: ${val}`);
    }
  }
}

main().catch(console.error);
