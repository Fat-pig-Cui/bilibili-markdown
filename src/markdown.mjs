// 只处理美元分隔符；其它 TeX 分隔符应先归一化，避免误判正文。
const OPENERS = ['$$', '$'];

function isEscaped(text, index) {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) slashes++;
  return slashes % 2 === 1;
}

function closingFor(opener) {
  return opener;
}

/**
 * Find formula spans while ignoring fenced code blocks and inline code spans.
 * The returned end index is exclusive and includes delimiters.
 */
export function findFormulas(markdown) {
  const spans = [];
  let i = 0;
  let fence = null;
  let codeTicks = 0;
  while (i < markdown.length) {
    if (fence) {
      const lineEnd = markdown.indexOf('\n', i);
      const end = lineEnd < 0 ? markdown.length : lineEnd + 1;
      const line = markdown.slice(i, end);
      const m = line.match(/^\s*(`{3,}|~{3,})/);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      i = end;
      continue;
    }
    if (codeTicks) {
      if (markdown.startsWith('`'.repeat(codeTicks), i) && !isEscaped(markdown, i)) {
        i += codeTicks; codeTicks = 0;
      } else i++;
      continue;
    }
    if (markdown[i] === '`' && !isEscaped(markdown, i)) {
      let j = i; while (markdown[j] === '`') j++;
      codeTicks = j - i; i = j; continue;
    }
    if (i === 0 || markdown[i - 1] === '\n') {
      const line = markdown.slice(i);
      const m = line.match(/^\s*(`{3,}|~{3,})/);
      if (m) { fence = m[1]; i += m[0].length; continue; }
    }
    let opener = OPENERS.find(x => markdown.startsWith(x, i) && !isEscaped(markdown, i));
    if (!opener || (opener === '$' && (markdown[i + 1] === '$' || markdown[i - 1] === '$'))) { i++; continue; }
    const close = closingFor(opener);
    const start = i;
    i += opener.length;
    let j = i;
    while (j < markdown.length) {
      const k = markdown.indexOf(close, j);
      if (k < 0) break;
      if (!isEscaped(markdown, k) && !(close === '$' && markdown[k + 1] === '$')) {
        const source = markdown.slice(start + opener.length, k);
        if (source.trim()) spans.push({ start, end: k + close.length, source, display: opener === '$$' });
        i = k + close.length;
        break;
      }
      j = k + close.length;
    }
  }
  return spans;
}

export function replaceFormulaSpans(markdown, replacement) {
  const spans = findFormulas(markdown);
  let out = ''; let cursor = 0;
  for (const span of spans) {
    out += markdown.slice(cursor, span.start);
    out += replacement(span, spans.indexOf(span) + 1);
    cursor = span.end;
  }
  return { markdown: out + markdown.slice(cursor), spans };
}
