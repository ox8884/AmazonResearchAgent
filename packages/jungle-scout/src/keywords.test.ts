import { describe, expect, it } from 'vitest';
import { buildKeywordRequest } from './keywords';

describe('Jungle Scout keyword adapter', () => {
  // Break: keyword validation is sent as a Product Database catalog phrase query.
  it('builds a keyword-by-keyword request', () => {
    const request = buildKeywordRequest({
      marketplace: 'us',
      keyword: 'sink splash guard'
    });
    expect(request.method).toBe('GET');
    expect(request.path).toContain('/api/keywords/by_keyword');
    expect(request.path).toContain('marketplace=us');
    expect(request.path).toContain('sink+splash+guard');
  });
});
