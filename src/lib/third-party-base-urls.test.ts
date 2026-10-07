import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_META_GRAPH_BASE_URL,
  DEFAULT_META_GRAPH_API_VERSION,
  isMetaGraphUrl,
  metaGraphApiVersion,
  metaGraphBaseUrl,
  metaGraphUrl,
} from './meta-graph';
import { DEFAULT_TELEGRAM_API_BASE_URL, telegramApiBaseUrl } from './telegram';

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env.META_GRAPH_BASE_URL = ORIGINAL.META_GRAPH_BASE_URL;
  process.env.META_GRAPH_API_VERSION = ORIGINAL.META_GRAPH_API_VERSION;
  process.env.TELEGRAM_API_BASE_URL = ORIGINAL.TELEGRAM_API_BASE_URL;
  if (ORIGINAL.META_GRAPH_BASE_URL === undefined) delete process.env.META_GRAPH_BASE_URL;
  if (ORIGINAL.TELEGRAM_API_BASE_URL === undefined) delete process.env.TELEGRAM_API_BASE_URL;
});

describe('metaGraphBaseUrl', () => {
  it('defaults to the production Graph host when unset', () => {
    delete process.env.META_GRAPH_BASE_URL;
    expect(metaGraphBaseUrl()).toBe(DEFAULT_META_GRAPH_BASE_URL);
    expect(metaGraphUrl('v26.0', '/me')).toBe('https://graph.facebook.com/v26.0/me');
  });

  it('honours an override and strips a trailing slash', () => {
    process.env.META_GRAPH_BASE_URL = 'http://127.0.0.1:4010/';
    expect(metaGraphBaseUrl()).toBe('http://127.0.0.1:4010');
    expect(metaGraphUrl('v26.0', '/ig-1/media')).toBe('http://127.0.0.1:4010/v26.0/ig-1/media');
  });

  it('accepts the paths without a leading slash', () => {
    process.env.META_GRAPH_BASE_URL = 'https://graph.example.com';
    expect(metaGraphUrl('v26.0', 'me')).toBe('https://graph.example.com/v26.0/me');
  });

  it('rejects a malformed override instead of silently calling the wrong host', () => {
    process.env.META_GRAPH_BASE_URL = 'not a url';
    expect(() => metaGraphBaseUrl()).toThrow(/absolute http/);
    process.env.META_GRAPH_BASE_URL = 'ftp://graph.example.com';
    expect(() => metaGraphBaseUrl()).toThrow(/http or https/);
    process.env.META_GRAPH_BASE_URL = 'https://user:pass@graph.example.com';
    expect(() => metaGraphBaseUrl()).toThrow(/bare origin/);
  });
});

describe('metaGraphApiVersion', () => {
  it('defaults to the documented version', () => {
    delete process.env.META_GRAPH_API_VERSION;
    expect(metaGraphApiVersion()).toBe(DEFAULT_META_GRAPH_API_VERSION);
    expect(metaGraphApiVersion()).toMatch(/^v\d+\.\d+$/);
  });

  it('rejects a version that is not v<major>.<minor>', () => {
    process.env.META_GRAPH_API_VERSION = 'latest';
    expect(() => metaGraphApiVersion()).toThrow(/META_GRAPH_API_VERSION/);
    process.env.META_GRAPH_API_VERSION = 'v21';
    expect(() => metaGraphApiVersion()).toThrow(/META_GRAPH_API_VERSION/);
  });
});

describe('isMetaGraphUrl', () => {
  it('only accepts the configured Graph origin', () => {
    delete process.env.META_GRAPH_BASE_URL;
    expect(isMetaGraphUrl('https://graph.facebook.com/v26.0/ig/media?after=x')).toBe(true);
    expect(isMetaGraphUrl('https://evil.example.com/v26.0/ig/media')).toBe(false);
    expect(isMetaGraphUrl('http://graph.facebook.com/v26.0/ig/media')).toBe(false);
    expect(isMetaGraphUrl('nonsense')).toBe(false);

    process.env.META_GRAPH_BASE_URL = 'http://127.0.0.1:4010';
    expect(isMetaGraphUrl('http://127.0.0.1:4010/v26.0/ig/media?after=x')).toBe(true);
    expect(isMetaGraphUrl('http://127.0.0.1:4011/v26.0/ig/media')).toBe(false);
  });
});

describe('telegramApiBaseUrl', () => {
  it('defaults to the production Bot API when unset', () => {
    delete process.env.TELEGRAM_API_BASE_URL;
    expect(telegramApiBaseUrl()).toBe(DEFAULT_TELEGRAM_API_BASE_URL);
  });

  it('honours an override and rejects a malformed one', () => {
    process.env.TELEGRAM_API_BASE_URL = 'http://127.0.0.1:4020/';
    expect(telegramApiBaseUrl()).toBe('http://127.0.0.1:4020');
    process.env.TELEGRAM_API_BASE_URL = 'api.telegram.org';
    expect(() => telegramApiBaseUrl()).toThrow(/absolute http/);
    process.env.TELEGRAM_API_BASE_URL = 'ws://127.0.0.1:4020';
    expect(() => telegramApiBaseUrl()).toThrow(/http or https/);
  });
});
