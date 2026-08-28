export const ResearchPlanBucket = {
  new: 'new',
  watch: 'watch',
  strong: 'strong'
} as const;

export type ResearchPlanBucket =
  (typeof ResearchPlanBucket)[keyof typeof ResearchPlanBucket];

export type DailyResearchCandidate = {
  readonly id: string;
  readonly bucket: ResearchPlanBucket;
  readonly informationValue: number;
  readonly isFresh: boolean;
};

export type DailyResearchAllocation = Readonly<
  Record<ResearchPlanBucket, number>
>;

export type DailyResearchPlanInput = {
  readonly slots: number;
  readonly allocation: DailyResearchAllocation;
};

export type ResearchPlanItem = Pick<DailyResearchCandidate, 'id' | 'bucket'>;

export type ResearchPlan = {
  readonly items: readonly ResearchPlanItem[];
  readonly unfilledSlots: number;
};

const BUCKETS = [
  ResearchPlanBucket.new,
  ResearchPlanBucket.watch,
  ResearchPlanBucket.strong
] as const;

function compareCandidates(
  left: DailyResearchCandidate,
  right: DailyResearchCandidate
): number {
  return (
    right.informationValue - left.informationValue ||
    left.id.localeCompare(right.id)
  );
}

function calculateQuotas(input: DailyResearchPlanInput): DailyResearchAllocation {
  if (!Number.isInteger(input.slots) || input.slots < 0) {
    throw new RangeError('Daily research slots must be a non-negative integer.');
  }

  const totalPercent = BUCKETS.reduce(
    (total, bucket) => total + input.allocation[bucket],
    0
  );
  if (totalPercent !== 100) {
    throw new RangeError('Daily research allocation must total 100.');
  }

  const quotaEntries = BUCKETS.map((bucket) => {
    const exact = (input.slots * input.allocation[bucket]) / 100;
    return {
      bucket,
      quota: Math.floor(exact),
      remainder: exact - Math.floor(exact)
    };
  });
  let remaining =
    input.slots - quotaEntries.reduce((sum, entry) => sum + entry.quota, 0);

  for (const entry of [...quotaEntries].sort(
    (left, right) =>
      right.remainder - left.remainder ||
      BUCKETS.indexOf(left.bucket) - BUCKETS.indexOf(right.bucket)
  )) {
    if (remaining === 0) {
      break;
    }
    entry.quota += 1;
    remaining -= 1;
  }

  const quotas: Record<ResearchPlanBucket, number> = {
    [ResearchPlanBucket.new]: 0,
    [ResearchPlanBucket.watch]: 0,
    [ResearchPlanBucket.strong]: 0
  };
  for (const entry of quotaEntries) {
    quotas[entry.bucket] = entry.quota;
  }
  return quotas;
}

export function planDailyResearch(
  candidates: readonly DailyResearchCandidate[],
  input: DailyResearchPlanInput
): ResearchPlan {
  const quotas = calculateQuotas(input);
  const eligibleByBucket: Record<
    ResearchPlanBucket,
    readonly DailyResearchCandidate[]
  > = {
    [ResearchPlanBucket.new]: candidates
      .filter(
        (candidate) =>
          candidate.bucket === ResearchPlanBucket.new && !candidate.isFresh
      )
      .sort(compareCandidates),
    [ResearchPlanBucket.watch]: candidates
      .filter(
        (candidate) =>
          candidate.bucket === ResearchPlanBucket.watch && !candidate.isFresh
      )
      .sort(compareCandidates),
    [ResearchPlanBucket.strong]: candidates
      .filter(
        (candidate) =>
          candidate.bucket === ResearchPlanBucket.strong && !candidate.isFresh
      )
      .sort(compareCandidates)
  };
  const selected: DailyResearchCandidate[] = [];
  const selectedIds = new Set<string>();

  for (const bucket of BUCKETS) {
    for (const candidate of eligibleByBucket[bucket].slice(0, quotas[bucket])) {
      selected.push(candidate);
      selectedIds.add(candidate.id);
    }
  }

  for (const bucket of BUCKETS) {
    if (selected.length === input.slots) {
      break;
    }
    for (const candidate of eligibleByBucket[bucket]) {
      if (selected.length === input.slots) {
        break;
      }
      if (!selectedIds.has(candidate.id)) {
        selected.push(candidate);
        selectedIds.add(candidate.id);
      }
    }
  }

  return {
    items: selected.map(({ id, bucket }) => ({ id, bucket })),
    unfilledSlots: input.slots - selected.length
  };
}
