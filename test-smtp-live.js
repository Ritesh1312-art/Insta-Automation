const nodemailer = require('nodemailer');

async function testGmailSmtp() {
  console.log('=== TESTING GMAIL SMTP CONFIGURATION ===\n');

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: 'ritesh.gupta131290@gmail.com',
      pass: 'gvieclncokjcovkz',
    },
  });

  try {
    const info = await transporter.sendMail({
      from: 'ritesh.gupta131290@gmail.com',
      to: 'ritesh.gupta131290@gmail.com',
      subject: 'InstaDM Auto - Live Gmail SMTP Test',
      text: 'Your Gmail SMTP configuration is working perfectly! Password Reset OTP emails will now arrive directly in your Inbox.',
      html: '<h3>InstaDM Auto SMTP Configured!</h3><p>Password Reset OTP emails will now arrive directly in your Inbox.</p>',
    });

    console.log('✅ Email sent successfully!');
    console.log('Message ID:', info.messageId);
  } catch (error) {
    console.error('❌ Gmail SMTP error:', error.message);
  }
}

testGmailSmtp();
