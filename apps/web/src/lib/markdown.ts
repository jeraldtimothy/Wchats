import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { Marked } from 'marked';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    code({ text, lang }) {
      const language = (lang ?? '').trim().split(/\s+/)[0] ?? '';
      const known = language && hljs.getLanguage(language);
      const highlighted = known
        ? hljs.highlight(text, { language, ignoreIllegals: true }).value
        : hljs.highlightAuto(text).value;
      return (
        `<div class="code-block">` +
        `<div class="code-header"><span>${escapeHtml(language || 'code')}</span>` +
        `<button type="button" data-copy-code>Copy</button></div>` +
        `<pre><code class="hljs">${highlighted}</code></pre></div>`
      );
    },
    // Raw HTML from the model is shown as text, never rendered.
    html({ text }) {
      return escapeHtml(text);
    },
  },
});

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/** Markdown → sanitized HTML (GFM tables/lists, highlighted code blocks with a copy button). */
export function renderMarkdown(src: string): string {
  const html = marked.parse(src, { async: false });
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form', 'input'] });
}
