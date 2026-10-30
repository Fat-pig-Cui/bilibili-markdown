import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import MarkdownIt from 'markdown-it';

const script = await fs.readFile(new URL('../userscripts/bilibili-latex-import.user.js', import.meta.url), 'utf8');
function setup() {
  const dom = new JSDOM('<div class="ProseMirror"></div>', {
    runScripts: 'outside-only', url: 'https://member.bilibili.com/york/read-editor',
  });
  const context = dom.getInternalVMContext();
  vm.runInContext(script, context, { timeout: 1000 });
  const api = dom.window.biliLatexImport;
  const parser = new MarkdownIt({ html: true, breaks: true });
  function file(path, content = 'png', type = 'image/png') {
    const result = new dom.window.File([content], path.split('/').pop(), { type });
    Object.defineProperty(result, 'webkitRelativePath', { value: path });
    return result;
  }
  const md = text => file('project/docs/article.md', text, 'text/markdown');
  const result = (id = 1) => ({ url: `https://i0.hdslb.com/bfs/new_dyn/test-${id}.png`, width: 640, height: 360, size: 2.5 });
  return { dom, context, api, parser, file, md, result };
}

test('bundled folder example has three image positions, two files and two native formulas', async () => {
  const s = setup();
  try {
    const base = new URL('../examples/local-images/', import.meta.url);
    const source = await fs.readFile(new URL('article.md', base), 'utf8');
    const files = [s.file('local-images/article.md', source, 'text/markdown')];
    for (const name of ['curve.png', '中文 图(1).png']) {
      const bytes = await fs.readFile(new URL('assets/' + name, base));
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
      files.push(s.file('local-images/assets/' + name, bytes));
    }
    const plan = await s.api.planImport(files, 'local-images/article.md', s.parser);
    assert.equal(plan.occurrences, 3);
    assert.equal(new Set([...plan.entries.values()].map(entry => entry.key)).size, 2);
    const replacements = await s.api.prepareImages(plan, { uploadHandler: async file => s.result(file.name === 'curve.png' ? 1 : 2) });
    const html = s.api.withImageRenderer(s.parser, replacements, () => s.parser.render(plan.markdown));
    const doc = new s.dom.window.DOMParser().parseFromString(html, 'text/html');
    assert.equal(doc.querySelectorAll('img[data-type="latex"]').length, 2);
    assert.equal(doc.querySelectorAll('img[data-eva-image="enhanced"]').length, 3);
  } finally { s.dom.window.close(); }
});

test('resolves reference images, Unicode/space/parenthesis paths and aliases; ignores code and formulas', async () => {
  const s = setup();
  try {
    const source = '# 图文\n\n行内 $x^2$。\n\n![甲](<../assets/中文 图(1).png>)\n\n![乙][ref]\n\n[ref]: ../assets/中文%20图(1).png\n\n`![假图](missing.png)`\n\n```md\n![假图](also-missing.png)\n```\n';
    const plan = await s.api.planImport([s.md(source), s.file('project/assets/中文 图(1).png')], 'project/docs/article.md', s.parser);
    assert.equal(plan.occurrences, 2);
    assert.equal(new Set([...plan.entries.values()].map(entry => entry.key)).size, 1);
    let uploaded = 0;
    const replacements = await s.api.prepareImages(plan, { uploadHandler: async file => {
      uploaded++;
      assert.equal(file.name, '中文 图(1).png');
      return s.result();
    } });
    const html = s.api.withImageRenderer(s.parser, replacements, () => s.parser.render(plan.markdown));
    const doc = new s.dom.window.DOMParser().parseFromString(html, 'text/html');
    assert.equal(uploaded, 1);
    assert.equal(doc.querySelectorAll('img[data-eva-image="enhanced"]').length, 2);
    assert.equal(doc.querySelector('img[data-type="latex"]').dataset.formula, 'x^2');
    assert.equal(doc.querySelector('code').textContent, '![假图](missing.png)');
  } finally { s.dom.window.close(); }
});

test('preflight rejects missing files, traversal, absolute paths, formats, sizes and occurrence limits', async () => {
  const s = setup();
  try {
    for (const [source, images, limits, message] of [
      ['![x](missing.png)', [], {}, /找不到图片/],
      ['![x](../../outside.png)', [], {}, /超出所选文件夹/],
      ['<img src="file:///tmp/x.png">', [], {}, /相对路径/],
      ['<img src="/tmp/x.png">', [], {}, /相对路径/],
      ['![x](../assets/a.svg)', [s.file('project/assets/a.svg', '<svg/>', 'image/svg+xml')], {}, /不支持/],
      ['![x](../assets/a.png)', [s.file('project/assets/a.png', 'too-large')], { maxFileSize: 2 }, /大小限制/],
      ['![x](../assets/a.png) ![x](../assets/a.png)', [s.file('project/assets/a.png')], { limit: 1 }, /2 处图片/],
    ]) {
      await assert.rejects(s.api.planImport([s.md(source), ...images], 'project/docs/article.md', s.parser, limits), message);
    }
    assert.throws(() => s.api.imageSource('%2fetc/passwd', 'project/docs/a.md', 'project'), /路径无效/);
    assert.throws(() => s.api.imageSource('%ZZ.png', 'project/docs/a.md', 'project'), /编码无效/);
  } finally { s.dom.window.close(); }
});

test('HTML images preserve captions; code stays unchanged even when it shares a real image URL', async () => {
  const s = setup();
  try {
    const source = '<div><img src="../assets/a.png" alt="a^b^ &amp; c~d~ &quot;quoted&quot;"></div>\n\n<pre><img src="../assets/a.png"></pre>\n\n<code><img src="../assets/a.png"></code>\n';
    const plan = await s.api.planImport([s.md(source), s.file('project/assets/a.png')], 'project/docs/article.md', s.parser);
    assert.equal(plan.occurrences, 1);
    const replacements = await s.api.prepareImages(plan, { uploadHandler: async () => s.result() });
    const imageRule = s.parser.renderer.rules.image;
    const html = s.api.withImageRenderer(s.parser, replacements, () => s.parser.render(plan.markdown));
    assert.equal(s.parser.renderer.rules.image, imageRule);
    const doc = new s.dom.window.DOMParser().parseFromString(html, 'text/html');
    assert.equal(doc.querySelector('div img').dataset.caption, 'a^b^ & c~d~ "quoted"');
    assert.equal(doc.querySelector('pre img').getAttribute('src'), '../assets/a.png');
    assert.equal(doc.querySelector('code img').getAttribute('src'), '../assets/a.png');
    assert.equal(doc.querySelectorAll('img[data-eva-image="enhanced"]').length, 1);
    assert.throws(() => s.api.withImageRenderer(s.parser, replacements, () => { throw new Error('render failed'); }), /render failed/);
    assert.equal(s.parser.renderer.rules.image, imageRule);
  } finally { s.dom.window.close(); }
});

test('uploads are bounded to two workers, deduplicated and cached; watermark and metadata pass through', async () => {
  const s = setup();
  try {
    const names = ['a', 'b', 'c', 'd'];
    const source = names.map(name => `![${name}](../assets/${name}.png)`).join('\n\n') + '\n\n![again](../assets/a.png)';
    const plan = await s.api.planImport([s.md(source), ...names.map(name => s.file(`project/assets/${name}.png`))], 'project/docs/article.md', s.parser);
    let active = 0, maximum = 0, calls = 0;
    const options = { watermark: true, uploadHandler: async file => {
      calls++; active++; maximum = Math.max(maximum, active);
      assert.equal(file.watermark, true);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--; return s.result(file.name.charCodeAt(0));
    } };
    const replacements = await s.api.prepareImages(plan, options, undefined, undefined, { watermark: true });
    assert.equal(calls, 4);
    assert.equal(maximum, 2);
    assert.equal(replacements.size, 4);
    await s.api.prepareImages(plan, options, undefined, undefined, { watermark: true });
    assert.equal(calls, 4);
  } finally { s.dom.window.close(); }
});

test('watermark defaults off despite native settings; switching modes caches each variant separately', async () => {
  const s = setup();
  try {
    const plan = await s.api.planImport([s.md('![图](../assets/a.png)'), s.file('project/assets/a.png')], 'project/docs/article.md', s.parser);
    const flags = [];
    const options = { watermark: true, uploadHandler: async file => {
      flags.push(file.watermark);
      return s.result(file.watermark ? 2 : 1);
    } };
    const plain = await s.api.prepareImages(plan, options);
    const marked = await s.api.prepareImages(plan, options, undefined, undefined, { watermark: true });
    const plainAgain = await s.api.prepareImages(plan, options, undefined, undefined, { watermark: false });
    await s.api.prepareImages(plan, options, undefined, undefined, { watermark: true });
    assert.deepEqual(flags, [false, true]);
    assert.notEqual(plain.get('../assets/a.png').url, marked.get('../assets/a.png').url);
    assert.equal(plain.get('../assets/a.png').url, plainAgain.get('../assets/a.png').url);
  } finally { s.dom.window.close(); }
});

// A small host emulates the native command's synchronous render / microtask
// commit. This tests coordination, not Bilibili's server or ProseMirror schema.
function host(s, uploadHandler, { dropImages = false } = {}) {
  const title = s.dom.window.document.createElement('textarea');
  title.className = 'title-input__inner';
  title.maxLength = 80;
  title.value = '原标题';
  s.dom.window.document.body.prepend(title);
  function doc(html) {
    return {
      html, eq(other) { return html === other.html; }, toJSON() { return { html }; },
      descendants(fn) {
        const parsed = new s.dom.window.DOMParser().parseFromString(html, 'text/html');
        for (const img of parsed.querySelectorAll('img')) fn({
          type: { name: img.dataset.type === 'latex' ? 'latex' : 'enhancedImage' }, attrs: { src: img.getAttribute('src') },
        });
      },
    };
  }
  const editor = {
    state: { doc: doc('<p>原正文</p>') }, storage: { importMarkdown: { md: s.parser, isImporting: false } },
    extensionManager: { extensions: [{ name: 'biliImage', options: { uploadHandler } }] },
    commits: 0,
    commands: {
      importMarkdown({ content }) {
        const preprocessed = content.replace(/\^([^^]+)\^/g, '$1').replace(/(?<!~)~([^~]+)~(?!~)/g, '$1');
        let html = s.parser.render(preprocessed);
        if (dropImages) html = html.replace(/<img [^>]*>/g, '');
        queueMicrotask(() => {
          // Native import passes rendered HTML through one synthetic paste.
          const event = new s.dom.window.Event('paste', { bubbles: true });
          Object.defineProperty(event, 'clipboardData', { value: {
            getData: type => type === 'text/html' ? html : '',
            setData: (_type, value) => { html = value; },
          } });
          s.dom.window.document.querySelector('.ProseMirror').dispatchEvent(event);
          editor.commits++;
          editor.state.doc = doc(html);
        });
        return true;
      },
      setContent(json) { editor.state.doc = doc(json.html); },
      clearContent() { editor.commits++; editor.state.doc = doc('<p></p>'); return true; },
      updateImageCache() {},
    },
  };
  s.dom.window.document.querySelector('.ProseMirror').editor = editor;
  return { editor, doc, title };
}

test('import coordinator passes the selected watermark mode and overrides native defaults', async () => {
  const s = setup();
  try {
    const flags = [];
    const { editor } = host(s, async file => { flags.push(file.watermark); return s.result(file.watermark ? 2 : 1); });
    editor.extensionManager.extensions[0].options.watermark = true;
    const files = [s.md('![图](../assets/a.png)'), s.file('project/assets/a.png')];
    await s.api.importFiles(files, 'project/docs/article.md');
    await s.api.importFiles(files, 'project/docs/article.md', undefined, undefined, { watermark: true });
    assert.deepEqual(flags, [false, true]);
    const doc = new s.dom.window.DOMParser().parseFromString(editor.state.doc.html, 'text/html');
    assert.equal(doc.querySelector('img').getAttribute('src'), s.result(2).url);
  } finally { s.dom.window.close(); }
});

test('watermark checkbox starts unchecked, controls uploads and is locked while uploading', { timeout: 2000 }, async () => {
  const s = setup();
  try {
    let release, started;
    const ready = new Promise(resolve => { started = resolve; });
    host(s, file => {
      assert.equal(file.watermark, true);
      started();
      return new Promise(resolve => { release = () => resolve(s.result()); });
    });
    const document = s.dom.window.document;
    document.querySelector('#bili-md-image-import').click();
    const panel = document.querySelector('#bili-md-image-panel');
    const checkbox = panel.querySelector('[data-option="watermark"]');
    assert.equal(checkbox.checked, false);
    checkbox.checked = true;
    const input = panel.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { value: [s.md('![图](../assets/a.png)'), s.file('project/assets/a.png')] });
    input.dispatchEvent(new s.dom.window.Event('change'));
    const button = panel.querySelector('[data-action="import"]');
    const deadline = Date.now() + 1000;
    while (button.disabled && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(button.disabled, false);
    const imported = button.onclick();
    await ready;
    assert.equal(checkbox.disabled, true);
    release();
    await imported;
    assert.equal(checkbox.disabled, false);
    assert.match(panel.querySelector('[role="status"]').textContent, /导入完成/);
  } finally { s.dom.window.close(); }
});

test('both panel close buttons close the panel and the launcher reopens it', () => {
  const s = setup();
  try {
    const document = s.dom.window.document;
    const launcher = document.querySelector('#bili-md-image-import');
    launcher.click();
    const panel = document.querySelector('#bili-md-image-panel');
    for (const action of ['close', 'dismiss']) {
      assert.equal(panel.hidden, false);
      panel.querySelector(`[data-action="${action}"]`).click();
      assert.equal(panel.hidden, true);
      launcher.click();
      assert.equal(panel.hidden, false);
      assert.equal(panel.querySelector('[data-action="dismiss"]').textContent, '×');
    }
  } finally { s.dom.window.close(); }
});

test('folder import moves the first H1 into the article title after committing images', async () => {
  const s = setup();
  try {
    const { editor, title } = host(s, async () => {
      assert.equal(title.value, '原标题');
      return s.result();
    });
    let updates = 0;
    title.addEventListener('input', () => updates++);
    await s.api.importFiles([s.md('# **新标题**\n\n正文 $x^2$\n\n![图](../assets/a.png)\n\n# 正文小节'), s.file('project/assets/a.png')], 'project/docs/article.md');
    assert.equal(title.value, '新标题');
    assert.equal(updates, 1);
    const doc = new s.dom.window.DOMParser().parseFromString(editor.state.doc.html, 'text/html');
    assert.deepEqual([...doc.querySelectorAll('h1')].map(h => h.textContent), ['正文小节']);
    assert.equal(doc.querySelector('img[data-type="latex"]').dataset.formula, 'x^2');
  } finally { s.dom.window.close(); }
});

test('failed folder imports and edits during upload preserve the article title', async () => {
  for (const mode of ['upload', 'edit', 'images', 'long']) {
    const s = setup();
    try {
      const { editor, title } = host(s, async () => {
        if (mode === 'upload') throw new Error('upload failed');
        if (mode === 'edit') title.value = '用户修改的标题';
        return s.result();
      }, { dropImages: mode === 'images' });
      if (mode === 'long') title.maxLength = 2;
      await assert.rejects(s.api.importFiles([s.md('# 要移入专栏的新标题\n\n![图](../assets/a.png)'), s.file('project/assets/a.png')], 'project/docs/article.md'));
      assert.equal(title.value, mode === 'edit' ? '用户修改的标题' : '原标题');
      assert.equal(editor.state.doc.html, '<p>原正文</p>');
    } finally { s.dom.window.close(); }
  }
});

test('a title-only document moves into the title and clears the body', async () => {
  const s = setup();
  try {
    const { editor, title } = host(s, async () => s.result());
    await s.api.importFiles([s.md('# 只有标题')], 'project/docs/article.md');
    assert.equal(title.value, '只有标题');
    assert.equal(editor.state.doc.html, '<p></p>');
  } finally { s.dom.window.close(); }
});

test('full coordination imports mixed formulas and repeated images through the native command', async () => {
  const s = setup();
  try {
    let calls = 0;
    const { editor } = host(s, async () => { calls++; return s.result(); });
    const source = '文字 $p^k(1-p)^{n-k}$ 文字。\n\n![甲](../assets/a.png)\n\n![乙](../assets/a.png)';
    const result = await s.api.importFiles([s.md(source), s.file('project/assets/a.png')], 'project/docs/article.md');
    assert.equal(result.images, 2);
    assert.equal(calls, 1);
    assert.equal(editor.commits, 1);
    const doc = new s.dom.window.DOMParser().parseFromString(editor.state.doc.html, 'text/html');
    assert.equal(doc.querySelector('img[data-type="latex"]').dataset.formula, 'p^k(1-p)^{n-k}');
    assert.equal(doc.querySelectorAll('img[data-eva-image="enhanced"]').length, 2);
    assert.equal(doc.querySelectorAll('p').length, 1);
    assert.equal(doc.querySelectorAll('body > img[data-eva-image="enhanced"]').length, 2);
  } finally { s.dom.window.close(); }
});

test('missing file, rejected upload and an edit during upload never replace the original text', async () => {
  for (const mode of ['missing', 'reject', 'edit']) {
    const s = setup();
    try {
      const { editor, doc } = host(s, async () => {
        if (mode === 'reject') throw new Error('server unavailable');
        if (mode === 'edit') editor.state.doc = doc('<p>用户刚修改的正文</p>');
        return s.result();
      });
      const files = [s.md('![图](../assets/a.png)'), ...(mode === 'missing' ? [] : [s.file('project/assets/a.png')])];
      await assert.rejects(s.api.importFiles(files, 'project/docs/article.md'), mode === 'missing' ? /找不到/ : mode === 'reject' ? /server unavailable/ : /正文发生了修改/);
      assert.equal(editor.commits, 0);
      assert.equal(editor.state.doc.html, mode === 'edit' ? '<p>用户刚修改的正文</p>' : '<p>原正文</p>');
    } finally { s.dom.window.close(); }
  }
});

test('cancellation stops waiting for an in-flight upload and never commits', async () => {
  const s = setup();
  try {
    const controller = new s.dom.window.AbortController();
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const { editor } = host(s, () => { started(); return new Promise(() => {}); });
    const pending = s.api.importFiles([s.md('![图](../assets/a.png)'), s.file('project/assets/a.png')], 'project/docs/article.md', controller.signal);
    await ready;
    controller.abort();
    await assert.rejects(pending, /取消/);
    assert.equal(editor.commits, 0);
    assert.equal(editor.state.doc.html, '<p>原正文</p>');
  } finally { s.dom.window.close(); }
});

test('unexpected native image loss restores the original document', async () => {
  const s = setup();
  try {
    const { editor } = host(s, async () => s.result(), { dropImages: true });
    await assert.rejects(s.api.importFiles([s.md('![图](../assets/a.png)'), s.file('project/assets/a.png')], 'project/docs/article.md'), /已还原/);
    assert.equal(editor.state.doc.html, '<p>原正文</p>');
  } finally { s.dom.window.close(); }
});

test('reinstallation leaves one launcher; uninstall removes UI and rejects further imports', async () => {
  const s = setup();
  try {
    s.dom.window.document.querySelector('#bili-md-image-import').click();
    assert.ok(s.dom.window.document.querySelector('#bili-md-image-panel'));
    vm.runInContext(script, s.context, { timeout: 1000 });
    assert.equal(s.dom.window.document.querySelectorAll('#bili-md-image-import').length, 1);
    assert.equal(s.dom.window.document.querySelectorAll('#bili-md-image-panel').length, 0);
    s.dom.window.biliLatexImport.uninstall();
    assert.equal(s.dom.window.document.querySelectorAll('#bili-md-image-import').length, 0);
    await assert.rejects(s.api.importFiles([], 'x.md'), /取消/);
  } finally { s.dom.window.close(); }
});
