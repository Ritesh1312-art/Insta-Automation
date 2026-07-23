export type MatchingMode = 'EXACT' | 'CONTAINS' | 'STARTS_WITH' | 'CASE_SENSITIVE';

export class KeywordMatcher {
  /**
   * Cleans and normalizes string for matching (removes extra spaces, converts to lowercase)
   */
  public static normalizeText(text: string): string {
    if (!text) return '';
    return text
      .toLowerCase()
      .trim()
      .replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, '')
      .replace(/\s+/g, ' ');
  }

  /**
   * Checks if comment text matches configured keywords according to mode
   */
  public static isMatch(
    commentText: string,
    keywords: string[],
    mode: MatchingMode,
    triggerType: 'ANY_COMMENT' | 'KEYWORD'
  ): { matched: boolean; matchedKeyword?: string } {
    if (triggerType === 'ANY_COMMENT') {
      return { matched: true, matchedKeyword: 'ANY_COMMENT' };
    }

    if (!keywords || keywords.length === 0) {
      return { matched: false };
    }

    const normalizedComment = this.normalizeText(commentText);

    for (const rawKeyword of keywords) {
      if (mode === 'CASE_SENSITIVE') {
        if (commentText.trim() === rawKeyword.trim()) {
          return { matched: true, matchedKeyword: rawKeyword };
        }
      } else {
        const normalizedKeyword = this.normalizeText(rawKeyword);
        if (!normalizedKeyword) continue;

        if (mode === 'EXACT') {
          if (normalizedComment === normalizedKeyword) {
            return { matched: true, matchedKeyword: rawKeyword };
          }
        } else if (mode === 'CONTAINS') {
          if (normalizedComment.includes(normalizedKeyword)) {
            return { matched: true, matchedKeyword: rawKeyword };
          }
        } else if (mode === 'STARTS_WITH') {
          if (normalizedComment.startsWith(normalizedKeyword)) {
            return { matched: true, matchedKeyword: rawKeyword };
          }
        }
      }
    }

    return { matched: false };
  }
}
