import { useState, useEffect } from 'react';
import { FileText, Download, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CardShell } from '@/components/brand/CardShell';
import { BTN_OUTLINE, MemberEmpty } from '@/components/member/MemberUI';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

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

  if (loading) return <div className="py-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-meta" /></div>;

  const term = q.trim().toLowerCase();
  const shown = term
    ? articles.filter(a => `${a.title} ${a.summary || ''} ${a.topic || ''}`.toLowerCase().includes(term))
    : articles;

  return (
    <div className="space-y-4">
      {/* Head: the icon tile and title of the press room's other blocks (an h3 under the tab's h2). */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-field bg-chip text-navy" aria-hidden="true">
            <FileText className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-card-title text-navy">Articles</h3>
            <p className="mt-0.5 text-[14px] leading-5 text-meta">
              Download any published article as a PDF to reuse in your coverage.
            </p>
          </div>
        </div>

        {articles.length > 4 && (
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-meta" aria-hidden="true" />
            <Input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search articles"
              aria-label="Search articles"
              className="rounded-pill bg-white pl-10"
            />
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <CardShell>
          <MemberEmpty
            icon={articles.length === 0 ? FileText : Search}
            title={articles.length === 0 ? 'No articles published yet.' : 'No article matches your search.'}
          />
        </CardShell>
      ) : (
        <ul className="space-y-3">
          {shown.map(a => (
            <CardShell as="li" key={a.id} className="flex-row items-start justify-between gap-4 p-4 sm:p-5">
              <div className="min-w-0">
                <p className="text-[16px] font-semibold leading-6 text-navy">{a.title}</p>
                {a.summary && <p className="mt-1 line-clamp-2 text-[14px] leading-5 text-meta">{a.summary}</p>}
                {(a.topic || a.published_at) && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {a.topic && <Badge variant="secondary" className="border-transparent bg-chip text-[12px] font-medium text-navy hover:bg-chip">{a.topic}</Badge>}
                    {a.published_at && (
                      <span className="text-[13px] leading-5 text-meta">
                        {new Date(a.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <Button variant="outline" className={cn(BTN_OUTLINE, 'shrink-0 gap-1.5')}
                disabled={busy === a.id} onClick={() => downloadPdf(a)}
                aria-label={`Download "${a.title}" as a PDF`}>
                {busy === a.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />} PDF
              </Button>
            </CardShell>
          ))}
        </ul>
      )}
    </div>
  );
}
