const https = require('https');

const sampleMetaWebhookPayload = {
  entry: [
    {
      id: '17841439216724676',
      time: Math.floor(Date.now() / 1000),
      changes: [
        {
          field: 'comments',
          value: {
            id: '18099887766554433',
            text: 'PROMPT',
            media: {
              id: '18012345678901234',
              media_product_type: 'REELS'
            },
            from: {
              id: '998877665544',
              username: 'test_follower_account'
            }
          }
        }
      ]
    }
  ]
};

const data = JSON.stringify(sampleMetaWebhookPayload);

const options = {
  hostname: 'insta-automation-vert.vercel.app',
  port: 443,
  path: '/api/webhooks/meta',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  }
};

console.log('Sending test webhook payload to Vercel...');

const req = https.request(options, (res) => {
  console.log(`Status Code: ${res.statusCode}`);
  let responseData = '';
  res.on('data', (chunk) => { responseData += chunk; });
  res.on('end', () => {
    console.log('Response Body:', responseData);
  });
});

req.on('error', (error) => {
  console.error('Error:', error);
});

req.write(data);
req.end();
