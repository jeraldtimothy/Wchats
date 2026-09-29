import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

const dom = (html: string) => {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
};

describe('renderMarkdown', () => {
  it('renders GFM tables and lists', () => {
    const d = dom(renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n- two'));
    expect(d.querySelectorAll('table td')).toHaveLength(2);
    expect(d.querySelectorAll('ul li')).toHaveLength(2);
  });

  it('highlights code blocks and adds a copy button', () => {
    const d = dom(renderMarkdown('```js\nconst x = 1;\n```'));
    expect(d.querySelector('.code-header span')?.textContent).toBe('js');
    expect(d.querySelector('[data-copy-code]')).not.toBeNull();
    expect(d.querySelector('code.hljs')?.textContent).toBe('const x = 1;');
    expect(d.querySelector('code.hljs .hljs-keyword')).not.toBeNull();
  });

  it('shows raw HTML as text instead of rendering it', () => {
    const html = renderMarkdown('Hi <script>alert(1)</script> <img src=x onerror="alert(2)"> <b>bold</b>');
    const d = dom(html);
    expect(d.querySelector('script')).toBeNull();
    expect(d.querySelector('img')).toBeNull();
    expect(d.querySelector('b')).toBeNull();
    expect(d.textContent).toContain('<script>alert(1)</script>');
  });

  it('strips dangerous link and image URLs', () => {
    const d = dom(renderMarkdown('[click](javascript:alert(1)) ![x](javascript:alert(2)) [data](data:text/html,<b>x</b>)'));
    for (const a of d.querySelectorAll('a')) expect(a.getAttribute('href') ?? '').not.toMatch(/^(javascript|data):/i);
    for (const img of d.querySelectorAll('img')) expect(img.getAttribute('src') ?? '').not.toMatch(/^javascript:/i);
  });

  it('opens links in a new tab without an opener', () => {
    const a = dom(renderMarkdown('[site](https://example.com)')).querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://example.com');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('escapes the language label of code fences', () => {
    const d = dom(renderMarkdown('```"><img src=x onerror=alert(1)>\ncode\n```'));
    expect(d.querySelector('img')).toBeNull();
  });
});
