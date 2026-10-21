import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AtSign } from 'lucide-react';
import { ROW_FOCUS } from '@/components/member/MemberUI';
import { commentAnchor, fetchMyNotices, markNoticesSeen, type CommentNotice } from '@/lib/articleComments';
import { resourcePath } from '@/lib/seoMeta';
import { cn } from '@/lib/utils';
import { ActionCue } from './DashboardKit';
import { EditDialog } from './EditKit';

/**
 * "You were tagged in a comment" on the dashboard (switch article_comments): the notices
 * not seen yet (resource_comment_my_notices). The To do shows one line for them; pressing it
 * opens the comment itself when there is one, else this small window with each of them. Opening
 * a comment marks its notice seen (so does reading it on the article page).
 */
export function useCommentNotices(enabled: boolean) {
  const [items, setItems] = useState<CommentNotice[]>([]);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!enabled) { setItems([]); return; }
    let alive = true;
    fetchMyNotices()
      .then((rows) => { if (alive) setItems(rows); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [enabled, version]);
  const refresh = useCallback(() => setVersion((n) => n + 1), []);
  return { items, refresh };
}

/** Where a notice leads: the article, on the comment. */
export function noticeHref(n: CommentNotice): string {
  return `${resourcePath({ id: n.resource_id, slug: n.resource_slug })}#${commentAnchor(n.comment_id)}`;
}

/** The comment of a notice: marked seen, then opened. */
export function useOpenNotice(onSeen: () => void) {
  const navigate = useNavigate();
  return (n: CommentNotice) => {
    void markNoticesSeen([n.notice_id]).catch(() => undefined).finally(onSeen);
    navigate(noticeHref(n));
  };
}

export function CommentNoticesDialog({
  open,
  onOpenChange,
  items,
  onSeen,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommentNotice[];
  onSeen: () => void;
}) {
  const { t } = useTranslation();
  const openNotice = useOpenNotice(onSeen);
  return (
    <EditDialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      quietClose
      title={t('dash.mentions.title', 'You were tagged in comments')}
      description={t('dash.mentions.desc', 'Press a comment to read it under its article and answer.')}
      saveLabel={t('dash.mentions.later', 'I will read them later')}
    >
      <ul className="divide-y divide-rule overflow-hidden rounded-field border border-rule">
        {items.map((n) => (
          <li key={n.notice_id}>
            <button
              type="button"
              onClick={() => { onOpenChange(false); openNotice(n); }}
              className={cn('group flex w-full cursor-pointer items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-page active:bg-chip', ROW_FOCUS)}
            >
              <span aria-hidden="true" className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gold/25 text-navy">
                <AtSign className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">
                  {n.via_org_name
                    ? t('dash.mentions.lineOrg', { name: n.author_name, org: n.via_org_name, defaultValue: '{{name}} tagged {{org}}' })
                    : t('dash.mentions.line', { name: n.author_name, defaultValue: '{{name}} tagged you' })}
                </span>
                <span className="block text-[14px] leading-5 text-meta [overflow-wrap:anywhere]">
                  {t('dash.mentions.on', { title: n.resource_title, defaultValue: 'Under "{{title}}"' })}
                </span>
                {n.excerpt && (
                  <span className="mt-1 block text-[15px] leading-6 text-ink [overflow-wrap:anywhere]">“{n.excerpt}”</span>
                )}
                <span className="mt-2 flex">
                  <ActionCue size="sm">{t('dash.mentions.read', 'Read the comment')}</ActionCue>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </EditDialog>
  );
}
