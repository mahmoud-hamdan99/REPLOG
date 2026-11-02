import { matchRank, matchesQuery, normalizeSearchText, tokenize } from './normalize';

describe('normalizeSearchText', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeSearchText('  Barbell   Bench  Press ')).toBe('barbell bench press');
  });

  it('strips Latin diacritics', () => {
    expect(normalizeSearchText('Préss')).toBe('press');
    expect(normalizeSearchText('Zweihändig')).toBe('zweihandig');
  });

  it('strips punctuation rather than deleting the gap', () => {
    // "Close-Grip" must still be two tokens, or a prefix search for "grip" fails.
    expect(normalizeSearchText('Close-Grip Bench Press')).toBe('close grip bench press');
    expect(normalizeSearchText('Row (Pronated)')).toBe('row pronated');
  });

  it('returns an empty string for empty input', () => {
    expect(normalizeSearchText('')).toBe('');
    expect(normalizeSearchText('   ')).toBe('');
  });

  describe('Arabic folding', () => {
    it('strips tashkeel', () => {
      // ضَغْط -> ضغط
      expect(normalizeSearchText('ضَغْط')).toBe('ضغط');
    });

    it('strips the tatweel elongation', () => {
      expect(normalizeSearchText('ضغــط')).toBe('ضغط');
    });

    it('folds every alef form together', () => {
      const forms = ['أمامي', 'إمامي', 'آمامي', 'امامي'];
      const normalized = forms.map(normalizeSearchText);
      expect(new Set(normalized).size).toBe(1);
      expect(normalized[0]).toBe('امامي');
    });

    it('folds alef maqsura to ya', () => {
      expect(normalizeSearchText('علي')).toBe(normalizeSearchText('على'));
    });

    it('folds ta marbuta to ha', () => {
      expect(normalizeSearchText('رفرفة')).toBe(normalizeSearchText('رفرفه'));
    });

    it('folds hamza carriers', () => {
      expect(normalizeSearchText('مؤخرة')).toBe(normalizeSearchText('موخرة'));
      expect(normalizeSearchText('جانبئ')).toBe(normalizeSearchText('جانبي'));
    });

    it('folds Arabic-Indic digits to ASCII', () => {
      expect(normalizeSearchText('٤٥ درجة')).toBe('45 درجه');
      expect(normalizeSearchText('۴۵')).toBe('45');
    });
  });
});

describe('tokenize', () => {
  it('splits on normalised whitespace', () => {
    expect(tokenize('Incline  Dumbbell-Press')).toEqual(['incline', 'dumbbell', 'press']);
  });

  it('returns nothing for empty input', () => {
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('matchesQuery', () => {
  const bench = ['Barbell Bench Press', 'ضغط البنش', 'bench', 'bp'];

  it('matches an empty query', () => {
    expect(matchesQuery(bench, '')).toBe(true);
  });

  it('matches a token prefix', () => {
    expect(matchesQuery(bench, 'ben')).toBe(true);
    expect(matchesQuery(bench, 'bar')).toBe(true);
  });

  it('matches across several tokens in any order', () => {
    // How people actually type: initials of the words they remember.
    expect(matchesQuery(bench, 'bb press')).toBe(false);
    expect(matchesQuery(bench, 'barbell press')).toBe(true);
    expect(matchesQuery(bench, 'press barbell')).toBe(true);
  });

  it('matches an alias', () => {
    expect(matchesQuery(bench, 'bp')).toBe(true);
  });

  it('falls back to a mid-word substring', () => {
    expect(matchesQuery(['Incline Press'], 'cline')).toBe(true);
  });

  it('rejects a query that matches nothing', () => {
    expect(matchesQuery(bench, 'squat')).toBe(false);
  });

  it('matches Arabic regardless of diacritics or alef form', () => {
    expect(matchesQuery(bench, 'بنش')).toBe(true);
    expect(matchesQuery(bench, 'ضغط')).toBe(true);
    expect(matchesQuery(bench, 'ضَغْط')).toBe(true);
  });

  it('returns false when there is nothing to search', () => {
    expect(matchesQuery([], 'bench')).toBe(false);
    expect(matchesQuery(['', '  '], 'bench')).toBe(false);
  });
});

describe('matchRank', () => {
  it('ranks an exact name first', () => {
    expect(matchRank('Bench Press', [], 'bench press')).toBe(0);
  });

  it('ranks a name prefix above a mid-name word', () => {
    const prefix = matchRank('Bench Press', [], 'bench');
    const midName = matchRank('Close-Grip Bench Press', [], 'bench');
    expect(prefix).toBeLessThan(midName);
  });

  /**
   * The property the library list depends on: searching "bench" must put
   * "Bench Press" above "Close-Grip Bench Press".
   */
  it('orders a realistic result set the way a user expects', () => {
    const names = ['Close-Grip Bench Press', 'Bench Press', 'Incline Bench Press'];
    const sorted = [...names].sort((a, b) => matchRank(a, [], 'bench') - matchRank(b, [], 'bench'));
    expect(sorted[0]).toBe('Bench Press');
  });

  /**
   * An alias is curated, so an exact alias hit beats an incidental name match.
   * Searching "bench" must find the bench press, not the bench dip whose name
   * merely starts with the word.
   */
  it('ranks an exact alias above a partial name match', () => {
    const aliasHit = matchRank('Barbell Bench Press', ['bench', 'bp'], 'bench');
    const incidentalNameHit = matchRank('Bench Dip', [], 'bench');
    expect(aliasHit).toBeLessThan(incidentalNameHit);
  });

  it('still ranks an exact name above an exact alias', () => {
    const exactName = matchRank('Bench Press', [], 'bench press');
    const exactAlias = matchRank('Barbell Bench Press', ['bench press'], 'bench press');
    expect(exactName).toBeLessThan(exactAlias);
  });

  it('ranks a partial alias below every name match', () => {
    const nameContains = matchRank('Overhead Press', [], 'head');
    const aliasPrefix = matchRank('Something Else', ['headstand'], 'head');
    expect(nameContains).toBeLessThan(aliasPrefix);
  });

  it('gives everything the same rank for an empty query', () => {
    expect(matchRank('Anything', [], '')).toBe(0);
  });

  it('ranks a non-match last', () => {
    expect(matchRank('Bench Press', ['bp'], 'squat')).toBe(7);
  });
});
