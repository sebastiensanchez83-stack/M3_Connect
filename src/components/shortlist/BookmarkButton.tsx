import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Star, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { isMarinaLikePersona } from '@/types/database';
import { cn } from '@/lib/utils';

/** Personas allowed to maintain a private shortlist of organizations. */
function canMaintainShortlist(p: string | null | undefined): boolean {
  return isMarinaLikePersona(p) || p === 'investor';
}

interface BookmarkButtonProps {
  /** Organization being bookmarked. */
  organizationId: string;
  /** Optional display name (used in toast feedback). */
  organizationName?: string;
  /** "icon" = compact star only, "full" = button with text label. */
  variant?: 'icon' | 'full';
  /** Pass through to the underlying button. */
  className?: string;
  /** Called after the toggle succeeds — useful for refreshing parent state. */
  onChange?: (bookmarked: boolean) => void;
}

/**
 * Star toggle that adds/removes an organization to the current user's
 * private shortlist (`org_bookmarks`). Only renders for marina-like
 * personas (marina, developer); other users see nothing.
 */
export function BookmarkButton({
  organizationId,
  organizationName,
  variant = 'icon',
  className = '',
  onChange,
}: BookmarkButtonProps) {
  const { t } = useTranslation();
  const { user, profile, organization: ownOrg } = useAuth();
  const [bookmarked, setBookmarked] = useState<boolean | null>(null);
  const [toggling, setToggling] = useState(false);
  const userId = user?.id;

  const canBookmark = !!user
    && !!profile
    && canMaintainShortlist(profile.persona)
    && ownOrg?.id !== organizationId;

  // Load current state. Keyed on ids, not the `user` object: auth-js hands us a
  // new user object on every tab refocus, which would refire one SELECT per
  // card on list pages. The previous target's answer is dropped up front so a
  // click during the reload can't toggle from the wrong state.
  useEffect(() => {
    setBookmarked(null);
    if (!canBookmark || !userId) return;
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from('org_bookmarks')
        .select('id')
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (alive) setBookmarked(!!data);
    })();
    return () => { alive = false; };
  }, [canBookmark, userId, organizationId]);

  const handleToggle = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!user || toggling || bookmarked === null) return;
    setToggling(true);
    const nextBookmarked = !bookmarked;

    if (nextBookmarked) {
      const { error } = await supabase
        .from('org_bookmarks')
        .insert({ user_id: user.id, organization_id: organizationId });
      if (error) {
        if (import.meta.env.DEV) console.error('Bookmark save failed:', error);
        toast({ title: t('sharedUi.bookmarkButton.saveFailed', 'Could not save'), description: t('eventsPage.unexpectedError', 'An unexpected error occurred.'), variant: 'destructive' });
      } else {
        setBookmarked(true);
        onChange?.(true);
        toast({
          title: t('sharedUi.bookmarkButton.added', 'Added to shortlist'),
          description: organizationName
            ? t('sharedUi.bookmarkButton.addedDesc', '{{name}} is on your shortlist.', { name: organizationName })
            : undefined,
        });
      }
    } else {
      const { error } = await supabase
        .from('org_bookmarks')
        .delete()
        .eq('user_id', user.id)
        .eq('organization_id', organizationId);
      if (error) {
        if (import.meta.env.DEV) console.error('Bookmark remove failed:', error);
        toast({ title: t('sharedUi.bookmarkButton.removeFailed', 'Could not remove'), description: t('eventsPage.unexpectedError', 'An unexpected error occurred.'), variant: 'destructive' });
      } else {
        setBookmarked(false);
        onChange?.(false);
        toast({ title: t('sharedUi.bookmarkButton.removed', 'Removed from shortlist') });
      }
    }
    setToggling(false);
  }, [user, toggling, bookmarked, organizationId, organizationName, onChange, t]);

  if (!canBookmark || bookmarked === null) return null;

  const actionLabel = bookmarked
    ? t('sharedUi.bookmarkButton.remove', 'Remove from shortlist')
    : t('sharedUi.bookmarkButton.add', 'Add to shortlist');

  // Kit look: the star is meta grey at rest and navy on hover; on the shortlist it
  // is gold with a navy outline (fill + stroke, so it also holds inside the
  // directory's frosted .dir-star disc, which sets the icon's colour itself).
  // The caller's className is merged last (cn), so its colours and size win.
  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleToggle}
        disabled={toggling}
        title={actionLabel}
        aria-label={actionLabel}
        className={cn(
          'focus-ring inline-flex items-center justify-center rounded-pill p-1.5 text-meta transition-colors hover:bg-chip hover:text-navy disabled:opacity-50',
          className,
        )}
      >
        {toggling ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : bookmarked ? (
          <Star className="h-4 w-4 fill-gold stroke-navy" aria-hidden="true" />
        ) : (
          <Star className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
    );
  }

  // Full button: a navy outline pill; once on the shortlist the selected state,
  // gold with navy text and a navy star (a gold star would vanish on gold).
  return (
    <Button
      variant={bookmarked ? 'secondary' : 'outline'}
      size="sm"
      onClick={handleToggle}
      disabled={toggling}
      className={cn(
        'h-10 rounded-pill px-4 font-semibold text-navy',
        bookmarked ? 'border border-gold hover:bg-gold-hover' : 'border-navy/25 bg-white hover:border-navy hover:bg-chip hover:text-navy',
        className,
      )}
    >
      {toggling ? (
        <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
      ) : (
        <Star className={cn('h-4 w-4 mr-2', bookmarked && 'fill-navy stroke-navy')} aria-hidden="true" />
      )}
      {bookmarked
        ? t('sharedUi.bookmarkButton.onShortlist', 'On your shortlist')
        : t('sharedUi.bookmarkButton.add', 'Add to shortlist')}
    </Button>
  );
}
