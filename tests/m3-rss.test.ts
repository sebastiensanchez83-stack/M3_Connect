import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderFeed } from '../netlify/edge-functions/rss.ts';
import { cleanM3Editorial } from '../netlify/lib/m3-editorial.ts';

const article = {
  id: '33a49baf-263f-49e1-a0a9-2e1f7bb2cef8', title: 'Marina & standards', summary: 'Source <summary>',
  thumbnail_url: 'https://example.com/marina.jpg', topic: 'Management',
  published_at: '2026-10-16T10:43:30Z', created_at: '2026-10-16T10:43:30Z',
  resource_m3_editions: { is_ready: true, content_html: '<h2>M3 perspective</h2><p>Test ]]&gt; and evidence.</p><p><a href="https://m3monaco.com/consulting/">Expertise</a></p>' },
};
test('M3 exports distinct full prose, source link, stable identity, date and featured image', () => {
  const xml = renderFeed([article]);
  assert.match(xml, /<content:encoded><!\[CDATA\[<h2>M3 perspective/);
  assert.match(xml, /<guid isPermaLink="true">https:\/\/smartmarinaconnect.com\/resources\/33a49baf-263f-49e1-a0a9-2e1f7bb2cef8<\/guid>/);
  assert.match(xml, /Fri, 16 Oct 2026 10:43:30 GMT/);
  assert.match(xml, /<description><!\[CDATA\[<p>Source &lt;summary&gt;/);
  assert.match(xml, /<enclosure url="https:\/\/example.com\/marina.jpg"/);
  assert.match(xml, /utm_source=m3monaco.com/);
});
test('unprepared editions never enter M3 feed', () => {
  for (const edition of [null, {is_ready:false,content_html:'<p>Private draft</p>'}, {is_ready:true,content_html:'<script>bad()</script>'}, {is_ready:true,content_html:'<p>&nbsp;</p>'}]) {
    assert.doesNotMatch(renderFeed([{...article,resource_m3_editions:edition}]), /<item>/);
  }
});
test('S3 preserves summary-only output without M3 editorial leakage', () => {
  const xml = renderFeed([article], {path:'/rss-s3.xml',column:'share_to_s3',tracking:'utm_source=s3monaco.com'});
  assert.match(xml, /<item>/);
  assert.doesNotMatch(xml, /<content:encoded>|M3 perspective/);
  assert.match(xml, /utm_source=s3monaco.com/);
});
test('unsafe markup and protocols cannot reach WordPress', () => {
  const html = cleanM3Editorial('<p onclick="bad()">Safe</p><iframe src="https://evil.test"></iframe><script>bad()</script><img src="x" onerror="bad()"><a href="javascript:bad()">bad</a><a href="//evil.test">relative</a><a href="https://m3monaco.com/consulting/">good</a>');
  assert.doesNotMatch(html, /script|iframe|img|onclick|javascript:|href="\/\//);
  assert.match(html, /href="https:\/\/m3monaco.com\/consulting\/"/);
});
test('CDATA terminators cannot break the feed', () => {
  assert.doesNotThrow(() => renderFeed([{...article,summary:'Testing ]]> safe'}]));
  assert.match(renderFeed([{...article,summary:'Testing ]]> safe'}]), /Testing \]\]&gt; safe/);
});
