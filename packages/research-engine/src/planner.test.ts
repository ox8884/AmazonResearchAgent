import { describe, expect, it } from 'vitest';
import { planDailyResearch } from './planner';

const allocation = { new: 60, watch: 30, strong: 10 };

function makeCandidates(): readonly {
  readonly id: string;
  readonly bucket: 'new' | 'watch' | 'strong';
  readonly informationValue: number;
  readonly isFresh: boolean;
}[] {
  return (['new', 'watch', 'strong'] as const).flatMap((bucket) =>
    Array.from({ length: 20 }, (_, index) => ({
      id: `${bucket}-${index + 1}`,
      bucket,
      informationValue: 100 - index,
      isFresh: false
    }))
  );
}

describe('daily research planner', () => {
  // Break: normal capacity no longer preserves the approved 60/30/10 allocation.
  it('allocates ten slots as 6 new, 3 watch, and 1 strong when enough work exists', () => {
    const plan = planDailyResearch(makeCandidates(), { slots: 10, allocation });

    expect(plan.items.filter((item) => item.bucket === 'new')).toHaveLength(6);
    expect(plan.items.filter((item) => item.bucket === 'watch')).toHaveLength(3);
    expect(plan.items.filter((item) => item.bucket === 'strong')).toHaveLength(1);
  });

  // Break: unused capacity is dropped instead of deterministically spilling to eligible work.
  it('spills unused slots in new, watch, then strong order', () => {
    const plan = planDailyResearch(
      [
        ...makeCandidates().filter((candidate) => candidate.bucket === 'new').slice(0, 2),
        ...makeCandidates().filter((candidate) => candidate.bucket === 'watch').slice(0, 20),
        ...makeCandidates().filter((candidate) => candidate.bucket === 'strong').slice(0, 20)
      ],
      { slots: 10, allocation }
    );

    expect(plan.items.filter((item) => item.bucket === 'new')).toHaveLength(2);
    expect(plan.items.filter((item) => item.bucket === 'watch')).toHaveLength(7);
    expect(plan.items.filter((item) => item.bucket === 'strong')).toHaveLength(1);
  });

  // Break: a cached/fresh candidate consumes a paid validation slot.
  it('excludes fresh candidates', () => {
    const plan = planDailyResearch(
      [
        { id: 'fresh-new', bucket: 'new', informationValue: 100, isFresh: true },
        { id: 'stale-new', bucket: 'new', informationValue: 1, isFresh: false }
      ],
      { slots: 1, allocation }
    );

    expect(plan.items.map((item) => item.id)).toEqual(['stale-new']);
  });

  // Break: stale high-potential work loses to lower-information work only because of insertion order.
  it('ranks eligible work by information value before identifier', () => {
    const plan = planDailyResearch(
      [
        { id: 'low', bucket: 'new', informationValue: 10, isFresh: false },
        { id: 'high', bucket: 'new', informationValue: 90, isFresh: false }
      ],
      { slots: 1, allocation }
    );

    expect(plan.items.map((item) => item.id)).toEqual(['high']);
  });
});
