// ==UserScript==
// @name         Bilibili 专栏 Markdown 公式与本地图片导入
// @namespace    https://github.com/Fat-pig-Cui/bilibili-markdown
// @version      0.3.3
// @description  保留 Markdown 原生公式，将表格转为图片，并上传文档引用的本地图片
// @match        https://member.bilibili.com/york/read-draft*
// @match        https://member.bilibili.com/york/read-editor*
// @author       Fat-pig-Cui
// @license      MIT
// @homepageURL  https://github.com/Fat-pig-Cui/bilibili-markdown
// @supportURL   https://github.com/Fat-pig-Cui/bilibili-markdown/issues
// @updateURL    https://github.com/Fat-pig-Cui/bilibili-markdown/releases/latest/download/bilibili-latex-import.user.js
// @downloadURL  https://github.com/Fat-pig-Cui/bilibili-markdown/releases/latest/download/bilibili-latex-import.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==
(() => {
  'use strict';

  const MATHJAX_ENDPOINT = 'https://api.bilibili.com/x/web-frontend/mathjax/tex?formula=';
  const VERSION = '0.3.3';
  // Re-running from Console must not leave multiple listeners behind.
  window.biliLatexImport?.uninstall?.();

  function escaped(text, index) {
    let count = 0;
    for (let i = index - 1; i >= 0 && text[i] === '\\'; i -= 1) count += 1;
    return count % 2 === 1;
  }

  function findDollarSpans(text) {
    const spans = [];
    let i = 0;
    while (i < text.length) {
      if (text[i] !== '$' || escaped(text, i)) { i += 1; continue; }
      const display = text.startsWith('$$', i);
      const delimiter = display ? '$$' : '$';
      if (!display && (text[i - 1] === '$' || text[i + 1] === '$')) { i += 1; continue; }
      const start = i;
      // Advance before searching: even a lone delimiter at EOF must terminate.
      i += delimiter.length;
      let end = i;
      while (end < text.length) {
        end = text.indexOf(delimiter, end);
        if (end < 0) break;
        if (!escaped(text, end) && (display || text[end + 1] !== '$')) {
          const source = text.slice(start + delimiter.length, end);
          if (source.trim()) spans.push({ start, end: end + delimiter.length, source: source.trim(), display });
          i = end + delimiter.length;
          break;
        }
        end += delimiter.length;
      }
    }
    return spans;
  }

  // Protect formulas before Bilibili's preprocessing removes ^...^ / ~...~
  // or markdown-it interprets TeX backslashes and underscores as Markdown.
  function protectMarkdown(markdown) {
    const spans = [];
    let start = 0;
    let i = 0;
    function scan(end) {
      for (const span of findDollarSpans(markdown.slice(start, end))) {
        spans.push({ ...span, start: start + span.start, end: start + span.end });
      }
    }
    while (i < markdown.length) {
      if (i === 0 || markdown[i - 1] === '\n') {
        const fence = markdown.slice(i).match(/^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/);
        if (fence) {
          scan(i);
          const closing = new RegExp('^ {0,3}' + fence[1][0] + '{' + fence[1].length + ',}[ \\t]*\\r?$', 'gm');
          closing.lastIndex = i + fence[0].length;
          const match = closing.exec(markdown);
          i = match ? match.index + match[0].length : markdown.length;
          start = i;
          continue;
        }
      }
      if (markdown[i] === '`' && !escaped(markdown, i)) {
        let end = i;
        while (markdown[end] === '`') end++;
        const ticks = markdown.slice(i, end);
        let close = markdown.indexOf(ticks, end);
        while (close >= 0 && (markdown[close - 1] === '`' || markdown[close + ticks.length] === '`')) {
          close = markdown.indexOf(ticks, close + ticks.length);
        }
        if (close >= 0) {
          scan(i);
          i = close + ticks.length;
          start = i;
          continue;
        }
        i = end;
      } else i++;
    }
    scan(markdown.length);
    function attr(value) {
      // All characters are entities so Bilibili cannot strip ^ or ~ inside
      // attributes either. DOMParser restores the exact original TeX later.
      return [...value].map(ch => '&#' + ch.codePointAt(0) + ';').join('');
    }
    let output = markdown;
    for (const span of spans.reverse()) {
      const image = '<img data-type="latex"' + (span.display ? ' data-bili-md-display="true"' : '') + ' data-formula="' + attr(span.source) +
        '" alt="' + attr(span.source) + '" src="' + attr(MATHJAX_ENDPOINT + encodeURIComponent(span.source)) + '">';
      output = output.slice(0, span.start) + image + output.slice(span.end);
    }
    return output;
  }

  function splitLeadingTitle(markdown, parser) {
    // Only the first physical line is eligible; an indented code block,
    // escaped hash, or a later heading must remain in the article body.
    const match = markdown.match(/^\uFEFF? {0,3}#[ \t]+([^\r\n]*)(?:\r\n|\n|\r|$)/);
    if (!match) return { title: null, markdown };
    const heading = match[1].replace(/(?:^|[ \t]+)#+[ \t]*$/, '').trim();
    if (!heading) return { title: null, markdown };
    const title = parser
      ? new DOMParser().parseFromString(parser.renderInline(heading), 'text/html').body.textContent.trim()
      : heading;
    if (!title) return { title: null, markdown };
    return { title, markdown: markdown.slice(match[0].length) };
  }

  function articleTitleInput() {
    return document.querySelector('textarea.title-input__inner, textarea[placeholder^="请输入标题"]');
  }

  function checkArticleTitle(title, input = articleTitleInput()) {
    if (!input || input.disabled || input.readOnly) throw new Error('未找到可编辑的专栏标题，已停止导入。');
    if (input.maxLength >= 0 && title.length > input.maxLength) {
      throw new Error(`首行标题超过专栏的 ${input.maxLength} 字限制，请缩短后重新导入。`);
    }
    return input;
  }

  function setArticleTitle(title) {
    const input = checkArticleTitle(title);
    // Vue's v-model listens to input, not to assignments of textarea.value.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(input, title);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const TITLE_MARKER = 'bili-md-import-title:';
  function prepareFileMarkdown(markdown) {
    const parser = document.querySelector('.ProseMirror')?.editor?.storage?.importMarkdown?.md;
    const split = splitLeadingTitle(markdown, parser);
    if (!split.title) return protectMarkdown(markdown);
    try { checkArticleTitle(split.title); } catch (error) {
      // A FileReader getter must not throw into Bilibili's onload callback:
      // that would leave the native import promise unresolved. Keep the H1.
      console.warn('[bili-latex-import] ' + error.message + ' 首行标题保留在正文。');
      return protectMarkdown(markdown);
    }
    // Defer the title change until the native import actually pastes HTML.
    // Hex avoids Markdown preprocessing of TeX, ~, and comment delimiters.
    const encoded = [...split.title].map(ch => ch.codePointAt(0).toString(16)).join('.');
    return '<!--' + TITLE_MARKER + encoded + '-->\n' + protectMarkdown(split.markdown);
  }

  const readerPrototype = window.FileReader?.prototype;
  const originalReadAsText = readerPrototype?.readAsText;
  const originalResult = readerPrototype && Object.getOwnPropertyDescriptor(readerPrototype, 'result');
  const markdownReaders = new WeakSet();
  const cachedResults = new WeakMap();
  function readAsText(file, ...args) {
    cachedResults.delete(this);
    markdownReaders.delete(this);
    if (typeof file?.name === 'string' && /\.md$/i.test(file.name)) markdownReaders.add(this);
    return originalReadAsText.call(this, file, ...args);
  }
  function readResult() {
    const result = originalResult.get.call(this);
    if (!markdownReaders.has(this) || typeof result !== 'string') return result;
    if (!cachedResults.has(this)) cachedResults.set(this, prepareFileMarkdown(result));
    return cachedResults.get(this);
  }
  if (originalReadAsText && originalResult?.configurable) {
    readerPrototype.readAsText = readAsText;
    Object.defineProperty(readerPrototype, 'result', { ...originalResult, get: readResult });
  }

  function formulaImage(doc, source) {
    const img = doc.createElement('img');
    img.setAttribute('data-type', 'latex');
    img.setAttribute('data-formula', source);
    img.setAttribute('src', `${MATHJAX_ENDPOINT}${encodeURIComponent(source)}`);
    img.setAttribute('alt', source);
    img.style.verticalAlign = 'middle';
    return img;
  }

  function transformHtml(html) {
    if (!html || (!html.includes('$') && !html.includes('data-bili-md-display'))) return html;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const blocks = new Set(['BODY', 'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'BLOCKQUOTE']);
    const runs = [];
    let run = { text: '', parts: [] };
    function flush() {
      if (run.parts.length) runs.push(run);
      run = { text: '', parts: [] };
    }
    function visit(node) {
      if (node.nodeType === 3) {
        const text = node.nodeValue || '';
        if (text) run.parts.push({ node, start: run.text.length, end: run.text.length + text.length });
        run.text += text;
      } else if (node.nodeType === 1) {
        if (['CODE', 'PRE', 'IMG', 'SCRIPT', 'STYLE', 'TEXTAREA'].includes(node.tagName)) { flush(); return; }
        if (node.tagName === 'BR') { run.text += '\n'; return; }
        const block = blocks.has(node.tagName);
        if (block) flush();
        for (const child of node.childNodes) visit(child);
        if (block) flush();
      }
    }
    visit(doc.body);
    let changed = false;
    for (const { text, parts } of runs) {
      // Markdown-it inserts <br> for newlines; $$ and its closing delimiter
      // therefore often belong to different text nodes. Replace a whole range.
      for (const span of findDollarSpans(text).reverse()) {
        const first = parts.find(part => part.start <= span.start && part.end > span.start);
        const last = parts.find(part => part.start < span.end && part.end >= span.end);
        if (!first || !last) continue;
        const range = doc.createRange();
        range.setStart(first.node, span.start - first.start);
        range.setEnd(last.node, span.end - last.start);
        range.deleteContents();
        const image = formulaImage(doc, span.source);
        if (span.display) image.setAttribute('data-bili-md-display', 'true');
        range.insertNode(image);
        changed = true;
      }
    }
    for (const image of doc.querySelectorAll('img[data-type="latex"][data-bili-md-display="true"]')) {
      if (image.closest('pre, code, script, style, textarea')) continue;
      image.removeAttribute('data-bili-md-display');
      let paragraph = image.closest('p');
      // markdown-it treats a standalone protected <img> as an HTML block,
      // so it can arrive without the paragraph the native parser would add.
      if (!paragraph && ['BODY', 'BLOCKQUOTE', 'LI'].includes(image.parentElement?.tagName)) {
        paragraph = doc.createElement('p');
        image.replaceWith(paragraph);
        paragraph.append(image);
      }
      // Use the same persisted paragraph attribute as Bilibili's alignment
      // toolbar. Never center a paragraph containing prose or inline formulas.
      if (paragraph && [...paragraph.childNodes].every(node =>
        (node.nodeType === 3 && !node.textContent.trim()) || node === image ||
        (node.nodeType === 1 && node.tagName === 'BR'))) {
        paragraph.style.textAlign = 'center';
      }
      changed = true;
    }
    return changed ? doc.body.innerHTML : html;
  }

  function unwrapImageParagraphs(html) {
    if (!html.includes('data-eva-image')) return html;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let changed = false;
    for (const paragraph of doc.querySelectorAll('p')) {
      if (paragraph.closest('pre, code')) continue;
      const children = [...paragraph.childNodes].filter(node =>
        node.nodeType === 1 || (node.nodeType === 3 && node.textContent.trim()));
      const isImage = node => node.nodeType === 1 && node.tagName === 'IMG' &&
        node.getAttribute('data-eva-image') === 'enhanced' && !node.hasAttribute('data-type');
      if (!children.some(isImage) || !children.every(node => isImage(node) || node.nodeName === 'BR')) continue;
      // Enhanced images are block nodes. A <p><img></p> otherwise leaves an
      // empty paragraph when ProseMirror lifts the image out of the paragraph.
      // The native image plugin skips its own unwrapping for internal images.
      // Do this before parsing; never delete empty paragraphs in the live doc.
      paragraph.replaceWith(...children.filter(isImage));
      changed = true;
    }
    return changed ? doc.body.innerHTML : html;
  }

  function onPaste(event) {
    const clipboard = event.clipboardData;
    if (!clipboard || !event.target || !event.target.closest?.('.ProseMirror')) return;
    const html = clipboard.getData('text/html');
    if (!html) return;
    let converted = html;
    let title = null;
    if (html.includes(TITLE_MARKER)) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
      const markers = [];
      let comment;
      while ((comment = walker.nextNode())) {
        if (!comment.data.startsWith(TITLE_MARKER)) continue;
        const encoded = comment.data.slice(TITLE_MARKER.length);
        if (!/^[0-9a-f]+(?:\.[0-9a-f]+)*$/i.test(encoded)) continue;
        try { title = encoded.split('.').map(hex => String.fromCodePoint(parseInt(hex, 16))).join(''); }
        catch { continue; }
        markers.push(comment);
      }
      if (markers.length) {
        try { checkArticleTitle(title); } catch {
          // If the title input changed since file reading, retain the heading.
          const h1 = doc.createElement('h1');
          h1.textContent = title;
          doc.body.prepend(h1);
          title = null;
        }
        markers.forEach(marker => marker.remove());
        converted = doc.body.innerHTML;
      }
    }
    converted = unwrapImageParagraphs(transformHtml(converted));
    if (converted === html) return;
    try {
      // Bilibili supplies a writable DataTransfer for its synthetic import.
      // Keep its synchronous event flow; no redispatch is needed.
      clipboard.setData('text/html', converted);
      if (title !== null) setArticleTitle(title);
      console.info('[bili-latex-import] 已应用 Markdown 标题、公式和图片增强');
    } catch (error) {
      console.warn('[bili-latex-import] 无法修改粘贴数据，保留原始导入', error);
    }
  }

  document.addEventListener('paste', onPaste, true);

  // Image imports are asynchronous. Keep them outside the synchronous
  // FileReader.result hook and use the editor's own parser/uploader.
  const imageCache = new WeakMap();
  let disposed = false;
  let activeController = null;
  let panel = null;
  let launcher = null;

  function assertActive(signal) {
    if (disposed || signal?.aborted) throw new Error('导入已取消；已经完成的图片上传不会撤回。');
  }

  function bounded(promise, signal, milliseconds = 30000) {
    return new Promise((resolve, reject) => {
      const abort = () => finish(reject, new Error('导入已取消；已经完成的图片上传不会撤回。'));
      const timer = setTimeout(() => finish(reject, new Error('图片处理超时，请检查网络后重试。')), milliseconds);
      function finish(callback, value) {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        callback(value);
      }
      signal?.addEventListener('abort', abort, { once: true });
      Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
      if (signal?.aborted) abort();
    });
  }

  function readFileText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(originalResult.get.call(reader));
      reader.onerror = () => reject(new Error('无法读取文件：' + file.name));
      reader.onabort = () => reject(new Error('文件读取已取消。'));
      originalReadAsText.call(reader, file, 'UTF-8');
    });
  }

  function fileIndex(files) {
    const index = new Map();
    let root = '';
    for (const file of files) {
      const path = file.webkitRelativePath || file.name;
      const parts = path.split('/');
      if (parts.some(part => !part || part === '.' || part === '..') || path.includes('\\')) {
        throw new Error('文件路径无效：' + path);
      }
      if (file.webkitRelativePath) {
        root ||= parts[0];
        if (root !== parts[0]) throw new Error('请选择同一个文档文件夹。');
      }
      if (index.has(path)) throw new Error('存在同名路径，请使用文件夹选择：' + path);
      index.set(path, file);
    }
    return { index, root };
  }

  function imageSource(source, markdownPath, root) {
    if (/^(?:https?:)?\/\//i.test(source)) {
      const url = new URL(source.startsWith('//') ? 'https:' + source : source);
      const internal = /(^|\.)hdslb\.com$/i.test(url.hostname) || url.hostname === 'article.biliimg.com';
      return { kind: internal ? 'site' : 'remote', key: url.href, url: url.href };
    }
    if (!source || /^[a-z][a-z\d+.-]*:/i.test(source) || /^[\/\\]/.test(source)) {
      throw new Error('请改用相对路径引用本地图片：' + source);
    }
    // Markdown URLs use URI encoding. Decode once, after classifying schemes.
    let path;
    try { path = decodeURIComponent(source); } catch { throw new Error('图片路径编码无效：' + source); }
    if (/^[\/\\]/.test(path) || path.includes('\0')) throw new Error('图片路径无效：' + source);
    const parts = markdownPath.split('/').slice(0, -1);
    for (const part of path.replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') {
        if (parts.length <= (root ? 1 : 0)) throw new Error('图片超出所选文件夹：' + source);
        parts.pop();
      } else parts.push(part);
    }
    return { kind: 'local', key: parts.join('/') };
  }

  function rawImages(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return [...doc.querySelectorAll('img[src]')].filter(img =>
      !img.closest('pre,code,script,style,textarea') &&
      !['latex', 'emoji', 'link-icon'].includes(img.getAttribute('data-type')));
  }

  function collectImageSources(tokens) {
    const sources = [];
    function visit(list) {
      let codeDepth = 0;
      for (const token of list) {
        if (token.type === 'html_inline' && /^<\/?(?:code|pre|script|style|textarea)\b/i.test(token.content)) {
          codeDepth += /^<\//.test(token.content) ? -1 : 1;
          codeDepth = Math.max(codeDepth, 0);
          continue;
        }
        if (codeDepth) continue;
        if (token.type === 'image') sources.push(token.attrGet('src'));
        if (token.type === 'html_inline' || token.type === 'html_block') {
          for (const img of rawImages(token.content)) sources.push(img.getAttribute('src'));
        }
        if (token.children) visit(token.children);
      }
    }
    visit(tokens);
    return sources;
  }

  // Tables must be consumed before Bilibili strips their Markdown syntax.
  // A separate parser keeps our table rules independent of the native preset.
  function extractTables(markdown, parser) {
    const tableParser = new parser.constructor({ html: true, breaks: true });
    if (typeof tableParser.parse !== 'function') throw new Error('无法创建表格解析器，编辑器接口可能已变化。');
    const tokens = tableParser.parse(markdown, {});
    const tables = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type === 'html_block' && /<table\b/i.test(token.content) && !/^\s*<(?:pre|code)\b/i.test(token.content)) {
        throw new Error('暂不支持 HTML 表格或合并单元格，请改用普通 Markdown 管线表格。');
      }
      if (token.type !== 'table_open') continue;
      if (token.level !== 0) throw new Error('暂不支持列表或引用内嵌套的表格，请将表格移到独立段落。');
      const table = { start: token.map[0], end: token.map[1], rows: [], align: [] };
      let row, header = false, cell = -1;
      for (i++; i < tokens.length && tokens[i].type !== 'table_close'; i++) {
        const t = tokens[i];
        if (t.type === 'thead_open') header = true;
        if (t.type === 'thead_close') header = false;
        if (t.type === 'tr_open') { row = []; table.rows.push(row); cell = -1; }
        if (t.type === 'th_open' || t.type === 'td_open') {
          cell++;
          if (header) table.align[cell] = (t.attrGet('style') || '').replace('text-align:', '').trim() || 'left';
        }
        if (t.type === 'inline') {
          const runs = [];
          let bold = 0, italic = 0, strike = 0, link = 0;
          for (const child of t.children || []) {
            if (child.type === 'strong_open') { bold++; continue; }
            if (child.type === 'strong_close') { bold--; continue; }
            if (child.type === 'em_open') { italic++; continue; }
            if (child.type === 'em_close') { italic--; continue; }
            if (child.type === 's_open') { strike++; continue; }
            if (child.type === 's_close') { strike--; continue; }
            if (child.type === 'link_open') { link++; continue; }
            if (child.type === 'link_close') { link--; continue; }
            const style = { bold: header || bold > 0, italic: italic > 0, strike: strike > 0, link: link > 0 };
            if (child.type === 'image') throw new Error(`表格 ${tables.length + 1} 包含图片，首版暂不支持，请将图片移到表格外。`);
            if (child.type === 'html_inline') {
              const doc = new DOMParser().parseFromString(child.content, 'text/html');
              const image = doc.querySelector('img');
              if (image) {
                if (image.getAttribute('data-type') !== 'latex') throw new Error(`表格 ${tables.length + 1} 包含图片，暂不支持。`);
                runs.push({ ...style, math: image.getAttribute('data-formula') || '' });
              } else if (/^<br\b/i.test(child.content)) runs.push({ ...style, text: '\n' });
              else if (doc.body.textContent) runs.push({ ...style, text: doc.body.textContent });
            } else if (child.type === 'softbreak' || child.type === 'hardbreak') runs.push({ ...style, text: '\n' });
            else if (child.type === 'text' || child.type === 'code_inline') {
              if (child.content) runs.push({ ...style, text: child.content, code: child.type === 'code_inline' });
            } else if (!child.type.endsWith('_open') && !child.type.endsWith('_close')) {
              throw new Error(`表格 ${tables.length + 1} 包含不支持的单元格内容：${child.type}`);
            }
          }
          row.push(runs);
        }
      }
      const columns = table.rows[0]?.length || 0;
      const characters = table.rows.flat(2).reduce((total, run) => total + (run.text || run.math || '').length, 0);
      if (!columns || columns > 8) throw new Error('表格最多支持 8 列；请拆分宽表以保证手机可读性。');
      if (table.rows.length * columns > 2000 || characters > 50000) throw new Error('表格内容过大，请拆分后导入。');
      tables.push(table);
    }
    return tables;
  }

  let tableMathFrame = null;
  let tableMathReady = null;
  function tableMathJax() {
    if (tableMathReady) return tableMathReady;
    tableMathReady = new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      tableMathFrame = frame;
      frame.hidden = true;
      frame.setAttribute('aria-hidden', 'true');
      document.body.append(frame);
      // Isolate MathJax so it never scans or changes the article editor.
      const child = frame.contentWindow;
      child.MathJax = { startup: { typeset: false }, svg: { fontCache: 'none' } };
      const script = frame.contentDocument.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js';
      script.onload = () => {
        if (!child.MathJax?.startup?.promise) { reject(new Error('表格公式渲染器初始化失败。')); return; }
        child.MathJax.startup.promise.then(() => resolve(child.MathJax), reject);
      };
      script.onerror = () => reject(new Error('无法加载表格公式渲染器，请检查网络后重试。'));
      frame.contentDocument.head.append(script);
    }).catch(error => {
      tableMathFrame?.remove(); tableMathFrame = null; tableMathReady = null;
      throw error;
    });
    return tableMathReady;
  }

  const TABLE_FONT = 26;
  const TABLE_PAD = 14;
  function tableFont(run) {
    return `${run.italic ? 'italic ' : ''}${run.bold ? '600 ' : ''}${TABLE_FONT}px ${run.code ? 'monospace' : '"PingFang SC","Microsoft YaHei",sans-serif'}`;
  }

  async function tableFormula(source, signal) {
    const engine = await bounded(tableMathJax(), signal);
    assertActive(signal);
    const node = await bounded(engine.tex2svgPromise(source, { display: false }), signal);
    if (node.querySelector('[data-mjx-error]')) throw new Error('表格中有无法渲染的公式：' + source);
    const svg = node.querySelector('svg');
    if (!svg) throw new Error('表格公式未生成 SVG。');
    const width = parseFloat(svg.getAttribute('width')) * TABLE_FONT / 2;
    const height = parseFloat(svg.getAttribute('height')) * TABLE_FONT / 2;
    if (!(width > 0 && height > 0)) throw new Error('表格公式尺寸无效。');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
    svg.style.color = '#18191c';
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
    try {
      const image = new Image();
      await bounded(new Promise((resolve, reject) => {
        image.onload = resolve; image.onerror = () => reject(new Error('表格公式 SVG 无法绘制。')); image.src = url;
      }), signal);
      return { image, width, height };
    } finally { URL.revokeObjectURL(url); }
  }

  function layoutTable(table, context, formulae = new Map()) {
    const natural = table.align.map(() => 90);
    for (const row of table.rows) row.forEach((cell, column) => {
      let width = 0;
      for (const run of cell) {
        context.font = tableFont(run);
        width += run.math !== undefined ? formulae.get(run.math).width : context.measureText(run.text).width;
      }
      natural[column] = Math.max(natural[column], Math.min(320, width + TABLE_PAD * 2));
    });
    const total = natural.reduce((a, b) => a + b, 0);
    const width = Math.min(720, total);
    // Keep every column usable; distribute the remaining space by content.
    const minimum = Math.min(90, width / natural.length);
    const extra = natural.map(n => Math.max(1, n - minimum));
    const extraTotal = extra.reduce((a, b) => a + b, 0);
    const widths = total <= width ? natural : natural.map((_n, i) => minimum + (width - minimum * natural.length) * extra[i] / extraTotal);
    const rows = table.rows.map((row, sourceRow) => {
      const cells = row.map((cell, column) => {
        const available = widths[column] - TABLE_PAD * 2;
        const lines = [];
        let items = [], used = 0, height = TABLE_FONT * 1.45;
        const flush = () => { lines.push({ items, width: used, height }); items = []; used = 0; height = TABLE_FONT * 1.45; };
        for (const run of cell) {
          context.font = tableFont(run);
          const atoms = run.math !== undefined ? [{ ...run, ...formulae.get(run.math) }] :
            Array.from(run.text).map(text => ({ ...run, text, width: context.measureText(text).width, height: TABLE_FONT * 1.45 }));
          for (const original of atoms) {
            if (original.text === '\n') { flush(); continue; }
            const scale = original.image ? Math.min(1, available / original.width) : 1;
            if (scale < 0.5) throw new Error('表格公式相对于列宽过大，请拆分宽表或缩短公式后导入。');
            const atom = { ...original, width: original.width * scale, height: original.height * scale };
            if (used && used + atom.width > available) flush();
            items.push(atom); used += atom.width; height = Math.max(height, atom.height + (atom.image ? 6 : 0));
          }
        }
        flush();
        return lines;
      });
      return { cells, sourceRow, height: Math.max(...cells.map(lines => lines.reduce((sum, line) => sum + line.height, 0))) + TABLE_PAD * 2 };
    });
    const pages = [];
    let page = [rows[0]], used = rows[0].height;
    if (used > 1400) throw new Error('表格表头过高，请缩短单元格内容。');
    for (const row of rows.slice(1)) {
      if (rows[0].height + row.height > 1400) throw new Error('表格单行内容过长，无法完整分页，请拆分该行。');
      if (used + row.height > 1400) { pages.push(page); page = [rows[0]]; used = rows[0].height; }
      page.push(row); used += row.height;
    }
    pages.push(page);
    return { width, widths, pages };
  }

  async function renderTable(table, signal) {
    await bounded(document.fonts?.ready || Promise.resolve(), signal);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器不支持表格图片绘制。');
    const formulae = new Map();
    for (const run of table.rows.flat(2)) {
      if (run.math !== undefined && !formulae.has(run.math)) formulae.set(run.math, await tableFormula(run.math, signal));
    }
    const layout = layoutTable(table, context, formulae);
    const files = [];
    for (const [pageNumber, rows] of layout.pages.entries()) {
      assertActive(signal);
      const height = rows.reduce((sum, row) => sum + row.height, 0) + 2;
      canvas.width = Math.ceil(layout.width + 2) * 2; canvas.height = Math.ceil(height) * 2;
      context.setTransform(2, 0, 0, 2, 0, 0);
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width / 2, canvas.height / 2);
      context.textBaseline = 'middle'; context.strokeStyle = '#cbd5df'; context.lineWidth = 1;
      let y = 1;
      for (const row of rows) {
        let x = 1;
        for (const [column, lines] of row.cells.entries()) {
          const width = layout.widths[column];
          // Use the source row number so stripes continue across page boundaries.
          context.fillStyle = row.sourceRow === 0 ? '#edf5fa' : row.sourceRow % 2 === 0 ? '#f3f6f9' : '#fff';
          context.fillRect(x, y, width, row.height); context.strokeRect(x, y, width, row.height);
          const contentHeight = lines.reduce((sum, line) => sum + line.height, 0);
          let lineY = y + (row.height - contentHeight) / 2;
          for (const line of lines) {
            const align = table.align[column];
            let lineX = align === 'center' ? x + (width - line.width) / 2 : align === 'right' ? x + width - TABLE_PAD - line.width : x + TABLE_PAD;
            for (const item of line.items) {
              if (item.image) context.drawImage(item.image, lineX, lineY + (line.height - item.height) / 2, item.width, item.height);
              else {
                context.font = tableFont(item); context.fillStyle = item.link ? '#007faf' : '#18191c';
                if (item.code) { context.fillStyle = '#f1f3f5'; context.fillRect(lineX, lineY, item.width, line.height); context.fillStyle = '#18191c'; }
                context.fillText(item.text, lineX, lineY + line.height / 2);
                if (item.strike || item.link) {
                  context.strokeStyle = item.link ? '#007faf' : '#18191c'; context.beginPath();
                  const offset = item.strike ? 0 : TABLE_FONT * 0.45;
                  context.moveTo(lineX, lineY + line.height / 2 + offset); context.lineTo(lineX + item.width, lineY + line.height / 2 + offset); context.stroke(); context.strokeStyle = '#cbd5df';
                }
              }
              lineX += item.width;
            }
            lineY += line.height;
          }
          x += width;
        }
        y += row.height;
      }
      const blob = await bounded(new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('表格 PNG 导出失败。')), 'image/png')), signal);
      files.push(new File([blob], `table-${pageNumber + 1}.png`, { type: 'image/png' }));
    }
    return files;
  }

  async function convertTables(markdown, parser, signal, renderer = renderTable, imageLimit = 18) {
    const tables = extractTables(markdown, parser);
    if (tables.length > imageLimit) throw new Error(`文档至少需要 ${tables.length} 张表格图片，超过当前编辑器的 ${imageLimit} 张限制。`);
    const generated = new Map();
    const lines = markdown.split('\n');
    for (let index = tables.length - 1; index >= 0; index--) {
      assertActive(signal);
      const table = tables[index];
      const files = await renderer(table, signal);
      if (!files.length) throw new Error('表格转换没有生成图片。');
      if (generated.size + files.length > imageLimit) throw new Error(`表格分页后超过当前编辑器的 ${imageLimit} 张图片限制。`);
      const replacement = files.map((file, part) => {
        const source = `bili-md-table:${index + 1}-${part + 1}`;
        generated.set(source, new File([file], `table-${index + 1}-${part + 1}.png`, { type: 'image/png' }));
        const caption = `表格 ${index + 1}` + (files.length > 1 ? `（${part + 1}/${files.length}）` : '');
        return `<img src="${source}" alt="${caption}">`;
      }).join('\n\n');
      lines.splice(table.start, table.end - table.start, replacement + '\n');
    }
    return { markdown: lines.join('\n'), generated, tableCount: tables.length };
  }

  const tableCache = new WeakMap();
  async function planImport(files, markdownPath, parser, limits = {}, signal) {
    const { index, root } = fileIndex(files);
    const file = index.get(markdownPath);
    if (!file || !/\.md$/i.test(markdownPath)) throw new Error('请选择文件夹中的 Markdown 文档。');
    const split = splitLeadingTitle(await readFileText(file), parser);
    const protectedMarkdown = protectMarkdown(split.markdown);
    let converted = tableCache.get(file);
    if (!converted || converted.source !== protectedMarkdown) {
      converted = { source: protectedMarkdown, ...await convertTables(protectedMarkdown, parser, signal, limits.tableRenderer, limits.limit || 18) };
      if (converted.tableCount) tableCache.set(file, converted);
    }
    assertActive(signal);
    const markdown = converted.markdown;
    const sources = collectImageSources(parser.parse(markdown, {}));
    const limit = limits.limit || 18;
    if (sources.length > limit) throw new Error(`文档包含 ${sources.length} 处图片，超过当前编辑器的 ${limit} 张限制。`);
    const entries = new Map();
    const errors = [];
    const allowed = limits.allowedMimeTypes || ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
    for (const source of new Set(sources)) {
      try {
        const generatedFile = converted.generated.get(source);
        const entry = generatedFile ? { kind: 'local', key: source, file: generatedFile, generated: true } : imageSource(source, markdownPath, root);
        if (entry.kind === 'local') {
          entry.file ||= index.get(entry.key);
          if (!entry.file) throw new Error('找不到图片：' + source + '（对应 ' + entry.key + '）');
          entry.mime = entry.file.type || mime[entry.file.name.split('.').pop().toLowerCase()];
          if (!allowed.includes(entry.mime)) throw new Error('不支持的图片格式：' + source);
          const max = entry.mime === 'image/gif' ? (limits.maxGifFileSize || 8 * 1024 * 1024) : (limits.maxFileSize || 20 * 1024 * 1024);
          if (entry.file.size > max) throw new Error('图片超过大小限制：' + source);
        }
        entries.set(source, entry);
      } catch (error) { errors.push(error.message); }
    }
    if (errors.length) throw new Error(errors.join('\n'));
    return { title: split.title, markdown, entries, occurrences: sources.length, markdownPath, tables: converted.tableCount, tableImages: converted.generated.size };
  }

  function checkedImage(result) {
    if (!result || typeof result.url !== 'string') throw new Error('图片上传未返回有效地址。');
    const url = new URL(result.url.startsWith('//') ? 'https:' + result.url : result.url);
    if (!['http:', 'https:'].includes(url.protocol) ||
        !(/(^|\.)hdslb\.com$/i.test(url.hostname) || url.hostname === 'article.biliimg.com')) {
      throw new Error('图片处理未返回 B 站图片地址。');
    }
    if (!(Number(result.width) > 0) || !(Number(result.height) > 0)) throw new Error('图片处理未返回有效尺寸。');
    return { ...result, url: url.href, size: Number(result.size) || 0 };
  }

  function siteImageInfo(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight, size: 0 });
      img.onerror = () => reject(new Error('无法读取站内图片：' + url));
      img.src = url;
    });
  }

  async function prepareImages(plan, options, signal, progress = () => {}, importOptions = {}) {
    const watermark = importOptions.watermark === true;
    const replacements = new Map();
    const unique = new Map();
    for (const entry of plan.entries.values()) unique.set(entry.key, entry);
    const results = new Map();
    const entries = [...unique.values()];
    let cursor = 0;
    let completed = 0;
    let failure = null;
    async function worker() {
      while (cursor < entries.length && !failure) {
        assertActive(signal);
        const entry = entries[cursor++];
        try {
          let result;
          if (entry.kind === 'local') {
            // Watermarked uploads cannot be reused when watermark is disabled.
            const cached = imageCache.get(entry.file);
            result = cached?.get(watermark);
            if (!result) {
              const file = new File([entry.file], entry.file.name, { type: entry.mime, lastModified: entry.file.lastModified });
              file.watermark = watermark;
              result = checkedImage(await bounded(options.uploadHandler(file), signal));
              const variants = cached || new Map();
              variants.set(watermark, result);
              imageCache.set(entry.file, variants);
            }
          } else if (entry.kind === 'site') {
            result = checkedImage(await bounded((options.siteImageInfo || siteImageInfo)(entry.url), signal));
          } else {
            if (!options.transferHandler) throw new Error('当前编辑器不支持外站图片转存，请先下载到文档文件夹。');
            result = checkedImage(await bounded(options.transferHandler(entry.url), signal));
          }
          assertActive(signal);
          results.set(entry.key, result);
          progress(++completed, entries.length, entry.key);
        } catch (error) {
          failure ||= new Error(entry.key + '：' + error.message);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, entries.length) }, worker));
    if (failure) throw failure;
    assertActive(signal);
    for (const [source, entry] of plan.entries) replacements.set(source, results.get(entry.key));
    return replacements;
  }

  function imageHtml(result, caption = '', title = '') {
    function attr(value) { return [...String(value)].map(ch => '&#' + ch.codePointAt(0) + ';').join(''); }
    const attrs = {
      src: result.url, 'data-url': result.url, 'data-eva-image': 'enhanced', 'data-status': 1,
      'data-width': result.width, 'data-height': result.height, 'data-size': result.size,
      'data-ai-gen-pic': result.ai_gen_pic || 0, 'data-caption': caption, alt: caption || '[图片]', title,
    };
    return '<img ' + Object.entries(attrs).map(([name, value]) => name + '="' + attr(value) + '"').join(' ') + '>';
  }

  function withImageRenderer(parser, replacements, callback) {
    const rules = parser.renderer.rules;
    const saved = new Map(['image', 'html_inline', 'html_block'].map(type => [type, rules[type]]));
    let codeDepth = 0;
    function replaceRaw(html) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      let changed = false;
      for (const img of rawImages(html)) {
        const result = replacements.get(img.getAttribute('src'));
        if (result) {
          // Use nodes from this document to retain pre/code ancestry.
          for (const candidate of doc.querySelectorAll('img[src]')) {
            if (candidate.closest('pre,code,script,style,textarea') ||
                candidate.getAttribute('src') !== img.getAttribute('src') ||
                ['latex', 'emoji', 'link-icon'].includes(candidate.getAttribute('data-type'))) continue;
            const fragment = doc.createRange().createContextualFragment(imageHtml(result, candidate.getAttribute('alt') || '', candidate.getAttribute('title') || ''));
            candidate.replaceWith(fragment);
            changed = true;
          }
        }
      }
      return changed ? doc.body.innerHTML : html;
    }
    rules.image = (tokens, index, options, env, renderer) => {
      const token = tokens[index];
      const result = replacements.get(token.attrGet('src'));
      if (!result || codeDepth) return saved.get('image')(tokens, index, options, env, renderer);
      return imageHtml(result, renderer.renderInlineAsText(token.children || [], options, env), token.attrGet('title') || '');
    };
    for (const type of ['html_inline', 'html_block']) {
      rules[type] = (tokens, index, ...args) => {
        const html = saved.get(type) ? saved.get(type)(tokens, index, ...args) : tokens[index].content;
        if (type === 'html_inline' && /^<\/?(?:code|pre|script|style|textarea)\b/i.test(html)) {
          codeDepth = Math.max(0, codeDepth + (/^<\//.test(html) ? -1 : 1));
          return html;
        }
        return codeDepth ? html : replaceRaw(html);
      };
    }
    try { return callback(); } finally {
      for (const [type, rule] of saved) {
        if (rule === undefined) delete rules[type]; else rules[type] = rule;
      }
    }
  }

  function nativeEditor() {
    const editor = document.querySelector('.ProseMirror')?.editor;
    const parser = editor?.storage?.importMarkdown?.md;
    const options = editor?.extensionManager?.extensions.find(extension => extension.name === 'biliImage')?.options;
    if (!editor?.commands?.importMarkdown || !parser || typeof options?.uploadHandler !== 'function') {
      throw new Error('编辑器尚未准备好，或 B 站编辑器接口已变化，请稍后重试。');
    }
    return { editor, parser, options };
  }

  async function importFiles(files, markdownPath, signal, progress = () => {}, importOptions = {}) {
    assertActive(signal);
    const { editor, parser, options } = nativeEditor();
    const original = editor.state.doc;
    const initialTitleInput = articleTitleInput();
    const originalTitle = initialTitleInput?.value;
    const plan = await planImport(files, markdownPath, parser, options, signal);
    const titleInput = plan.title === null ? null : checkArticleTitle(plan.title);
    assertActive(signal);
    progress(`检查完成：${plan.tables} 张表格，正在准备 ${plan.occurrences} 处图片…`);
    const replacements = await prepareImages(plan, options, signal, (done, total, path) =>
      progress(`图片 ${done}/${total}：${path}`), importOptions);
    assertActive(signal);
    if (!editor.state.doc.eq(original)) throw new Error('上传期间正文发生了修改，已停止替换；请确认内容后重新导入。');
    if (titleInput && (titleInput !== initialTitleInput || titleInput !== articleTitleInput() || titleInput.value !== originalTitle)) {
      throw new Error('上传期间专栏标题发生了修改，已停止替换；请确认内容后重新导入。');
    }
    if (editor.storage.importMarkdown.isImporting) throw new Error('编辑器正在进行其他导入，请稍后重试。');
    const accepted = plan.title !== null && !plan.markdown.trim()
      ? editor.commands.clearContent()
      : withImageRenderer(parser, replacements, () =>
        editor.commands.importMarkdown({ content: plan.markdown, replaceContent: true }));
    if (!accepted) throw new Error('编辑器未接受导入，请重试。');
    // The native command renders synchronously, then commits paste in a microtask.
    await new Promise(resolve => setTimeout(resolve, 0));
    const actual = [];
    editor.state.doc.descendants(node => {
      if (node.type.name === 'enhancedImage' || node.type.name === 'image') actual.push(node.attrs.src);
    });
    const expected = collectImageSources(parser.parse(plan.markdown, {})).map(source => replacements.get(source)?.url);
    if (actual.length !== expected.length || actual.some((url, i) => url !== expected[i])) {
      editor.commands.setContent(original.toJSON());
      throw new Error('编辑器中的图片与预期不符，已还原导入前的正文。');
    }
    if (plan.title !== null) {
      try { setArticleTitle(plan.title); } catch (error) {
        editor.commands.setContent(original.toJSON());
        throw error;
      }
    }
    editor.commands.updateImageCache?.();
    return { tables: plan.tables, tableImages: plan.tableImages, images: plan.occurrences, uploaded: new Set([...plan.entries.values()].filter(entry => entry.kind === 'local').map(entry => entry.key)).size };
  }

  function mountImageImport() {
    if (disposed || launcher || !document.body) return;
    launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.innerHTML = '<span aria-hidden="true">↥</span><span>导入 Markdown 和图片</span>';
    launcher.id = 'bili-md-image-import';
    launcher.style.cssText = 'position:fixed;right:24px;bottom:76px;z-index:2147483000;display:flex;align-items:center;gap:7px;padding:11px 17px;border:1px solid #008fbe;border-radius:999px;background:linear-gradient(135deg,#00aeec,#008fc5);color:white;cursor:pointer;box-shadow:0 8px 20px #008fc544,0 2px 5px #0002;font:600 14px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;transition:transform .18s ease,box-shadow .18s ease';
    launcher.onmouseenter = () => { launcher.style.transform = 'translateY(-2px)'; launcher.style.boxShadow = '0 12px 24px #008fc555,0 3px 7px #0002'; };
    launcher.onmouseleave = () => { launcher.style.transform = ''; launcher.style.boxShadow = '0 8px 20px #008fc544,0 2px 5px #0002'; };
    launcher.onclick = () => {
      if (panel) { panel.hidden = false; return; }
      panel = document.createElement('section');
      panel.id = 'bili-md-image-panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', '导入 Markdown 和图片');
      panel.style.cssText = 'position:fixed;right:24px;bottom:126px;width:424px;max-width:calc(100vw - 32px);max-height:calc(100vh - 150px);overflow:auto;box-sizing:border-box;padding:0;z-index:2147483001;background:#fff;color:#18191c;border:1px solid #e5e7eb;border-radius:18px;box-shadow:0 18px 50px #18191c26,0 3px 10px #18191c12;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;animation:bili-md-panel-in .2s ease-out';
      panel.innerHTML = '<style>' +
        '@keyframes bili-md-panel-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}' +
        '#bili-md-image-panel *{box-sizing:border-box}#bili-md-image-panel .bmi-head{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:20px 22px 16px;background:linear-gradient(135deg,#f1fbff,#fff)}' +
        '#bili-md-image-panel .bmi-kicker{margin:0 0 3px;color:#00a1d6;font-size:11px;font-weight:700;letter-spacing:.08em}#bili-md-image-panel h2{margin:0;color:#18191c;font-size:18px;line-height:1.35}' +
        '#bili-md-image-panel .bmi-close{display:grid;place-items:center;flex:0 0 30px;width:30px;height:30px;padding:0;border:0;border-radius:50%;background:transparent;color:#6b7280;font:24px/1 sans-serif;cursor:pointer}#bili-md-image-panel .bmi-close:hover{background:#e8f7fc;color:#00a1d6}' +
        '#bili-md-image-panel .bmi-body{padding:18px 22px 20px}#bili-md-image-panel .bmi-help{margin:0 0 18px;color:#6b7280;font-size:13px;line-height:1.55}' +
        '#bili-md-image-panel .bmi-label{display:block;margin:0 0 7px;color:#4f5661;font-size:12px;font-weight:700}#bili-md-image-panel .bmi-drop{display:flex;align-items:center;gap:12px;padding:13px 14px;border:1px dashed #b9dfea;border-radius:11px;background:#f8fdff;color:#18191c;cursor:pointer;transition:border-color .15s,background .15s}' +
        '#bili-md-image-panel .bmi-drop:hover{border-color:#00a1d6;background:#f0fbff}#bili-md-image-panel .bmi-folder{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;background:#dff6fc;color:#008fbe;font-size:20px}#bili-md-image-panel .bmi-drop strong{display:block;font-size:13px}#bili-md-image-panel .bmi-drop small{display:block;margin-top:2px;color:#8a919b;font-size:11px}' +
        '#bili-md-image-panel .bmi-drop input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}#bili-md-image-panel .bmi-field{margin-top:16px}#bili-md-image-panel select{width:100%;padding:10px 34px 10px 11px;border:1px solid #dfe3e8;border-radius:9px;background:#fff;color:#18191c;font:inherit;outline:0}#bili-md-image-panel select:focus{border-color:#00a1d6;box-shadow:0 0 0 3px #00a1d61c}' +
        '#bili-md-image-panel .bmi-option{display:flex;align-items:center;gap:10px;margin-top:15px;padding:11px 12px;border:1px solid #edf0f2;border-radius:10px;background:#fafbfc;cursor:pointer}#bili-md-image-panel .bmi-option input{width:16px;height:16px;margin:0;accent-color:#00a1d6}#bili-md-image-panel .bmi-option strong{display:block;font-size:13px}#bili-md-image-panel .bmi-option small{display:block;color:#8a919b;font-size:11px}' +
        '#bili-md-image-panel [role="status"]{min-height:58px;margin:16px 0;padding:11px 12px;border-radius:10px;background:#f5f7f9;color:#69717d;white-space:pre-line;overflow-wrap:anywhere;font-size:12px;line-height:1.5}#bili-md-image-panel .bmi-actions{display:flex;gap:9px}#bili-md-image-panel .bmi-actions button[data-action]{height:38px;border-radius:9px;padding:0 14px;font:600 13px sans-serif;cursor:pointer}#bili-md-image-panel .bmi-actions button[data-action="import"]{flex:1;border:1px solid #00a1d6;background:#00a1d6;color:#fff;box-shadow:0 3px 8px #00a1d633}#bili-md-image-panel .bmi-actions button[data-action="import"]:hover:not(:disabled){background:#008fbe}#bili-md-image-panel .bmi-actions button[data-action="close"]{border:1px solid #dfe3e8;background:#fff;color:#59616d}#bili-md-image-panel .bmi-actions button[data-action="close"]:hover{background:#f5f7f9}#bili-md-image-panel button:disabled{cursor:not-allowed;opacity:.48}' +
        '#bili-md-image-panel .bmi-foot{margin-top:14px;color:#9aa1aa;text-align:center;font-size:11px}@media(max-width:520px){#bili-md-image-panel{right:16px!important;bottom:84px!important;width:calc(100vw - 32px)!important}#bili-md-image-import{right:16px!important;bottom:20px!important}}' +
        '</style><div class="bmi-head"><div><p class="bmi-kicker">BILIBILI MARKDOWN</p><h2>导入 Markdown 和图片</h2></div><button type="button" class="bmi-close" data-action="dismiss" aria-label="关闭">×</button></div>' +
        '<div class="bmi-body"><p class="bmi-help">选择 .md 文件；引用了本地图片时，请选择包含文档及图片的文件夹。导入会替换正文；首行一级标题会自动移至专栏标题。表格自动转为图片，表内文字和链接将不能单独编辑或点击。</p>' +
        '<label class="bmi-label">选择文档</label><label class="bmi-drop"><span class="bmi-folder" aria-hidden="true">▣</span><span><strong>选择文件夹</strong><small>包含 Markdown 文档及本地图片</small></span><input type="file" webkitdirectory multiple aria-label="文档文件夹"></label>' +
        '<label class="bmi-drop" style="margin-top:8px"><span class="bmi-folder" aria-hidden="true">M↓</span><span><strong>直接选择 .md 文件</strong><small>适合仅含文字、公式、表格的文档</small></span><input type="file" accept=".md,text/markdown" aria-label="Markdown 文件"></label>' +
        '<div class="bmi-field"><label class="bmi-label" for="bmi-md-select">Markdown 文档</label><select id="bmi-md-select" aria-label="Markdown 文档"></select></div>' +
        '<label class="bmi-option"><input type="checkbox" data-option="watermark"><span><strong>图片添加水印</strong><small>默认关闭，影响本地图片和表格图片</small></span></label>' +
        '<div role="status">请选择 .md 文件或文档文件夹。</div><div class="bmi-actions"><button type="button" data-action="import" disabled>上传图片并导入</button><button type="button" data-action="close">关闭</button></div><div class="bmi-foot">v' + VERSION + ' · 图片默认不添加水印</div></div>';
      document.body.append(panel);
      const input = panel.querySelector('input[type="file"]');
      const markdownInput = panel.querySelector('input[aria-label="Markdown 文件"]');
      const watermark = panel.querySelector('[data-option="watermark"]');
      const select = panel.querySelector('select');
      const status = panel.querySelector('[role="status"]');
      const start = panel.querySelector('[data-action="import"]');
      const close = panel.querySelector('[data-action="close"]');
      let files = [];
      let revision = 0;
      async function preview() {
        const current = ++revision;
        start.disabled = true;
        status.textContent = '正在检查文档并生成表格图片…';
        try {
          const { parser, options } = nativeEditor();
          const plan = await planImport(files, select.value, parser, options);
          if (current !== revision || disposed) return;
          const count = new Set([...plan.entries.values()].filter(entry => entry.kind === 'local').map(entry => entry.key)).size;
          if (plan.title !== null) checkArticleTitle(plan.title);
          status.textContent = `检查通过：${plan.tables} 张表格 → ${plan.tableImages} 张图片；共 ${plan.occurrences} 处图片，${count} 个上传文件。\n` +
            (plan.title !== null ? `专栏标题：${plan.title}\n` : '') + '点击导入后将替换当前正文。';
          start.disabled = false;
        } catch (error) { if (current === revision) status.textContent = error.message; }
      }
      const chooseFiles = selected => {
        files = [...selected];
        select.replaceChildren();
        for (const file of files.filter(file => /\.md$/i.test(file.name))) {
          const option = document.createElement('option');
          option.value = option.textContent = file.webkitRelativePath || file.name;
          select.append(option);
        }
        if (!select.options.length) { start.disabled = true; status.textContent = '所选内容中没有 .md 文档。'; return; }
        void preview();
      };
      input.onchange = () => chooseFiles(input.files);
      markdownInput.onchange = () => chooseFiles(markdownInput.files);
      select.onchange = () => void preview();
      const dismiss = panel.querySelector('[data-action="dismiss"]');
      const closePanel = () => {
        if (activeController) activeController.abort(); else panel.hidden = true;
      };
      close.onclick = dismiss.onclick = closePanel;
      start.onclick = async () => {
        if (activeController) return;
        activeController = new AbortController();
        start.disabled = input.disabled = markdownInput.disabled = select.disabled = watermark.disabled = true;
        close.textContent = '取消导入';
        try {
          const result = await importFiles(files, select.value, activeController.signal,
            text => { status.textContent = text; }, { watermark: watermark.checked });
          status.textContent = `导入完成：${result.tables} 张表格，${result.images} 处图片。请检查正文及预览，再保存草稿。`;
        } catch (error) { status.textContent = error.message; }
        finally {
          activeController = null;
          start.disabled = input.disabled = markdownInput.disabled = select.disabled = watermark.disabled = false;
          close.textContent = '关闭';
        }
      };
    };
    document.body.append(launcher);
  }

  document.addEventListener('DOMContentLoaded', mountImageImport, { once: true });
  if (document.body) mountImageImport();
  window.biliLatexImport = Object.freeze({
    version: VERSION, findDollarSpans, protectMarkdown, transformHtml,
    splitLeadingTitle, extractTables, layoutTable, renderTable, convertTables,
    fileIndex, imageSource, collectImageSources, planImport, prepareImages, withImageRenderer, importFiles,
    uninstall() {
      disposed = true;
      activeController?.abort();
      tableMathFrame?.remove();
      panel?.remove();
      launcher?.remove();
      document.removeEventListener('DOMContentLoaded', mountImageImport);
      document.removeEventListener('paste', onPaste, true);
      if (readerPrototype?.readAsText === readAsText) readerPrototype.readAsText = originalReadAsText;
      if (readerPrototype && Object.getOwnPropertyDescriptor(readerPrototype, 'result')?.get === readResult) {
        Object.defineProperty(readerPrototype, 'result', originalResult);
      }
    },
  });
})();
