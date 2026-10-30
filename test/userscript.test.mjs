import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import MarkdownIt from 'markdown-it';

const script = await fs.readFile(new URL('../userscripts/bilibili-latex-import.user.js', import.meta.url), 'utf8');
function load() {
  const dom = new JSDOM('<div class="ProseMirror"></div>', { runScripts: 'outside-only' });
  const context = dom.getInternalVMContext();
  vm.runInContext(script, context, { timeout: 1000 });
  function call(method, value) {
    context.sample = value;
    return vm.runInContext(`window.biliLatexImport.${method}(sample)`, context, { timeout: 1000 });
  }
  return { dom, call, context };
}

test('scanner terminates on trailing, unmatched and escaped dollars', () => {
  const { dom, call } = load();
  try {
    for (const text of ['$', '$$', 'text $', '$unclosed', '$$unclosed', String.raw`\$x\$`, '$x$ then $']) {
      const spans = call('findDollarSpans', text);
      assert.equal(spans.length, text === '$x$ then $' ? 1 : 0, text);
    }
  } finally { dom.window.close(); }
});

test('example HTML with BR-split display formulas creates three native nodes', async () => {
  const { dom, call } = load();
  try {
    const source = await fs.readFile(new URL('../examples/formula.md', import.meta.url), 'utf8');
    const html = new MarkdownIt({ html: true, breaks: true, linkify: true }).render(source);
    const converted = call('transformHtml', html);
    const doc = new dom.window.DOMParser().parseFromString(converted, 'text/html');
    const formulas = [...doc.querySelectorAll('img[data-type="latex"]')];
    assert.equal(formulas.length, 3);
    assert.equal(formulas[0].parentElement.tagName, 'P');
    assert.equal(formulas[0].parentElement.textContent, '行内公式  可以和文字共存。');
    assert.equal(doc.querySelector('code').textContent, '$not-a-formula$');
    assert.equal(doc.querySelector('pre code').textContent, '$code_should_stay_plain$\n');
    assert.ok(formulas[2].dataset.formula.includes('\\sum'));
    assert.equal(formulas[2].parentElement.style.textAlign, 'center');
    assert.equal(formulas[0].parentElement.style.textAlign, '');
    assert.equal(call('transformHtml', converted), converted);
  } finally { dom.window.close(); }
});

test('only standalone display formulas are centered through both import paths', () => {
  const { dom, call } = load();
  try {
    const parser = new MarkdownIt({ html: true, breaks: true });
    const source = 'before $x$ after\n\n$$y$$\n\ntext $$z$$\n\n$alone$\n\n`$$code$$`';
    for (const markdown of [source, call('protectMarkdown', source)]) {
      const converted = call('transformHtml', parser.render(markdown));
      const doc = new dom.window.DOMParser().parseFromString(converted, 'text/html');
      const formulas = [...doc.querySelectorAll('img[data-type="latex"]')];
      assert.deepEqual(formulas.map(img => img.closest('p')?.style.textAlign || ''), ['', 'center', '', '']);
      assert.equal(formulas.length, 4);
      assert.equal(doc.querySelector('code').textContent, '$$code$$');
      assert.equal(doc.querySelectorAll('[data-bili-md-display]').length, 0);
      assert.equal(call('transformHtml', converted), converted);
    }
  } finally { dom.window.close(); }
});

test('multiple formulas, unmatched dollars and code boundaries remain safe', () => {
  const { dom, call } = load();
  try {
    const html = '<p>A $x$ B $y$ C $</p><p>$$</p><pre>$z$</pre><p>$<code>x</code>$</p>';
    const converted = call('transformHtml', html);
    const doc = new dom.window.DOMParser().parseFromString(converted, 'text/html');
    assert.deepEqual([...doc.querySelectorAll('img')].map(n => n.dataset.formula), ['x', 'y']);
    assert.equal(doc.querySelector('p').textContent, 'A  B  C $');
    assert.equal(doc.querySelector('pre').textContent, '$z$');
    assert.equal(call('transformHtml', '<p>$$</p>'), '<p>$$</p>');
  } finally { dom.window.close(); }
});

test('protected multiline display math reaches capture paste with native alignment and exact TeX', () => {
  const { dom, call } = load();
  try {
    const { window } = dom;
    const parser = new MarkdownIt({ html: true, breaks: true });
    const source = String.raw`\sum_{i=1}^{n} i = \frac{n(n+1)}{2}`;
    const protectedMarkdown = call('protectMarkdown', '$$\n' + source + '\n$$');
    assert.ok(!protectedMarkdown.includes('$'));
    let html = parser.render(protectedMarkdown);
    const event = new window.Event('paste', { bubbles: true });
    Object.defineProperty(event, 'clipboardData', { value: {
      getData: type => type === 'text/html' ? html : '',
      setData: (_type, value) => { html = value; },
    } });
    window.document.querySelector('.ProseMirror').dispatchEvent(event);
    const doc = new window.DOMParser().parseFromString(html, 'text/html');
    const image = doc.querySelector('img[data-type="latex"]');
    assert.equal(image.dataset.formula, source);
    assert.equal(image.parentElement.tagName, 'P');
    assert.equal(image.parentElement.style.textAlign, 'center');
    assert.equal(doc.querySelectorAll('[data-bili-md-display]').length, 0);
  } finally { dom.window.close(); }
});

test('capture listener converts one synchronous import event without redispatch', () => {
  const { dom, context } = load();
  try {
    // Installing twice must not add two active handlers.
    vm.runInContext(script, context, { timeout: 1000 });
    const { window } = dom;
    const editor = window.document.querySelector('.ProseMirror');
    const data = new Map([['text/html', '<p>text $x$ after</p>']]);
    let writes = 0;
    const event = new window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: {
      getData: type => data.get(type) || '',
      setData: (type, value) => { writes++; data.set(type, value); },
    } });
    let received = 0;
    editor.addEventListener('paste', () => {
      received++;
      assert.match(data.get('text/html'), /data-type="latex"/);
    });
    editor.dispatchEvent(event);
    assert.equal(writes, 1);
    assert.equal(received, 1);
    assert.equal(event.defaultPrevented, false);
  } finally { dom.window.close(); }
});

test('import paste unwraps standalone block images without introducing paragraph shells', () => {
  const { dom } = load();
  try {
    const { window } = dom;
    const editor = window.document.querySelector('.ProseMirror');
    const parser = new MarkdownIt({ html: true, breaks: true });
    const image = '<img data-eva-image="enhanced" src="https://i0.hdslb.com/a.png" data-caption="曲线" data-width="720" data-height="320">';
    for (const source of [
      '前文 $p^k$\n\n' + image + '\n\n后文',
      '前文 $p^k$\n\n' + image + '\n\n' + image + '\n\n后文',
      '前文 $p^k$\n\n' + image + '\n' + image + '\n\n后文',
    ]) {
      let html = parser.render(source);
      const event = new window.Event('paste', { bubbles: true });
      Object.defineProperty(event, 'clipboardData', { value: {
        getData: type => type === 'text/html' ? html : '',
        setData: (type, value) => { assert.equal(type, 'text/html'); html = value; },
      } });
      editor.dispatchEvent(event);
      const doc = new window.DOMParser().parseFromString(html, 'text/html');
      assert.equal(doc.querySelectorAll('p').length, 2);
      assert.equal(doc.querySelector('p').textContent, '前文 ');
      assert.equal(doc.querySelector('img[data-type="latex"]').parentElement.tagName, 'P');
      assert.equal(doc.querySelector('img[data-type="latex"]').dataset.formula, 'p^k');
      for (const img of doc.querySelectorAll('img[data-eva-image]')) {
        assert.equal(img.parentElement.tagName, 'BODY');
        assert.equal(img.dataset.caption, '曲线');
        assert.equal(img.dataset.width, '720');
        assert.equal(img.dataset.height, '320');
      }
    }
  } finally { dom.window.close(); }
});

test('image unwrapping preserves intentional empty paragraphs, inline content and code', () => {
  const { dom } = load();
  try {
    const { window } = dom;
    const img = '<img data-eva-image="enhanced" src="https://i0.hdslb.com/a.png">';
    const untouched = '<p><br></p><p>文字' + img + '后文</p><p><img data-type="latex" data-formula="x^2"></p><pre><p>' + img + '</p></pre>';
    let html = untouched + '<p>' + img + '</p>';
    const event = new window.Event('paste', { bubbles: true });
    Object.defineProperty(event, 'clipboardData', { value: {
      getData: () => html, setData: (_type, value) => { html = value; },
    } });
    window.document.querySelector('.ProseMirror').dispatchEvent(event);
    assert.equal(html, untouched + img);
  } finally { dom.window.close(); }
});

test('file import preserves every original TeX through native Markdown preprocessing', async () => {
  const { dom } = load();
  try {
    const { window } = dom;
    const source = await fs.readFile(new URL('../examples/formula.md', import.meta.url), 'utf8');
    const reader = new window.FileReader();
    const read = new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
    });
    reader.readAsText(new window.File([source], 'formula.md'), 'UTF-8');
    const protectedSource = await read;
    assert.equal(reader.result, protectedSource);
    // These are Bilibili's native preprocessors which previously erased powers.
    const preprocessed = protectedSource.replace(/\^([^^]+)\^/g, '$1').replace(/(?<!~)~([^~]+)~(?!~)/g, '$1');
    const html = new MarkdownIt({ html: true, breaks: true }).render(preprocessed);
    const doc = new window.DOMParser().parseFromString(html, 'text/html');
    const formulas = [...doc.querySelectorAll('img[data-type="latex"]')];
    assert.deepEqual(formulas.map(n => n.dataset.formula), [
      String.raw`P(A)=\frac{a}{b}`,
      String.raw`P(X=k)=\binom{n}{k}p^k(1-p)^{n-k}`,
      String.raw`\sum_{i=1}^{n} i = \frac{n(n+1)}{2}`,
    ]);
    assert.equal(doc.querySelector('pre code').textContent, '$code_should_stay_plain$\n');
    assert.equal(doc.querySelector('code').textContent, '$not-a-formula$');
  } finally { dom.window.close(); }
});

test('protection skips tilde fences, escaped dollars and inline code', () => {
  const { dom, call } = load();
  try {
    const md = '~~~md\n$code$\n~~~\n`$inline$`\n\\$escaped\\$\n$x_{a_b}^2$\n$';
    const protectedSource = call('protectMarkdown', md);
    assert.ok(protectedSource.startsWith('~~~md\n$code$\n~~~\n`$inline$`\n\\$escaped\\$\n'));
    assert.equal((protectedSource.match(/data-type="latex"/g) || []).length, 1);
    assert.ok(protectedSource.endsWith('\n$'));
  } finally { dom.window.close(); }
});

test('FileReader changes only named .md reads, and uninstall restores native behavior', async () => {
  const { dom, context } = load();
  try {
    const { window } = dom;
    const read = name => new Promise((resolve, reject) => {
      const reader = new window.FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(new window.File(['$x$'], name));
    });
    assert.equal(await read('plain.txt'), '$x$');
    vm.runInContext(script, context, { timeout: 1000 });
    assert.match(await read('formula.MD'), /data-type="latex"/);
    window.biliLatexImport.uninstall();
    assert.equal(await read('formula.md'), '$x$');
  } finally { dom.window.close(); }
});

test('only a first-line H1 moves out of the body; inline formatting becomes plain title text', () => {
  const { dom } = load();
  try {
    const parser = new MarkdownIt({ html: true });
    const split = text => dom.window.biliLatexImport.splitLeadingTitle(text, parser);
    const result = split('\uFEFF# **文章**与[链接](https://example.com) `代码` #\r\n\r\n正文\r\n# 正文标题');
    assert.equal(result.title, '文章与链接 代码');
    assert.equal(result.markdown, '\r\n正文\r\n# 正文标题');
    for (const text of ['\n# 后面的标题', '## 二级标题', '#没有空格', '\\# 转义标题', '    # 代码', '#   ', '# ###', '```md\n# 代码标题\n```']) {
      assert.equal(split(text).title, null, text);
      assert.equal(split(text).markdown, text, text);
    }
    assert.equal(split('   # 允许的缩进\n正文').title, '允许的缩进');
  } finally { dom.window.close(); }
});

test('ordinary file import applies its leading title only on paste, once, through an input event', async () => {
  const { dom } = load();
  try {
    const { window } = dom;
    const title = window.document.createElement('textarea');
    title.className = 'title-input__inner';
    title.maxLength = 80;
    title.value = '原标题';
    window.document.body.prepend(title);
    const editor = window.document.querySelector('.ProseMirror');
    const parser = new MarkdownIt({ html: true, breaks: true });
    editor.editor = { storage: { importMarkdown: { md: parser } } };
    const reader = new window.FileReader();
    const read = new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
    });
    reader.readAsText(new window.File(['# **文章** $p^k$ ~a~\n\n正文 $x^2$\n\n# 保留的正文标题'], 'test.md'));
    const protectedSource = await read;
    assert.equal(title.value, '原标题');
    assert.equal(reader.result, protectedSource);
    let events = 0;
    title.addEventListener('input', () => { events++; });
    const html = parser.render(protectedSource.replace(/\^([^^]+)\^/g, '$1').replace(/(?<!~)~([^~]+)~(?!~)/g, '$1'));
    const data = new Map([['text/html', html]]);
    const event = new window.Event('paste', { bubbles: true });
    Object.defineProperty(event, 'clipboardData', { value: {
      getData: type => data.get(type) || '', setData: (type, value) => data.set(type, value),
    } });
    editor.dispatchEvent(event);
    assert.equal(title.value, '文章 $p^k$ ~a~');
    assert.equal(events, 1);
    const doc = new window.DOMParser().parseFromString(data.get('text/html'), 'text/html');
    assert.deepEqual([...doc.querySelectorAll('h1')].map(h => h.textContent), ['保留的正文标题']);
    assert.equal(doc.querySelector('img[data-type="latex"]').dataset.formula, 'x^2');
    assert.ok(!data.get('text/html').includes('bili-md-import-title:'));
  } finally { dom.window.close(); }
});

test('ordinary imports preserve the H1 if the title input is unavailable or too short', async () => {
  const { dom } = load();
  try {
    const { window } = dom;
    const title = window.document.createElement('textarea');
    title.className = 'title-input__inner';
    title.maxLength = 2;
    title.value = '旧';
    window.document.body.prepend(title);
    const reader = new window.FileReader();
    const read = new Promise(resolve => { reader.onload = () => resolve(reader.result); });
    reader.readAsText(new window.File(['# 超过限制的标题\n正文'], 'test.md'));
    assert.equal(await read, '# 超过限制的标题\n正文');
    assert.equal(title.value, '旧');
  } finally { dom.window.close(); }
});
