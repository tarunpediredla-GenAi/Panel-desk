import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractLinesFromTextItems,
  parseQuestionsFromPages,
  stripRepeatedHeadersFooters,
} from './pdfParser';
import type { PageText } from '../types';

test('extractLinesFromTextItems orders top-to-bottom and left-to-right', () => {
  const lines = extractLinesFromTextItems([
    { str: 'QuerySet?', x: 180, y: 700, width: 55 },
    { str: 'I88.', x: 40, y: 700, width: 22 },
    { str: 'When does Django run a', x: 66, y: 700, width: 110 },
    { str: 'Django evaluates it lazily.', x: 40, y: 680, width: 140 },
  ]);

  assert.equal(lines.length, 2);
  assert.equal(lines[0], 'I88. When does Django run a QuerySet?');
  assert.equal(lines[1], 'Django evaluates it lazily.');
});

test('parseQuestionsFromPages captures B3, I88, A413 with original page numbers and multi-page continuation', () => {
  const pages: PageText[] = [
    {
      pageNumber: 1,
      lines: [
        'Interview Questions All In One',
        'Table of Contents',
        'B3. What is a Python decorator? ........... 3',
        'I88. When does Django actually run a QuerySet? ........... 71',
        'Page 1 of 75',
      ],
      text: '',
    },
    {
      pageNumber: 3,
      lines: [
        'Interview Questions All In One',
        'B3. What is a Python decorator?',
        'A decorator is a function that wraps another function to extend its behavior without changing its source code.',
        'B4. What is the difference between list and tuple?',
        'Lists are mutable while tuples are immutable sequences.',
        'Page 3 of 75',
      ],
      text: '',
    },
    {
      pageNumber: 71,
      lines: [
        'Interview Questions All In One',
        'I88. When does Django actually run a QuerySet?',
        'Django QuerySets are lazy. Calling filter() or exclude() only builds the SQL query in memory.',
        'The database query executes only when the QuerySet is evaluated, such as during iteration.',
        'Page 71 of 75',
      ],
      text: '',
    },
    {
      pageNumber: 72,
      lines: [
        'Interview Questions All In One',
        'Converting a QuerySet to a list, calling len(), or slicing with a step also triggers evaluation.',
        'S3 buckets are unrelated here and should not start a new question inside this answer.',
        'I89. What is select_related in Django?',
        'select_related performs an SQL JOIN to fetch related foreign-key objects in a single query.',
        'Page 72 of 75',
      ],
      text: '',
    },
    {
      pageNumber: 75,
      lines: [
        'Interview Questions All In One',
        'A413',
        'How does Python garbage collection handle reference cycles?',
        'Answer: Python combines reference counting with a cyclic garbage collector that detects and frees unreachable reference cycles.',
        'Page 75 of 75',
      ],
      text: '',
    },
  ];

  const questions = parseQuestionsFromPages(pages);
  const byId = new Map(questions.map((q) => [q.id, q]));

  assert.ok(byId.has('B3'), 'should find B3');
  assert.equal(byId.get('B3')!.pageStart, 3, 'B3 should point to page 3, not TOC page 1');
  assert.match(byId.get('B3')!.answer, /wraps another function/i);

  assert.ok(byId.has('I88'), 'should find I88');
  assert.equal(byId.get('I88')!.pageStart, 71, 'I88 should keep original page 71');
  assert.equal(byId.get('I88')!.pageEnd, 72, 'I88 should record continuation onto page 72');
  assert.match(byId.get('I88')!.answer, /lazy/i);
  assert.match(byId.get('I88')!.answer, /Converting a QuerySet to a list/i);
  assert.ok(!byId.has('S3'), 'S3 prose acronym must not split answer into a fake question');

  assert.ok(byId.has('A413'), 'should find standalone-line A413');
  assert.equal(byId.get('A413')!.pageStart, 75);
  assert.match(byId.get('A413')!.question, /garbage collection/i);
  assert.match(byId.get('A413')!.answer, /reference counting/i);
});

test('stripRepeatedHeadersFooters removes repeating chrome without stripping question IDs', () => {
  const pages: PageText[] = [1, 2, 3, 4].map((n) => ({
    pageNumber: n,
    lines: ['Interview Handbook 2026', `B${n}. Sample question ${n}?`, `Answer ${n}.`, `Page ${n}`],
    text: '',
  }));

  const stripped = stripRepeatedHeadersFooters(pages);
  assert.equal(stripped[0].lines.includes('Interview Handbook 2026'), false);
  assert.equal(stripped[0].lines.includes('Page 1'), false);
  assert.equal(stripped[0].lines[0], 'B1. Sample question 1?');
});
