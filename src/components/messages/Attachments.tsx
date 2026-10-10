import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileText, ImageIcon, Loader2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { attachmentType, downloadAttachment, formatBytes, isImageAttachment, type Attachment } from './messagesApi';

/**
 * The files of a message (messaging v2, 10 Oct 2026): photos as thumbnails that open
 * full size, PDFs as a card with their name, size and a "Download" button. The
 * bucket is private: photos are shown through short-lived signed links (`urls`,
 * by path, asked for by the conversation), a download asks for its own link.
 */

/** Downloads a file, telling the member in plain words when it did not work. */
export async function downloadOrTell(a: Attachment, t: (k: string, d: string) => string) {
  const result = await downloadAttachment(a).catch(() => 'failed' as const);
  if (result === 'gone') {
    toast({
      title: t('messages.files.goneTitle', 'File not available'),
      description: t('messages.files.gone', 'This file is no longer available. It may have been removed by the M3 team.'),
    });
  } else if (result === 'failed') {
    toast({
      title: t('messages.files.downloadFailedTitle', 'Download failed'),
      description: t('messages.files.downloadFailed', 'The file could not be downloaded. Please check your connection and try again.'),
      variant: 'destructive',
    });
  }
}

/** The colours of a bubble: mine (navy), a colleague's (light, on my side), the other company's (white). */
export type BubbleTone = 'me' | 'team' | 'them';

function DownloadButton({ attachment, tone, label }: { attachment: Attachment; tone: 'mine' | 'theirs' | 'plain'; label?: string }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await downloadOrTell(attachment, t);
        setBusy(false);
      }}
      aria-label={label ?? t('messages.files.downloadNamed', { name: attachment.name, defaultValue: 'Download {{name}}' })}
      className={cn(
        'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-pill px-3 text-[14px] font-semibold transition-colors focus:outline-none focus-visible:shadow-focus disabled:opacity-60',
        tone === 'mine' ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-chip text-navy hover:bg-foam',
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
      <span aria-hidden="true">{t('messages.files.download', 'Download')}</span>
    </button>
  );
}

/** A PDF in a bubble: icon, name, size, Download. */
function FileCard({ attachment: a, mine, pending }: { attachment: Attachment; mine: boolean; pending?: boolean }) {
  const { t } = useTranslation();
  return (
    // On a phone the Download button goes under the name (flex-wrap): the name stays readable.
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-field p-2.5', mine ? 'bg-white/10' : 'bg-page')}>
      <span className="flex min-w-0 flex-1 basis-[180px] items-center gap-3">
        <span aria-hidden="true" className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-field', mine ? 'bg-white/15 text-white' : 'bg-white text-navy ring-1 ring-rule')}>
          <FileText className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[14px] font-semibold leading-5 [overflow-wrap:anywhere]" title={a.name}>{a.name}</span>
          <span className={cn('block text-[12px] leading-4', mine ? 'text-white/75' : 'text-meta')}>
            {[a.mime === 'application/pdf' ? 'PDF' : t('messages.files.file', 'File'), formatBytes(a.size)].filter(Boolean).join(' · ')}
          </span>
        </span>
      </span>
      {!pending && <span className="ml-auto"><DownloadButton attachment={a} tone={mine ? 'mine' : 'theirs'} /></span>}
    </div>
  );
}

/** The files of one message. */
export function MessageAttachments({
  attachments,
  mine,
  urls,
  pending = false,
  onOpenImage,
  onImageError,
}: {
  attachments: Attachment[];
  /** On a navy bubble (white text). */
  mine: boolean;
  /** Signed links of the photos, by path. */
  urls: Record<string, string>;
  pending?: boolean;
  onOpenImage: (a: Attachment) => void;
  /** A photo did not load (its link ran out): ask for a new one. */
  onImageError?: (path: string) => void;
}) {
  const { t } = useTranslation();
  const images = attachments.filter(isImageAttachment);
  const files = attachments.filter((a) => !isImageAttachment(a));
  return (
    <div className="space-y-1.5">
      {images.length > 0 && (
        <div className={cn('grid gap-1.5', images.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
          {images.map((a) => {
            const src = a.localUrl ?? urls[a.path];
            return (
              <button
                key={a.path || a.name}
                type="button"
                disabled={pending}
                onClick={() => onOpenImage(a)}
                className={cn(
                  'group relative block overflow-hidden rounded-[12px] bg-chip focus:outline-none focus-visible:shadow-focus',
                  images.length > 1 ? 'aspect-square w-full' : 'max-h-72 w-full max-w-[260px]',
                )}
                aria-label={t('messages.files.openPhoto', { name: a.name, defaultValue: 'Open the photo {{name}}' })}
              >
                {src ? (
                  <img
                    src={src}
                    alt=""
                    loading="lazy"
                    onError={() => { if (!a.localUrl && a.path) onImageError?.(a.path); }}
                    className={cn('block h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100', images.length > 1 ? '' : 'max-h-72')}
                  />
                ) : (
                  <span className="grid aspect-[4/3] w-full place-items-center text-meta">
                    <ImageIcon className="h-6 w-6" aria-hidden="true" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {files.map((a) => <FileCard key={a.path || a.name} attachment={a} mine={mine} pending={pending} />)}
    </div>
  );
}

/** A photo full size, with its name and a Download button. */
export function ImageLightbox({
  attachment,
  url,
  onClose,
  onImageError,
}: {
  attachment: Attachment | null;
  url: string | null;
  onClose: () => void;
  onImageError?: (path: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={!!attachment} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-24px)] max-w-4xl gap-3 rounded-card border-0 bg-navy-deep p-3 text-white sm:p-4 [&>button:last-child]:hidden">
        {attachment && (
          <>
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-[15px] font-semibold leading-6 text-white">{attachment.name}</DialogTitle>
                <DialogDescription className="text-[13px] leading-5 text-white/70">{formatBytes(attachment.size)}</DialogDescription>
              </div>
              <DownloadButton attachment={attachment} tone="mine" />
              <button
                type="button"
                onClick={onClose}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-pill text-white transition-colors hover:bg-white/15 focus:outline-none focus-visible:shadow-focus"
                aria-label={t('common.close', 'Close')}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="grid min-h-[200px] place-items-center overflow-hidden rounded-field bg-black/30">
              {url ? (
                <img
                  src={url}
                  alt={attachment.name}
                  onError={() => { if (!attachment.localUrl && attachment.path) onImageError?.(attachment.path); }}
                  className="max-h-[calc(92dvh-110px)] w-auto max-w-full object-contain"
                />
              ) : (
                <Loader2 className="h-6 w-6 animate-spin text-white/70 motion-reduce:animate-none" aria-hidden="true" />
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A file chosen in the composer, before it is sent: photo preview or icon, name, size, remove. */
export function AttachmentChip({ file, onRemove, disabled }: { file: File; onRemove: () => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const isImage = attachmentType(file).startsWith('image/');
  const preview = useMemo(() => (isImage ? URL.createObjectURL(file) : null), [file, isImage]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  return (
    <li className="flex min-w-0 max-w-full items-center gap-2 rounded-field border border-rule bg-white py-1 pl-1 pr-1 sm:max-w-[260px]">
      {preview
        ? <img src={preview} alt="" className="h-9 w-9 shrink-0 rounded-[8px] object-cover" />
        : <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-chip text-navy"><FileText className="h-4 w-4" /></span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold leading-[18px] text-navy" title={file.name}>{file.name}</span>
        <span className="block text-[12px] leading-4 text-meta">{formatBytes(file.size)}</span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-pill text-meta transition-colors hover:bg-chip hover:text-navy focus:outline-none focus-visible:shadow-focus disabled:opacity-50"
        aria-label={t('messages.files.remove', { name: file.name, defaultValue: 'Remove {{name}}' })}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </li>
  );
}
