import assert from 'node:assert/strict';
import test from 'node:test';

import { mineHabits } from '../../src/core/profiling/HabitMiner.ts';

test('mineHabits returns empty patterns when there is no usable history', () => {
  assert.doesNotThrow(() => mineHabits([], 'w'));

  const result = mineHabits([], 'w');
  assert.deepEqual(result.patterns, []);
  assert.deepEqual(result.weaknessRanking, []);
});
