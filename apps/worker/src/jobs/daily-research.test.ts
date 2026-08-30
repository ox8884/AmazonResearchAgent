import { describe, expect, it } from 'vitest';
import {
  DAILY_RESEARCH_PAGE_SIZE,
  canAdvanceDailyResearchCheckpoint,
  collectDailyResearchPages,
  runDailyResearch,
  type DailyResearchQueue,
  type DailyResearchRunRecord,
  type DailyResearchRunStore
} from './daily-research';
import { ResearchPlanBucket, type ResearchPlan } from '@ara/research-engine';
import { ScheduledMarketProbePayloadSchema } from '@ara/shared';
import type { EnqueueJobInput, Job } from '@ara/queue';

const RUN_ID = '00000000-0000-4000-8000-000000000001';
const DATE = '2099-01-01';
const CANDIDATE_A = '00000000-0000-4000-8000-00000000000a';
const PARTIAL_CHECKPOINT = {
  phase: 'fanout' as const,
  selectedItems: [{ id: CANDIDATE_A, bucket: ResearchPlanBucket.new }],
  enqueuedCandidateIds: []
};

const CANDIDATE_B = '00000000-0000-4000-8000-00000000000b';

type QueuedChild = {
  readonly idempotencyKey: string;
  readonly candidateId: string;
};
class InMemoryRunStore implements DailyResearchRunStore {
  readonly publishedPlans: string[][] = [];
  readonly appliedStatuses: string[] = [];
  private run: DailyResearchRunRecord = {
    id: RUN_ID,
    logical_run_date: DATE,
    locale: 'ko',
    status: 'queued',
    selected_candidate_ids: [],
    checkpoint: {}
  };

  async readRun(runId: string): Promise<DailyResearchRunRecord> {
    void runId;
    return structuredClone(this.run);
  }

  async publishPlan(
    _runId: string,
    selectedCandidateIds: readonly string[],
    checkpoint: DailyResearchRunRecord['checkpoint'],
    startedAt: string
  ): Promise<boolean> {
    if (
      JSON.stringify(this.run.selected_candidate_ids) !== '[]' ||
      JSON.stringify(this.run.checkpoint) !== '{}'
    ) {
      return false;
    }
    this.run = {
      ...this.run,
      status: 'fanout',
      started_at: startedAt,
      selected_candidate_ids: [...selectedCandidateIds],
      checkpoint
    };
    this.publishedPlans.push([...selectedCandidateIds]);
    return true;
  }

  async updateRun(
    _runId: string,
    update: Parameters<DailyResearchRunStore['updateRun']>[1]
  ): Promise<boolean> {
    if (!canAdvanceDailyResearchCheckpoint(this.run, update)) {
      return false;
    }
    this.run = { ...this.run, ...update };
    if (typeof update.status === 'string') {
      this.appliedStatuses.push(update.status);
    }
    return true;
  }
}

class DeduplicatingQueue implements DailyResearchQueue {
  readonly jobs = new Map<string, QueuedChild>();
  readonly failOnCandidateId: string | undefined;
  private failed = false;

  constructor(failOnCandidateId?: string) {
    this.failOnCandidateId = failOnCandidateId;
  }

  async enqueueJob(input: EnqueueJobInput): Promise<string> {
    const payload = ScheduledMarketProbePayloadSchema.parse(input.payload);
    if (payload.candidateId === this.failOnCandidateId && !this.failed) {
      this.failed = true;
      throw new Error('fanout failure');
    }
    this.jobs.set(input.idempotencyKey, {
      idempotencyKey: input.idempotencyKey,
      candidateId: payload.candidateId
    });
    return input.idempotencyKey;
  }
}

function orchestratorJob(id: string): Job {
  return {
    id,
    type: 'DAILY_RESEARCH',
    payload: {
      researchRunId: RUN_ID,
      logicalRunDate: DATE,
      locale: 'ko'
    },
    status: 'running',
    priority: 100,
    availableAt: '2099-01-01T00:00:00.000Z',
    leasedUntil: '2099-01-01T00:02:00.000Z',
    leasedBy: 'unit-worker',
    attempts: 1,
    maxAttempts: 5,
    idempotencyKey: `daily-research:${DATE}`,
    checkpoint: {},
    lastError: null,
    createdAt: '2099-01-01T00:00:00.000Z',
    updatedAt: '2099-01-01T00:00:00.000Z'
  };
}

function plan(...ids: readonly string[]): ResearchPlan {
  return {
    items: ids.map((id) => ({ id, bucket: ResearchPlanBucket.new })),
    unfilledSlots: 0
  };
}

function dependencies(
  store: DailyResearchRunStore,
  queue: DailyResearchQueue,
  selectPlan: (now: Date) => Promise<ResearchPlan>
) {
  return {
    queue,
    runStore: store,
    selectPlan,
    now: () => new Date('2099-01-01T12:00:00.000Z')
  };
}
describe('daily research orchestration', () => {
  // Break: concurrent planners can overwrite the selected checkpoint and fan out their private plans.
  it('publishes one immutable plan and emits only its children under concurrent retries', async () => {
    const store = new InMemoryRunStore();
    const queue = new DeduplicatingQueue();
    let plannersReady = 0;
    let releasePlanners: (() => void) | undefined;
    const plannersBarrier = new Promise<void>((resolve) => {
      releasePlanners = resolve;
    });
    const selectPlan = async (): Promise<ResearchPlan> => {
      plannersReady += 1;
      const plannerNumber = plannersReady;
      if (plannersReady === 2) releasePlanners?.();
      await plannersBarrier;
      return plan(plannerNumber === 1 ? CANDIDATE_A : CANDIDATE_B);
    };

    await Promise.all([
      runDailyResearch(orchestratorJob('job-a'), dependencies(store, queue, selectPlan)),
      runDailyResearch(orchestratorJob('job-b'), dependencies(store, queue, selectPlan))
    ]);

    expect(store.publishedPlans).toHaveLength(1);
    const winner = store.publishedPlans[0] ?? [];
    expect(new Set(queue.jobs.values()).size).toBe(1);
    expect([...queue.jobs.values()].map((job) => job.candidateId)).toEqual(winner);
    expect(winner).toHaveLength(1);
    expect([CANDIDATE_A, CANDIDATE_B]).toContain(winner[0]);
  });

  // Break: a worker that loses its durable checkpoint race can still enqueue its unpersisted plan.
  it('does not enqueue children when publishing the plan is not persisted', async () => {
    const queue = new DeduplicatingQueue();
    const store: DailyResearchRunStore = {
      async readRun() {
        return {
          id: RUN_ID,
          logical_run_date: DATE,
          locale: 'ko',
          status: 'queued',
          selected_candidate_ids: [],
          checkpoint: {}
        };
      },
      async publishPlan() {
        return false;
      },
      async updateRun() {
        return true;
      }
    };

    await expect(
      runDailyResearch(
        orchestratorJob('job-lost'),
        dependencies(store, queue, async () => plan(CANDIDATE_A))
      )
    ).rejects.toThrow(/not persisted/u);
    expect(queue.jobs.size).toBe(0);
  });

  // Break: nonempty orchestration runs remain running forever and retries cannot complete fanout.
  it('marks fanout complete only after every child enqueue persists and resumes failed fanout', async () => {
    const store = new InMemoryRunStore();
    const firstQueue = new DeduplicatingQueue(CANDIDATE_B);
    const job = orchestratorJob('job-fanout');

    await expect(
      runDailyResearch(
        job,
        dependencies(store, firstQueue, async () => plan(CANDIDATE_A, CANDIDATE_B))
      )
    ).rejects.toThrow('fanout failure');
    expect(store.publishedPlans).toEqual([[CANDIDATE_A, CANDIDATE_B]]);

    const retryQueue = new DeduplicatingQueue();
    const completed = await runDailyResearch(
      job,
      dependencies(store, retryQueue, async () => plan(CANDIDATE_B))
    );
    expect(completed.phase).toBe('fanout_complete');
    const run = await store.readRun(RUN_ID);
    expect(run.status).toBe('completed');
    expect(run.completed_at).toBe('2099-01-01T12:00:00.000Z');
    expect(
      retryQueue.jobs.has(`daily-research:${RUN_ID}:new:${CANDIDATE_B}`)
    ).toBe(true);
  });

  // Break: paged queries stop at the first page and lose the newest snapshot for later candidates.
  it('collects every page, including a full final page', async () => {
    const rows = Array.from({ length: DAILY_RESEARCH_PAGE_SIZE * 2 }, (_, index) => index);
    const calls: Array<readonly [number, number]> = [];
    const collected = await collectDailyResearchPages(async (from, to) => {
      calls.push([from, to]);
      return { data: rows.slice(from, to + 1), error: null };
    });
    expect(collected).toEqual(rows);
    expect(calls).toEqual([
      [0, DAILY_RESEARCH_PAGE_SIZE - 1],
      [DAILY_RESEARCH_PAGE_SIZE, DAILY_RESEARCH_PAGE_SIZE * 2 - 1],
      [DAILY_RESEARCH_PAGE_SIZE * 2, DAILY_RESEARCH_PAGE_SIZE * 3 - 1]
    ]);
  });

  // Break: a lease-expired worker can overwrite a reclaimer’s completed fanout with older partial progress.
  it('does not let a stale worker regress a completed fanout checkpoint', async () => {
    const store = new InMemoryRunStore();
    const replacementQueue = new DeduplicatingQueue();
    let sawFirstEnqueue: (() => void) | undefined;
    const firstEnqueue = new Promise<void>((resolve) => {
      sawFirstEnqueue = resolve;
    });
    let resumeStale: (() => void) | undefined;
    const holdStale = new Promise<void>((resolve) => {
      resumeStale = resolve;
    });
    const staleQueue: DailyResearchQueue = {
      async enqueueJob(input) {
        const payload = ScheduledMarketProbePayloadSchema.parse(input.payload);
        if (payload.candidateId === CANDIDATE_A) {
          sawFirstEnqueue?.();
          await holdStale;
        }
        return input.idempotencyKey;
      }
    };

    const stale = runDailyResearch(
      orchestratorJob('stale'),
      dependencies(store, staleQueue, async () => plan(CANDIDATE_A, CANDIDATE_B))
    );
    await firstEnqueue;
    await runDailyResearch(
      orchestratorJob('replacement'),
      dependencies(store, replacementQueue, async () => plan(CANDIDATE_A, CANDIDATE_B))
    );
    resumeStale?.();

    const completed = await stale;
    expect(completed.phase).toBe('fanout_complete');
    const firstCompleted = store.appliedStatuses.indexOf('completed');
    expect(firstCompleted).toBeGreaterThanOrEqual(0);
    expect(store.appliedStatuses.slice(firstCompleted + 1)).not.toContain('fanout');
    const run = await store.readRun(RUN_ID);
    expect(run.status).toBe('completed');
    expect(run.checkpoint).toMatchObject({
      phase: 'fanout_complete',
      enqueuedCandidateIds: [CANDIDATE_A, CANDIDATE_B]
    });
  });

  // Break: the migration-019 compatibility path replaces an absent completion time instead of forwarding SQL NULL.
  it('forwards null daily completion unchanged', async () => {
    const rpcCalls: Array<readonly [string, object]> = [];
    const client = {
      rpc: async (name: string, args: object) => {
        rpcCalls.push([name, args]);
        return { data: true, error: null };
      },
      from: (table: string) => {
        if (table === 'research_runs') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: RUN_ID,
                    logical_run_date: DATE,
                    locale: 'ko',
                    status: 'fanout',
                    selected_candidate_ids: [CANDIDATE_A],
                    checkpoint: PARTIAL_CHECKPOINT
                  },
                  error: null
                })
              })
            })
          };
        }
        if (table === 'candidates') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    range: async () => ({ data: [], error: null })
                  })
                })
              })
            })
          };
        }
        return {
          insert: async () => ({ data: null, error: null })
        };
      }
    };

    await runDailyResearch(orchestratorJob('job-null-completion'), {
      client: client as never,
      queue: new DeduplicatingQueue(),
      now: () => new Date('2099-01-01T12:00:00.000Z')
    });

    expect(rpcCalls).toContainEqual([
      'advance_daily_research_checkpoint',
      expect.objectContaining({ next_completed_at: null })
    ]);
    expect(rpcCalls).toContainEqual([
      'advance_daily_research_checkpoint',
      expect.objectContaining({ next_completed_at: '2099-01-01T12:00:00.000Z' })
    ]);
  });
});
