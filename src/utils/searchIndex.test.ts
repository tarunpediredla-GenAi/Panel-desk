import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSearchEngine,
  extractDirectSpokenAnswer,
  isAlreadyConciseSpokenAnswer,
  isFollowUpQuery,
  searchPdfIndex,
} from './searchIndex';
import type { PdfIndex } from '../types';

const sampleIndex: PdfIndex = {
  fileName: 'Interview_Questions_All_In_One_2026-11-16(2).pdf',
  fileSize: 102400,
  pageCount: 75,
  indexedAt: 1700000000000,
  pages: [
    { pageNumber: 3, lines: ['B3. What is a Python decorator?'], text: 'B3. What is a Python decorator?' },
    {
      pageNumber: 71,
      lines: ['I88. When does Django actually run a QuerySet?'],
      text: 'I88. When does Django actually run a QuerySet?',
    },
  ],
  questions: [
    {
      id: 'B3',
      normalizedId: 'B3',
      question: 'What is a Python decorator?',
      answer:
        'A decorator is a function that takes another function and extends its behavior without modifying the original function.',
      fullPassage:
        'B3. What is a Python decorator?\n\nA decorator is a function that takes another function and extends its behavior without modifying the original function.',
      pageStart: 3,
      pageEnd: 3,
    },
    {
      id: 'I88',
      normalizedId: 'I88',
      question: 'When does Django actually run a QuerySet?',
      answer:
        'Django QuerySets are lazy. Adding a filter only prepares the query, and Django runs the SQL when you evaluate the results such as iterating over the QuerySet or converting it to a list.',
      fullPassage:
        'I88. When does Django actually run a QuerySet?\n\nDjango QuerySets are lazy. Adding a filter only prepares the query, and Django runs the SQL when you evaluate the results such as iterating over the QuerySet or converting it to a list.',
      pageStart: 71,
      pageEnd: 72,
    },
    {
      id: 'A413',
      normalizedId: 'A413',
      question: 'How does Python handle reference cycles in garbage collection?',
      answer:
        'Python uses reference counting plus a generational cyclic garbage collector to find and clean up unreachable reference cycles.',
      fullPassage:
        'A413. How does Python handle reference cycles in garbage collection?\n\nPython uses reference counting plus a generational cyclic garbage collector to find and clean up unreachable reference cycles.',
      pageStart: 75,
      pageEnd: 75,
    },
  ],
};

const engine = buildSearchEngine(sampleIndex);

test('exact ID lookup resolves B3 to page 3 instantaneously', () => {
  const result = searchPdfIndex(engine, 'B3');
  assert.equal(result.matchType, 'exact_id');
  assert.equal(result.exactMatch?.id, 'B3');
  assert.equal(result.exactMatch?.pageStart, 3);

  const prefixed = searchPdfIndex(engine, 'question I88?');
  assert.equal(prefixed.matchType, 'exact_id');
  assert.equal(prefixed.exactMatch?.id, 'I88');
  assert.equal(prefixed.exactMatch?.pageStart, 71);
});

test('natural language Django QuerySet question matches I88 on page 71', () => {
  const result = searchPdfIndex(engine, 'When does Django actually run a QuerySet?');
  assert.equal(result.matchType, 'strong_match');
  assert.equal(result.exactMatch?.id, 'I88');
  assert.equal(result.exactMatch?.pageStart, 71);
});

test('unrelated holiday calendar question returns none with zero matches', () => {
  const result = searchPdfIndex(engine, "What is the institute's holiday calendar?");
  assert.equal(result.matchType, 'none');
  assert.equal(result.exactMatch, null);
  assert.equal(result.candidates.length, 0);
});

test('follow-up detection triggers only when active question exists', () => {
  assert.equal(isFollowUpQuery('Give me an example', true), true);
  assert.equal(isFollowUpQuery('Can you explain that simpler?', true), true);
  assert.equal(isFollowUpQuery('Give me an example', false), false);
  assert.equal(isFollowUpQuery('When does Django actually run a QuerySet?', true), false);
});

test('isAlreadyConciseSpokenAnswer distinguishes clean spoken answers from verbose or code-heavy ones', () => {
  assert.equal(
    isAlreadyConciseSpokenAnswer(
      'Django runs the query when you use the results, like looping over it or converting it to a list. Adding a filter just prepares the query.'
    ),
    true
  );
  assert.equal(
    isAlreadyConciseSpokenAnswer(
      'Use `Model.objects.filter(active=True)` and then run `list(qs);` to evaluate. - Bullet one - Bullet two'
    ),
    false
  );
});

test('extractDirectSpokenAnswer extracts 2-3 clean sentences from multi-page prose and defers code-heavy answers', () => {
  const prose =
    'Django QuerySets are lazy. Creating a QuerySet or chaining methods like filter() and exclude() only prepares the SQL query without hitting the database. Django actually executes the database query only when the QuerySet is evaluated, such as when you iterate over it in a loop. Converting the QuerySet to a list also triggers evaluation.';
  const direct = extractDirectSpokenAnswer(prose);
  assert.ok(direct !== null);
  assert.match(direct!, /lazy/i);
  assert.match(direct!, /evaluated/i);
  assert.equal(extractDirectSpokenAnswer('Run `qs = Model.objects.filter(a=1);` - item 1'), null);
});
