import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Star, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { isMarinaLikePersona } from '@/types/database';

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
  const { user, profile, organization: ownOrg } = useAuth();
  const [bookmarked, setBookmarked] = useState<boolean | null>(null);
  const [toggling, setToggling] = useState(false);

  const canBookmark = !!user
    && !!profile
    && isMarinaLikePersona(profile.persona)
    && ownOrg?.id !== organizationId;

  // Load current state
  useEffect(() => {
    if (!canBookmark || !user) {
      setBookmarked(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('org_bookmarks')
        .select('id')
        .eq('user_id', user.id)
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (!cancelled) setBookmarked(!!data);
    })();
    return () => { cancelled = true; };
  }, [canBookmark, user, organizationId]);

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
        toast({ title: 'Could not save', description: error.message, variant: 'destructive' });
      } else {
        setBookmarked(true);
        onChange?.(true);
        toast({
          title: 'Added to shortlist',
          description: organizationName ? `${organizationName} is on your shortlist.` : undefined,
        });
      }
    } else {
      const { error } = await supabase
        .from('org_bookmarks')
        .delete()
        .eq('user_id', user.id)
        .eq('organization_id', organizationId);
      if (error) {
        toast({ title: 'Could not remove', description: error.message, variant: 'destructive' });
      } else {
        setBookmarked(false);
        onChange?.(false);
        toast({ title: 'Removed from shortlist' });
      }
    }
    setToggling(false);
  }, [user, toggling, bookmarked, organizationId, organizationName, onChange]);

  if (!canBookmark || bookmarked === null) return null;

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleToggle}
        disabled={toggling}
        title={bookmarked ? 'Remove from shortlist' : 'Add to shortlist'}
        aria-label={bookmarked ? 'Remove from shortlist' : 'Add to shortlist'}
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
      {bookmarked ? 'On your shortlist' : 'Add to shortlist'}
    </Button>
  );
}
