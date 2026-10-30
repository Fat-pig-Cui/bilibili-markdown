import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const tex = new TeX({ packages: ['base', 'ams', 'newcommand', 'color'] });
const svg = new SVG({ fontCache: 'none' });
const document = mathjax.document('', { InputJax: tex, OutputJax: svg });

/** Render one TeX expression as a standalone SVG document. */
export function renderFormula(texSource, display = false) {
  const node = document.convert(texSource, { display, em: 16, ex: 8, containerWidth: 80 * 16 });
  const svgNode = adaptor.tags(node, 'svg')[0];
  if (!svgNode) throw new Error(`MathJax 没有生成 SVG：${texSource}`);
  const width = adaptor.getAttribute(svgNode, 'width') || '1em';
  const height = adaptor.getAttribute(svgNode, 'height') || '1em';
  adaptor.setAttribute(svgNode, 'xmlns', 'http://www.w3.org/2000/svg');
  adaptor.setAttribute(svgNode, 'role', 'img');
  adaptor.setAttribute(svgNode, 'aria-label', texSource.replace(/\s+/g, ' ').trim());
  const markup = adaptor.outerHTML(svgNode);
  return { markup, width, height };
}
