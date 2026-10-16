import test from 'node:test';
import assert from 'node:assert/strict';
import rss, {renderFeed} from '../netlify/edge-functions/rss.ts';

const article={id:'public-1',title:'Marinas & standards',summary:'The short summary.',content:'<h2>Evidence</h2><p>A full article with a <a href="https://example.com">source</a> and ]]> text.</p>',thumbnail_url:'https://example.com/photo.jpg',topic:'Sustainability',published_at:'2026-10-16T09:00:00Z',created_at:'2026-10-15T09:00:00Z'};
const s3={path:'/rss-s3.xml',column:'share_to_s3',tracking:'utm_source=s3monaco.com&utm_medium=rss&utm_campaign=article_feed',fullContent:true};

test('S3 adds a separate complete HTML body with safe CDATA boundaries',()=>{
  const xml=renderFeed([article],s3);
  assert.match(xml,/xmlns:content="http:\/\/purl.org\/rss\/1.0\/modules\/content\/"/);
  assert.match(xml,/<content:encoded><!\[CDATA\[<h2>Evidence<\/h2>/);
  assert.ok(xml.includes(']]]]><![CDATA[> text.'));
  assert.ok(xml.includes('<description><![CDATA[<p>The short summary.</p>'));
  assert.ok(xml.includes('<guid isPermaLink="true">https://smartmarinaconnect.com/resources/public-1</guid>'));
  assert.ok(xml.includes('<pubDate>Fri, 16 Oct 2026 09:00:00 GMT</pubDate>'));
  assert.ok(xml.includes('<title>Marinas &amp; standards</title>'));
  assert.match(xml,/<enclosure url="https:\/\/example.com\/photo.jpg"/);
});
test('M3 excludes sources without a ready distinct editorial edition',()=>{
  const xml=renderFeed([article]);
  assert.ok(!xml.includes('<content:encoded>'));
  assert.ok(!xml.includes('<item>'));
  assert.ok(!xml.includes('<h2>Evidence'));
});
test('Missing and visually empty article bodies fall back to the summary',()=>{
  for(const content of [null,'','<p></p>','<p> &nbsp; &#160; &#xA0; </p>']){
    const xml=renderFeed([{...article,content}],s3);
    assert.ok(!xml.includes('<content:encoded>'));
    assert.ok(xml.includes('The short summary.'));
  }
});
test('Each endpoint keeps its public, published and selected resource filters',async()=>{
  const originalFetch=globalThis.fetch,originalNetlify=globalThis.Netlify;
  globalThis.Netlify={env:{get:name=>({SUPABASE_URL:'https://source.example',SUPABASE_ANON_KEY:'sb_publishable_fixture'}[name])}};
  try{
    for(const [path,column,full] of [['/rss-s3.xml','share_to_s3',true],['/rss.xml','share_to_m3',false]]){
      let lookup;
      globalThis.fetch=async(url,options)=>{lookup={url:new URL(url),options};return Response.json([article]);};
      const response=await rss(new Request('https://smartmarinaconnect.com'+path));
      assert.equal(response.status,200);
      assert.equal(lookup.url.searchParams.get(column),'eq.true');
      assert.equal(lookup.url.searchParams.get('published'),'eq.true');
      assert.equal(lookup.url.searchParams.get('access_level'),'eq.public');
      assert.equal(lookup.url.searchParams.get('limit'),'50');
      assert.equal(lookup.url.searchParams.get('resource_m3_editions.is_ready'),column === 'share_to_m3' ? 'eq.true' : null);
      assert.equal(lookup.url.searchParams.get('select').split(',').includes('content'),full);
      assert.equal(lookup.options.headers.apikey,'sb_publishable_fixture');
      assert.equal(lookup.options.headers.Authorization,undefined);
      assert.equal((await response.text()).includes('<content:encoded>'),full);
      assert.equal(response.headers.get('X-SMC-Feed'),'live');
    }
    globalThis.fetch=async()=>new Response('Unavailable',{status:503});
    const failed=await rss(new Request('https://smartmarinaconnect.com/rss-s3.xml'));
    assert.equal(failed.status,503);
    assert.equal(failed.headers.get('Cache-Control'),'no-store');
    assert.ok(!(await failed.text()).includes('The short summary.'));
    globalThis.fetch=async()=>Response.json([article]);
    assert.equal(await(await rss(new Request('https://smartmarinaconnect.com/rss-s3.xml',{method:'HEAD'}))).text(),'');
  }finally{globalThis.fetch=originalFetch;globalThis.Netlify=originalNetlify;}
});
test('S3 body is allowlisted and ends with the first-published line',()=>{
  const content='<h1>Head</h1><p onclick="x()">Text <a href="/resources/other">rel</a> <a href="javascript:alert(1)">bad</a></p><script>alert(1)</script><iframe src="https://x"></iframe>';
  const xml=renderFeed([{...article,content}],s3);
  const enc=xml.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/)[1];
  assert.ok(enc.startsWith('<h2>Head</h2>'));
  assert.ok(enc.includes('<a href="https://smartmarinaconnect.com/resources/other">rel</a>'));
  for(const bad of ['onclick','javascript:','<script','<iframe','<h1']) assert.ok(!enc.toLowerCase().includes(bad),bad);
  assert.ok(enc.endsWith('<p><em>Article first published on <a href="https://smartmarinaconnect.com/resources/public-1?utm_source=s3monaco.com&amp;utm_medium=rss&amp;utm_campaign=article_feed">Smart Marina Connect</a>.</em></p>'));
});
