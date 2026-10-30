import test from 'node:test';
import assert from 'node:assert/strict';
import { renderFormula } from '../src/formula.mjs';

test('renders TeX to standalone SVG', () => {
  const result = renderFormula(String.raw`\frac{a}{b}`, true);
  assert.match(result.markup, /^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(result.markup, /aria-label="\\frac\{a\}\{b\}"/);
  assert.match(result.markup, /viewBox=/);
});
