import { describe, expect, it } from 'vitest';
import {
  MAX_RENDERED_MESSAGE_BYTES,
  pickPublicReplyTemplate,
  renderPublicReply,
  renderTemplate,
  truncateUtf8,
} from './template';

describe('renderTemplate', () => {
  it('replaces known placeholders and leaves unknown ones visible', () => {
    const rendered = renderTemplate('Hi {{username}}, your file: {{resource_url}} — {{nope}}', {
      username: 'fan.account',
      resourceUrl: 'https://example.com/guide',
    });
    // A typo stays in the message so the author sees it instead of silently
    // losing words from their copy.
    expect(rendered).toBe('Hi fan.account, your file: https://example.com/guide — {{nope}}');
  });

  it('tolerates whitespace inside the braces and renders missing values as empty', () => {
    expect(renderTemplate('A{{ username }}B{{resource_url}}C', { username: 'x', resourceUrl: null })).toBe('AxBC');
    expect(renderTemplate('Hello {{ ig_username }}', {})).toBe('Hello ');
  });

  it('renders an empty template as an empty string', () => {
    expect(renderTemplate('', { username: 'x' })).toBe('');
  });

  it('caps the message at 1,000 UTF-8 bytes without splitting a character', () => {
    const rendered = renderTemplate('{{comment_text}}', { commentText: '😀'.repeat(400) });
    expect(Buffer.byteLength(rendered, 'utf8')).toBeLessThanOrEqual(MAX_RENDERED_MESSAGE_BYTES);
    // A sliced emoji would leave a replacement character behind.
    expect(rendered).not.toContain('\uFFFD');
    expect(rendered.length).toBeGreaterThan(0);
  });

  it('truncateUtf8 keeps short text untouched and cuts long text on a boundary', () => {
    expect(truncateUtf8('short', 100)).toBe('short');
    const long = 'abc😀def';
    const cut = truncateUtf8(long, 5); // 5 bytes = "abc" + 2 of 4 emoji bytes
    expect(cut).toBe('abc');
    expect(Buffer.from(cut, 'utf8').toString('utf8')).toBe('abc');
  });
});

describe('pickPublicReplyTemplate', () => {
  it('returns null for an empty or blank template list', () => {
    expect(pickPublicReplyTemplate([])).toBeNull();
    expect(pickPublicReplyTemplate(['', '   '])).toBeNull();
    expect(pickPublicReplyTemplate(null)).toBeNull();
    expect(pickPublicReplyTemplate(undefined)).toBeNull();
  });

  it('picks deterministically when the random source is fixed', () => {
    const templates = ['first', 'second', 'third'];
    expect(pickPublicReplyTemplate(templates, () => 0)).toBe('first');
    expect(pickPublicReplyTemplate(templates, () => 0.99)).toBe('third');
    // Out-of-range randomness can never select a missing template.
    expect(pickPublicReplyTemplate(templates, () => 1)).toBe('third');
  });

  it('never throws when randomness returns NaN', () => {
    expect(['a', 'b']).toContain(pickPublicReplyTemplate(['a', 'b'], () => Number.NaN));
  });
});

describe('renderPublicReply', () => {
  it('renders the chosen template with the commenter variables', () => {
    expect(renderPublicReply(['@{{username}} just sent it to your DMs! 📩'], { username: 'fan.account' }))
      .toBe('@fan.account just sent it to your DMs! 📩');
  });

  it('returns null when public replies are configured without templates', () => {
    expect(renderPublicReply([], { username: 'fan' })).toBeNull();
  });
});
