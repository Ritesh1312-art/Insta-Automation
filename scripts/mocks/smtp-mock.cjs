#!/usr/bin/env node
/**
 * Local SMTP catcher used to verify transactional mail end to end.
 *
 *   node scripts/mocks/smtp-mock.cjs [port]   # default 2525
 *
 * Accepts any username/password (configurable), writes every message to
 * /tmp/maildrop/<n>.eml and appends a parsed summary to
 * /tmp/maildrop/index.jsonl so a test can read the OTP straight out of the
 * real message body.
 */
const fs = require('node:fs');
const path = require('node:path');
const { SMTPServer } = require('smtp-server');

const PORT = Number(process.argv[2] || process.env.MOCK_SMTP_PORT || 2525);
const DROP = process.env.MOCK_MAIL_DROP || '/tmp/maildrop';
const USER = process.env.MOCK_SMTP_USER || 'insta';
const PASSWORD = process.env.MOCK_SMTP_PASSWORD || 'insta';

fs.mkdirSync(DROP, { recursive: true });
let counter = 0;

const server = new SMTPServer({
  secure: false,
  authOptional: false,
  disabledCommands: ['STARTTLS'],
  onAuth(auth, _session, callback) {
    if (auth.username === USER && auth.password === PASSWORD) return callback(null, { user: USER });
    return callback(new Error('Invalid username or password'));
  },
  onData(stream, session, callback) {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      counter += 1;
      const file = path.join(DROP, `${Date.now()}-${counter}.eml`);
      fs.writeFileSync(file, raw);
      const header = (name) => {
        const match = new RegExp(`^${name}:\\s*(.*)$`, 'im').exec(raw);
        return match ? match[1].trim() : null;
      };
      // Headers come first, then a blank line, then the body.
      const separator = raw.indexOf('\r\n\r\n');
      const body = separator === -1 ? raw : raw.slice(separator + 4);
      const summary = {
        file,
        index: counter,
        from: header('From'),
        to: header('To'),
        subject: header('Subject'),
        date: header('Date'),
        body,
      };
      fs.appendFileSync(path.join(DROP, 'index.jsonl'), `${JSON.stringify(summary)}\n`);
      console.log(`smtp-mock: captured #${counter} -> ${summary.to} "${summary.subject}"`);
      callback(null, 'Message queued');
    });
  },
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`smtp-mock listening on 127.0.0.1:${PORT} (drop ${DROP})`);
});
