import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Star, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { isMarinaLikePersona } from '@/types/database';

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

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleToggle}
        disabled={toggling}
        title={actionLabel}
        aria-label={actionLabel}
        className={`inline-flex items-center justify-center rounded-full p-1.5 transition-colors hover:bg-amber-50 disabled:opacity-50 ${className}`}
      >
        {toggling ? (
          <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
        ) : bookmarked ? (
          <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
        ) : (
          <Star className="h-4 w-4 text-gray-400" />
        )}
      </button>
    );
  }

  return (
    <Button
      variant={bookmarked ? 'secondary' : 'outline'}
      size="sm"
      onClick={handleToggle}
      disabled={toggling}
      className={className}
    >
      {toggling ? (
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
      ) : (
        <Star className={`h-4 w-4 mr-2 ${bookmarked ? 'fill-amber-400 text-amber-400' : ''}`} />
      )}
      {bookmarked
        ? t('sharedUi.bookmarkButton.onShortlist', 'On your shortlist')
        : t('sharedUi.bookmarkButton.add', 'Add to shortlist')}
    </Button>
  );
}
