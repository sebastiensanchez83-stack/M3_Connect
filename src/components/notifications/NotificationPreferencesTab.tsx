import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { saveNotificationPrefs } from '@/components/account/profileActions';
import { toast } from '@/hooks/use-toast';
import {
  AtSign, Bell, Link2, ClipboardList, Award, Calendar, CreditCard, Users, ShieldCheck, Mail, Info,
} from 'lucide-react';
import { useRegistrationFlags, type RegistrationFlag } from '@/lib/flags';
import type { NotificationCategory } from '@/types/database';
import { cn } from '@/lib/utils';

interface CategoryDef {
  key: NotificationCategory;
  icon: React.ReactNode;
  title: string;
  description: string;
  examples: string;
  critical?: boolean;
  /** Shown only while this registration switch is on (a kind of e-mail that does not exist before). */
  flag?: RegistrationFlag;
}

export const CATEGORIES: CategoryDef[] = [
  {
    key: 'b2b',
    icon: <Link2 className="h-5 w-5 text-blue-500" />,
    title: 'Messages from companies',
    description: 'The Friday summary of new messages and requests from other companies, and the e-mail when a company accepts yours.',
    examples: 'Examples: "This week you received 3 messages", the introduction when a company accepts your message.',
  },
  {
    key: 'comments',
    icon: <AtSign className="h-5 w-5 text-sky-600" />,
    title: 'Comments',
    description: 'When someone tags you or your company in a comment under an article.',
    examples: 'Example: "Alex Morel tagged you in a comment".',
    flag: 'article_comments',
  },
  {
    key: 'submissions',
    icon: <ClipboardList className="h-5 w-5 text-emerald-500" />,
    title: 'Your submissions',
    description: 'Status updates on the RFPs, consultations, projects, and webinars you submit.',
    examples: 'Examples: rfp_approved, consultation_rejected, project_status_updated, webinar_accepted.',
  },
  {
    key: 'recommendations',
    icon: <Award className="h-5 w-5 text-amber-500" />,
    title: 'Marina recommendations',
    description: 'When a marina contact confirms or declines a recommendation request you sent.',
    examples: 'Examples: reference_confirmed, reference_rejected.',
  },
  {
    key: 'events',
    icon: <Calendar className="h-5 w-5 text-violet-500" />,
    title: 'Events',
    description: 'Event registrations, webinar reminders, exposition decisions.',
    examples: 'Examples: event_registration_confirmed, exposition_approved.',
  },
  {
    key: 'payments',
    icon: <CreditCard className="h-5 w-5 text-rose-500" />,
    title: 'Payments & invoices',
    description: 'Sponsorship and exhibition invoices, sponsor level changes. Payment receipts are always sent.',
    examples: 'Examples: your sponsorship invoice, a change of sponsor level.',
  },
  {
    key: 'team',
    icon: <Users className="h-5 w-5 text-cyan-500" />,
    title: 'Team & invitations',
    description: 'Team invitations to your org, join requests, and reminders.',
    examples: 'Examples: team_invitation, team_invitation_reminder, join_request_approved.',
  },
  {
    key: 'account',
    icon: <ShieldCheck className="h-5 w-5 text-green-600" />,
    title: 'Account lifecycle',
    description: 'Critical account events: approval, rejection, organization claim codes.',
    examples: 'Examples: user_account_approved, user_account_rejected, org_claim_code.',
    critical: true,
  },
  {
    key: 'marketing',
    icon: <Mail className="h-5 w-5 text-meta" />,
    title: 'Invitations & welcome',
    description: 'Onboarding emails the M3 team sends to introduce the platform.',
    examples: 'Examples: partner_onboarding_welcome.',
  },
];

/** The categories to show: those of a switch that is off are left out. */
export function useVisibleCategories(): CategoryDef[] {
  const { flags } = useRegistrationFlags();
  return CATEGORIES.filter((c) => !c.flag || flags[c.flag]);
}

export function NotificationPreferencesTab() {
  const categories = useVisibleCategories();
  const { user, profile, refreshProfile } = useAuth();
  const [prefs, setPrefs] = useState<Record<string, boolean>>(profile?.notification_prefs || {});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  if (!user || !profile) {
    return (
      <div className="flex items-center justify-center py-16 text-meta/60 text-sm">
        Sign in to manage your notification preferences.
      </div>
    );
  }

  const isEnabled = (key: NotificationCategory): boolean => {
    // Missing key in the JSON map = ON (preserves existing platform behavior).
    return prefs[key] !== false;
  };

  const handleToggle = async (key: NotificationCategory, enabled: boolean) => {
    setSavingKey(key);
    const nextPrefs = { ...prefs, [key]: enabled };
    setPrefs(nextPrefs); // optimistic

    let error: Error | null = null;
    try {
      await saveNotificationPrefs(user.id, nextPrefs);
    } catch (err: unknown) {
      error = err instanceof Error ? err : new Error(String(err));
    }

    if (error) {
      // revert on failure
      setPrefs(prefs);
      toast({ title: 'Could not save', description: error.message, variant: 'destructive' });
    } else {
      // refresh AuthContext so the new prefs flow through
      refreshProfile?.();
    }
    setSavingKey(null);
  };

  return (
    <div className="space-y-6">
      {/* Intro */}
      <Card className="rounded-card shadow-none">
        <CardContent className="space-y-4 p-5">
          <p className="max-w-3xl text-[15px] leading-6 text-meta">
            Choose which email notifications you want to receive. Everything is on by default. Turning a category off applies immediately and silently skips matching emails — you can re-enable any category at any time.
          </p>
          <div className="flex items-start gap-3 rounded-card border border-amber-200 bg-amber-50 p-4 text-[14px] leading-5 text-amber-950">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
            <p>
              <strong>Account lifecycle</strong> emails (approval, rejection, organization claim codes) are critical for using the platform. We strongly recommend keeping them on.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Toggles */}
      <div className="space-y-3">
        {categories.map((cat) => {
          const enabled = isEnabled(cat.key);
          return (
            <Card key={cat.key} className={cn('rounded-card shadow-none', !enabled && 'opacity-70')}>
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-start gap-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-chip text-navy [&_svg]:!text-navy">{cat.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-[15px] font-semibold leading-5 text-navy">{cat.title}</h3>
                      {cat.critical && (
                        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[12px] font-semibold text-amber-900">
                          Recommended on
                        </Badge>
                      )}
                      {savingKey === cat.key && (
                        <span className="text-[10px] text-meta/60">Saving…</span>
                      )}
                    </div>
                    <p className="mt-1 text-[14px] leading-5 text-meta">{cat.description}</p>
                    <p className="mt-1.5 text-[13px] leading-[18px] text-meta/80">{cat.examples}</p>
                  </div>
                  <div className="shrink-0">
                    <Switch
                      checked={enabled}
                      onCheckedChange={(v) => handleToggle(cat.key, v)}
                      disabled={savingKey === cat.key}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-meta/60 text-center">
        Changes save automatically. Anonymous notifications (e.g. team invitations sent to someone who doesn't have an account yet) are not affected by these preferences.
      </p>
    </div>
  );
}
