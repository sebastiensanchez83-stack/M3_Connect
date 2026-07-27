import { useState, useEffect } from 'react';
import { FileText, Download, Loader2, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Press room — articles. Accredited media download any published article as a
// PDF generated on the fly from its content. Every download is recorded through
// media_log_download(), which derives the identity from auth.uid() server-side,
// so the log can't be spoofed by the client.

interface Article {
  id: string; title: string; summary: string | null; content: string | null;
  topic: string | null; published_at: string | null;
}

// TipTap stores HTML. Flatten it to text the PDF can lay out, keeping the
// paragraph breaks that block-level tags imply.
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '  - ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function MediaArticles() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('resources')
        .select('id, title, summary, content, topic, published_at')
        .eq('type', 'article').eq('published', true)
        .order('published_at', { ascending: false });
      setArticles((data || []) as Article[]);
      setLoading(false);
    })();
  }, []);

  const downloadPdf = async (a: Article) => {
    setBusy(a.id);
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const M = 56;                                   // margin
      const W = doc.internal.pageSize.getWidth() - M * 2;
      const H = doc.internal.pageSize.getHeight();
      let y = M;

      const write = (text: string, size: number, style: 'normal' | 'bold', gap: number) => {
        doc.setFont('helvetica', style); doc.setFontSize(size);
        for (const line of doc.splitTextToSize(text, W)) {
          if (y > H - M) { doc.addPage(); y = M; }
          doc.text(line, M, y); y += size * 1.35;
        }
        y += gap;
      };

      write(a.title, 20, 'bold', 6);
      const meta = [a.topic, a.published_at ? new Date(a.published_at).toLocaleDateString('en-GB') : null]
        .filter(Boolean).join('  ·  ');
      if (meta) { doc.setTextColor(120); write(meta, 10, 'normal', 10); doc.setTextColor(0); }
      if (a.summary) { doc.setTextColor(60); write(a.summary, 12, 'bold', 12); doc.setTextColor(0); }
      if (a.content) write(htmlToText(a.content), 11, 'normal', 0);

      // Footer on every page
      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i); doc.setFontSize(8); doc.setTextColor(150);
        doc.text(`Smart Marina Connect  ·  ${i}/${pages}`, M, H - 24);
      }

      const safe = a.title.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 60) || 'article';
      doc.save(`${safe}.pdf`);

      // Log AFTER the file is produced, so we only record real downloads.
      const { error } = await supabase.rpc('media_log_download', {
        p_resource_type: 'article', p_resource_id: a.id, p_label: a.title,
      });
      if (error) console.warn('download log failed', error.message);
    } catch (e) {
      toast({ title: 'Could not generate the PDF', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="py-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-300" /></div>;

  const term = q.trim().toLowerCase();
  const shown = term
    ? articles.filter(a => `${a.title} ${a.summary || ''} ${a.topic || ''}`.toLowerCase().includes(term))
    : articles;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" /> Articles
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Download any published article as a PDF to reuse in your coverage.
        </p>
      </div>

      {articles.length > 4 && (
        <div className="relative max-w-sm">
          <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search articles" className="pl-9" />
        </div>
      )}

      {shown.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-gray-400">
          {articles.length === 0 ? 'No articles published yet.' : 'No article matches your search.'}
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {shown.map(a => (
            <Card key={a.id}>
              <CardContent className="py-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900">{a.title}</div>
                  {a.summary && <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{a.summary}</p>}
                  <div className="flex items-center gap-2 mt-1.5">
                    {a.topic && <Badge variant="secondary" className="text-xs">{a.topic}</Badge>}
                    {a.published_at && (
                      <span className="text-xs text-gray-400">
                        {new Date(a.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    )}
                  </div>
                </div>
                <Button size="sm" variant="outline" className="gap-1.5 shrink-0"
                  disabled={busy === a.id} onClick={() => downloadPdf(a)}>
                  {busy === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
