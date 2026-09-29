import { describe, expect, it } from 'vitest';
import { KeywordMatcher } from './KeywordMatcher';

describe('KeywordMatcher', () => {
  it('normalizes case, punctuation, emoji, and whitespace', () => {
    expect(KeywordMatcher.normalizeText('  PROMPT!!! 🚀  please ')).toBe('prompt please');
  });

  it.each([
    ['EXACT', '  LINK! ', ['link'], true],
    ['EXACT', 'send link', ['link'], false],
    ['CONTAINS', 'please send LINK now', ['link'], true],
    ['STARTS_WITH', 'PROMPT please', ['prompt'], true],
    ['STARTS_WITH', 'my prompt', ['prompt'], false],
    ['CASE_SENSITIVE', 'Prompt', ['Prompt'], true],
    ['CASE_SENSITIVE', 'prompt', ['Prompt'], false],
  ] as const)('%s matching handles %s', (mode, comment, keywords, matched) => {
    expect(KeywordMatcher.isMatch(comment, [...keywords], mode, 'KEYWORD').matched).toBe(matched);
  });

  it('matches any non-special comment for ANY_COMMENT and rejects empty keywords', () => {
    expect(KeywordMatcher.isMatch('', [], 'EXACT', 'ANY_COMMENT')).toEqual({ matched: true, matchedKeyword: 'ANY_COMMENT' });
    expect(KeywordMatcher.isMatch('hello', [], 'EXACT', 'KEYWORD')).toEqual({ matched: false });
  });
});
