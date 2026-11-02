import {
  achievementKey,
  buildRecords,
  isPrCandidate,
  recordLoadKg,
  type PrContext,
  type PrSet,
} from './prs';
import {
  DELOAD_FRACTION,
  LOWER_BODY_STEP_KG,
  UPPER_BODY_STEP_KG,
  suggestNext,
  type ProgressionInput,
} from './progression';

const CONTEXT: PrContext = {
  exerciseId: 'bench',
  variantKey: 'bench|barbell|bilateral',
  nameSnapshot: 'Bench Press',
  formula: 'epley',
};

let counter = 0;
const day = (index: number) => `2026-0${index}-01T10:00:00.000Z`;

function set(overrides: Partial<PrSet> = {}): PrSet {
  counter += 1;
  const weightKg = overrides.weightKg ?? 100;
  const reps = overrides.reps ?? 5;
  return {
    id: `s${counter}`,
    workoutId: 'w1',
    completedAt: day(1),
    isCompleted: true,
    setType: 'working',
    loadType: 'external',
    weightKg,
    extraWeightKg: null,
    reps,
    volumeKg: weightKg === null || reps === null ? null : weightKg * reps,
    ...overrides,
  };
}

/** The current record of one type, which is what a screen actually shows. */
const current = (sets: readonly PrSet[], prType: string, bucket: number | null = null) =>
  buildRecords(sets, CONTEXT).find(
    (record) => record.prType === prType && record.repBucket === bucket && record.isCurrent === 1,
  );

describe('recordLoadKg', () => {
  it('scores external work on the bar', () => {
    expect(recordLoadKg(set({ weightKg: 95 }))).toBe(95);
  });

  it('scores weighted bodyweight work on the added weight, not the total', () => {
    // A record on the total would arrive free whenever body weight went up.
    expect(
      recordLoadKg(set({ loadType: 'bodyweight-plus', weightKg: null, extraWeightKg: 25 })),
    ).toBe(25);
  });

  it('has no score for loads the lifter does not choose', () => {
    expect(recordLoadKg(set({ loadType: 'bodyweight', weightKg: null }))).toBeNull();
    expect(recordLoadKg(set({ loadType: 'assisted', weightKg: null, extraWeightKg: -20 }))).toBe(
      null,
    );
    expect(recordLoadKg(set({ loadType: 'time', weightKg: null }))).toBeNull();
  });
});

describe('isPrCandidate', () => {
  it('accepts a confirmed working set on a scored load', () => {
    expect(isPrCandidate(set())).toBe(true);
    expect(isPrCandidate(set({ setType: 'backoff' }))).toBe(true);
  });

  it('rejects warm-ups, drop sets and sets taken to failure', () => {
    expect(isPrCandidate(set({ setType: 'warmup' }))).toBe(false);
    expect(isPrCandidate(set({ setType: 'dropset' }))).toBe(false);
    expect(isPrCandidate(set({ setType: 'failure' }))).toBe(false);
  });

  it('rejects anything unconfirmed', () => {
    expect(isPrCandidate(set({ isCompleted: false }))).toBe(false);
    expect(isPrCandidate(set({ completedAt: null }))).toBe(false);
  });

  it('rejects load types that cannot hold a record', () => {
    expect(isPrCandidate(set({ loadType: 'bodyweight' }))).toBe(false);
    expect(isPrCandidate(set({ loadType: 'time' }))).toBe(false);
  });
});

describe('buildRecords', () => {
  it('creates a first record with no previous value', () => {
    const record = current([set({ weightKg: 100, reps: 5 })], 'maxWeight');

    expect(record?.value).toBe(100);
    // Null is what the UI reads as "First record" rather than "New record".
    expect(record?.previousValue).toBeNull();
    expect(record?.previousAchievedAt).toBeNull();
  });

  it('keeps the beaten record and points the new one at it', () => {
    const records = buildRecords(
      [
        set({ weightKg: 100, completedAt: day(1), workoutId: 'w1' }),
        set({ weightKg: 105, completedAt: day(2), workoutId: 'w2' }),
      ],
      CONTEXT,
    ).filter((record) => record.prType === 'maxWeight');

    expect(records).toHaveLength(2);
    expect(records[0]?.isCurrent).toBe(0);
    expect(records[1]).toMatchObject({
      value: 105,
      previousValue: 100,
      previousAchievedAt: day(1),
      isCurrent: 1,
    });
  });

  it('never creates a record for a tie', () => {
    const records = buildRecords(
      [
        set({ weightKg: 100, completedAt: day(1), workoutId: 'w1' }),
        set({ weightKg: 100, completedAt: day(2), workoutId: 'w2' }),
      ],
      CONTEXT,
    ).filter((record) => record.prType === 'maxWeight');

    expect(records).toHaveLength(1);
  });

  it('buckets rep records by the exact load', () => {
    // The criterion: twelve reps at 20 kg is not a rep record over five at
    // 100 kg. They are different buckets and both stand.
    const sets = [
      set({ weightKg: 100, reps: 5, completedAt: day(1), workoutId: 'w1' }),
      set({ weightKg: 20, reps: 12, completedAt: day(2), workoutId: 'w2' }),
    ];

    expect(current(sets, 'maxRepsAtWeight', 100)?.value).toBe(5);
    expect(current(sets, 'maxRepsAtWeight', 20)?.value).toBe(12);
  });

  it('beats a rep record only within its own bucket', () => {
    const sets = [
      set({ weightKg: 100, reps: 5, completedAt: day(1), workoutId: 'w1' }),
      set({ weightKg: 100, reps: 7, completedAt: day(2), workoutId: 'w2' }),
    ];

    expect(current(sets, 'maxRepsAtWeight', 100)).toMatchObject({
      value: 7,
      previousValue: 5,
    });
  });

  it('estimates a one-rep max, marked as an estimate and naming its formula', () => {
    const record = current([set({ weightKg: 100, reps: 5 })], 'estimated1RM');

    expect(record?.value).toBe(116.67);
    expect(record?.isEstimate).toBe(true);
    expect(record?.formula).toBe('epley');
  });

  it('uses the formula it is given', () => {
    const record = buildRecords([set({ weightKg: 100, reps: 5 })], {
      ...CONTEXT,
      formula: 'brzycki',
    }).find((item) => item.prType === 'estimated1RM');

    expect(record?.value).toBe(112.5);
    expect(record?.formula).toBe('brzycki');
  });

  it('estimates nothing above the rep ceiling', () => {
    expect(current([set({ weightKg: 60, reps: 13 })], 'estimated1RM')).toBeUndefined();
  });

  it('does not estimate a one-rep max from added weight', () => {
    const sets = [set({ loadType: 'bodyweight-plus', weightKg: null, extraWeightKg: 25, reps: 5 })];

    expect(current(sets, 'estimated1RM')).toBeUndefined();
    // The added weight still holds its own record.
    expect(current(sets, 'maxWeight')?.value).toBe(25);
  });

  it('records the heaviest single set of work', () => {
    const record = current(
      [
        set({ weightKg: 100, reps: 5, completedAt: day(1), workoutId: 'w1' }),
        set({ weightKg: 80, reps: 10, completedAt: day(2), workoutId: 'w2' }),
      ],
      'maxSetVolume',
    );

    expect(record).toMatchObject({ value: 800, previousValue: 500 });
  });

  it('records the biggest session, attributing it to the session', () => {
    const record = current(
      [
        set({ weightKg: 100, reps: 5, completedAt: day(1), workoutId: 'w1' }),
        set({ weightKg: 100, reps: 5, completedAt: day(2), workoutId: 'w2' }),
        set({ weightKg: 100, reps: 5, completedAt: day(2), workoutId: 'w2' }),
      ],
      'maxSessionVolume',
    );

    expect(record?.value).toBe(1000);
    expect(record?.previousValue).toBe(500);
    expect(record?.workoutId).toBe('w2');
  });

  it('ignores sets that cannot hold a record', () => {
    const records = buildRecords(
      [
        set({ weightKg: 200, setType: 'warmup' }),
        set({ weightKg: 180, isCompleted: false }),
        set({ weightKg: 100 }),
      ],
      CONTEXT,
    );

    // The 200 kg warm-up and the 180 kg unconfirmed row hold nothing; the
    // only record is the one working set that actually happened.
    const maxWeight = records.filter((record) => record.prType === 'maxWeight');
    expect(maxWeight).toHaveLength(1);
    expect(maxWeight[0]?.value).toBe(100);
  });

  it('returns nothing at all for a variant with no qualifying sets', () => {
    expect(buildRecords([set({ setType: 'warmup' })], CONTEXT)).toEqual([]);
    expect(buildRecords([], CONTEXT)).toEqual([]);
  });

  it('marks exactly one record current per type and bucket', () => {
    const records = buildRecords(
      [
        set({ weightKg: 100, reps: 5, completedAt: day(1), workoutId: 'w1' }),
        set({ weightKg: 105, reps: 5, completedAt: day(2), workoutId: 'w2' }),
        set({ weightKg: 100, reps: 8, completedAt: day(3), workoutId: 'w3' }),
      ],
      CONTEXT,
    );

    const groups = new Map<string, number>();
    for (const record of records.filter((item) => item.isCurrent === 1)) {
      const key = `${record.prType}@${record.repBucket ?? ''}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }

    expect([...groups.values()].every((count) => count === 1)).toBe(true);
  });

  it('is deterministic: the same history always produces the same table', () => {
    const history = [
      set({ weightKg: 100, reps: 5, completedAt: day(1), workoutId: 'w1' }),
      set({ weightKg: 100, reps: 6, completedAt: day(2), workoutId: 'w2' }),
      set({ weightKg: 110, reps: 3, completedAt: day(3), workoutId: 'w3' }),
      set({ weightKg: 90, reps: 12, completedAt: day(4), workoutId: 'w4' }),
    ];

    const once = buildRecords(history, CONTEXT).map(achievementKey);
    const shuffled = [history[3], history[0], history[2], history[1]] as PrSet[];
    const twice = buildRecords(shuffled, CONTEXT).map(achievementKey);

    // Input order must not matter: the sets carry their own chronology.
    expect(twice).toEqual(once);
  });
});

// ------------------------------------------------------------- suggestions

const progression = (overrides: Partial<ProgressionInput> = {}): ProgressionInput => ({
  lastSession: [
    { setType: 'working', weightKg: 100, reps: 10 },
    { setType: 'working', weightKg: 100, reps: 10 },
    { setType: 'working', weightKg: 100, reps: 10 },
  ],
  sessionCount: 3,
  targetRepsMin: 8,
  targetRepsMax: 10,
  incrementKg: 2.5,
  isLowerBody: false,
  ...overrides,
});

describe('suggestNext', () => {
  it('offers nothing without history', () => {
    expect(suggestNext(progression({ sessionCount: 0, lastSession: [] }))).toBeNull();
  });

  it('offers nothing when the last session had no working sets', () => {
    expect(
      suggestNext(progression({ lastSession: [{ setType: 'warmup', weightKg: 40, reps: 10 }] })),
    ).toBeNull();
  });

  it('adds weight when every set hit the top of the range', () => {
    const suggestion = suggestNext(progression());

    expect(suggestion).toMatchObject({
      rule: 'increase',
      suggestedWeightKg: 100 + UPPER_BODY_STEP_KG,
      suggestedReps: 8,
      isEstimate: true,
    });
    expect(suggestion?.reasonKey).toBe('suggest.reason.increase');
  });

  it('takes the bigger step on lower-body work', () => {
    const suggestion = suggestNext(progression({ isLowerBody: true, incrementKg: 2.5 }));
    expect(suggestion?.suggestedWeightKg).toBe(100 + LOWER_BODY_STEP_KG);
  });

  it('never jumps by less than the equipment allows', () => {
    const suggestion = suggestNext(progression({ incrementKg: 10 }));
    expect(suggestion?.suggestedWeightKg).toBe(110);
  });

  it('backs off when two or more sets missed the bottom of the range', () => {
    const suggestion = suggestNext(
      progression({
        lastSession: [
          { setType: 'working', weightKg: 100, reps: 8 },
          { setType: 'working', weightKg: 100, reps: 6 },
          { setType: 'working', weightKg: 100, reps: 5 },
        ],
      }),
    );

    expect(suggestion).toMatchObject({
      rule: 'deload',
      suggestedWeightKg: 90,
      suggestedReps: 8,
    });
    expect(suggestion?.reasonParams).toMatchObject({
      sets: 2,
      percent: DELOAD_FRACTION * 100,
    });
  });

  it('does not back off for a single missed set', () => {
    const suggestion = suggestNext(
      progression({
        lastSession: [
          { setType: 'working', weightKg: 100, reps: 9 },
          { setType: 'working', weightKg: 100, reps: 9 },
          { setType: 'working', weightKg: 100, reps: 6 },
        ],
      }),
    );

    expect(suggestion?.rule).toBe('repeat');
  });

  it('holds the load and asks for one more rep mid-range', () => {
    const suggestion = suggestNext(
      progression({
        lastSession: [
          { setType: 'working', weightKg: 100, reps: 9 },
          { setType: 'working', weightKg: 100, reps: 8 },
        ],
      }),
    );

    expect(suggestion).toMatchObject({
      rule: 'repeat',
      suggestedWeightKg: 100,
      suggestedReps: 10,
    });
  });

  it('does not ask for more reps than the range allows', () => {
    const suggestion = suggestNext(
      progression({
        lastSession: [
          { setType: 'working', weightKg: 100, reps: 10 },
          { setType: 'working', weightKg: 100, reps: 8 },
        ],
      }),
    );

    expect(suggestion?.suggestedReps).toBe(10);
  });

  it('progresses from the heaviest working set, not the last one', () => {
    const suggestion = suggestNext(
      progression({
        lastSession: [
          { setType: 'working', weightKg: 100, reps: 10 },
          { setType: 'working', weightKg: 90, reps: 10 },
        ],
      }),
    );

    expect(suggestion?.suggestedWeightKg).toBe(102.5);
  });

  it('works without a rep range at all', () => {
    const suggestion = suggestNext(progression({ targetRepsMin: null, targetRepsMax: null }));

    expect(suggestion).toMatchObject({ rule: 'repeat', suggestedWeightKg: 100, suggestedReps: 11 });
  });

  it('is honest about confidence after one session', () => {
    expect(suggestNext(progression({ sessionCount: 1 }))?.confidence).toBe('low');
    expect(suggestNext(progression({ sessionCount: 2 }))?.confidence).toBe('medium');
    expect(suggestNext(progression({ sessionCount: 5 }))?.confidence).toBe('high');
  });

  it('never deloads below one increment', () => {
    const suggestion = suggestNext(
      progression({
        incrementKg: 2.5,
        lastSession: [
          { setType: 'working', weightKg: 2.5, reps: 2 },
          { setType: 'working', weightKg: 2.5, reps: 2 },
        ],
      }),
    );

    expect(suggestion?.suggestedWeightKg).toBe(2.5);
  });
});
