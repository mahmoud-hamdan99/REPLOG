import { columnsOf, csvFileName, escapeCell, toCell, toCsv } from './csv';

/**
 * CSV looks like "join the values with commas" and is not.
 *
 * Everything here is a case where the naive version produces a file that
 * opens, looks plausible and is wrong — which is worse than one that fails to
 * open, because nobody checks.
 */
describe('csv', () => {
  describe('escapeCell', () => {
    it('quotes a value containing the separator', () => {
      expect(escapeCell('Bench, then squat')).toBe('"Bench, then squat"');
    });

    it('doubles quotes inside a quoted value', () => {
      expect(escapeCell('said "easy"')).toBe('"said ""easy"""');
    });

    it('quotes a value containing a newline', () => {
      expect(escapeCell('line one\nline two')).toBe('"line one\nline two"');
    });

    it('leaves an ordinary value alone', () => {
      expect(escapeCell('barbell-bench-press')).toBe('barbell-bench-press');
    });

    it.each(['=1+1', '+1', '-1', '@SUM(A1)'])(
      'defuses %s so a spreadsheet does not run it',
      (raw) => {
        const cell = escapeCell(raw);

        // Quoted, because the tab that defuses it is itself a character that
        // needs quoting, and the original text is still readable inside.
        expect(cell.startsWith('"\t')).toBe(true);
        expect(cell).toContain(raw);
      },
    );

    it('defuses a formula a user typed as a note', () => {
      // The realistic case: not an attack, just someone starting a note with
      // a minus sign. Excel would show #NAME? where their words should be.
      expect(escapeCell('-10kg from last week')).toBe('"\t-10kg from last week"');
    });
  });

  describe('toCell', () => {
    it('renders null and undefined as empty', () => {
      expect(toCell(null)).toBe('');
      expect(toCell(undefined)).toBe('');
    });

    it('renders zero and false rather than treating them as absent', () => {
      // The bug this prevents: a falsy check here would blank every
      // "0 reps" and every isCompleted: false in the file.
      expect(toCell(0)).toBe('0');
      expect(toCell(false)).toBe('false');
    });

    it('renders a nested object as JSON rather than [object Object]', () => {
      expect(toCell({ 'custom-1': 42 })).toBe('{"custom-1":42}');
    });
  });

  describe('columnsOf', () => {
    it('unions the keys of every row, in first-seen order', () => {
      // Sparse records are the normal case for measurements: taking the first
      // row's keys as the header would drop every column it happens to omit.
      const columns = columnsOf([
        { id: '1', weightKg: 80 },
        { id: '2', waistCm: 86 },
      ]);

      expect(columns).toEqual(['id', 'weightKg', 'waistCm']);
    });
  });

  describe('toCsv', () => {
    it('writes a byte-order mark so Excel reads it as UTF-8', () => {
      // Without this an Arabic note arrives as mojibake, which is the one
      // thing a bilingual app cannot ship.
      const csv = toCsv([{ notes: 'تمرين ثقيل' }]);

      expect(csv.startsWith('﻿')).toBe(true);
      expect(csv).toContain('تمرين ثقيل');
    });

    it('separates rows with CRLF', () => {
      expect(toCsv([{ a: '1' }])).toBe('﻿a\r\n1\r\n');
    });

    it('fills a missing key with an empty cell rather than shifting the row', () => {
      const csv = toCsv([{ id: '1', weightKg: 80 }, { id: '2' }]);

      expect(csv).toBe('﻿id,weightKg\r\n1,80\r\n2,\r\n');
    });

    it('returns the header alone for an empty store', () => {
      // "Nothing here yet" rather than a zero-byte file that reads as a bug.
      expect(toCsv([], ['id', 'weightKg'])).toBe('﻿id,weightKg\r\n');
    });
  });

  describe('csvFileName', () => {
    it('names the file after the store and the day, sortably', () => {
      expect(csvFileName('setLogs', new Date(2026, 10, 4, 9, 30))).toBe(
        'replog-setLogs-2026-11-04.csv',
      );
    });
  });
});
