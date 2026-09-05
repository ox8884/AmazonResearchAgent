import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueResearchNow } from './research-now';

const rpc = vi.fn();

vi.mock('./database', () => ({
  getServerDatabaseContext: () => ({ client: { rpc } })
}));

describe('enqueueResearchNow', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('uses the atomic database enqueue for a valid Chicago logical date', async () => {
    rpc.mockResolvedValue({
      data: '7a985480-7a5d-4ef1-9648-2f443468e2fe',
      error: null
    });

    await expect(
      enqueueResearchNow('normal', new Date('2026-09-04T12:00:00.000Z'))
    ).resolves.toEqual({ researchRunId: '7a985480-7a5d-4ef1-9648-2f443468e2fe' });

    expect(rpc).toHaveBeenCalledWith('enqueue_manual_research', {
      logical_date: '2026-09-04',
      research_mode: 'normal'
    });
  });
});
