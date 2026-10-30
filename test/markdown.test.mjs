import test from 'node:test';
import assert from 'node:assert/strict';
import { findFormulas, replaceFormulaSpans } from '../src/markdown.mjs';
import { execFileSync } from 'node:child_process';

test('finds only dollar delimiters while skipping code', () => {
  const md = 'a $x$ b $$y\n+z$$ c \\(q\\) d \\[r\\] e \\$no\\$ `\$code\$`\n\n```\n$block$\n```';
  const spans = findFormulas(md);
  assert.deepEqual(spans.map(s => [s.source, s.display]), [['x', false], ['y\n+z', true]]);
});

test('replaces spans without changing surrounding markdown', () => {
  const md = 'before $x$ after';
  const result = replaceFormulaSpans(md, (_span, n) => `![公式 ${n}](formula-assets/formula-${String(n).padStart(3, '0')}.svg)`);
  assert.equal(result.markdown, 'before ![公式 1](formula-assets/formula-001.svg) after');
});

test('offline scanner terminates on incomplete delimiters', () => {
  const moduleUrl = new URL('../src/markdown.mjs', import.meta.url).href;
  const code = `import { findFormulas } from ${JSON.stringify(moduleUrl)};
    for (const text of ['$', '$$', '$unclosed', '$$unclosed', 'text $']) {
      if (findFormulas(text).length) throw new Error('Unexpected formula');
    }`;
  execFileSync(process.execPath, ['--input-type=module', '-e', code], { timeout: 1000 });
});
