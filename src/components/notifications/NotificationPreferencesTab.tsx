import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import {
  Bell, Link2, ClipboardList, Award, Calendar, CreditCard, Users, ShieldCheck, Mail, Info,
} from 'lucide-react';
import type { NotificationCategory } from '@/types/database';

interface CategoryDef {
  key: NotificationCategory;
  icon: React.ReactNode;
  title: string;
  description: string;
  examples: string;
  critical?: boolean;
}

const CATEGORIES: CategoryDef[] = [
  {
    key: 'b2b',
    icon: <Link2 className="h-5 w-5 text-blue-500" />,
    title: 'B2B connections',
    description: 'Partner contact requests, introductions, declines.',
    examples: 'Examples: new partner_request_received, partner_request_accepted intro, partner_request_rejected.',
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
    description: 'Sponsorship and exposition invoices, payment confirmations, sponsorship tier upgrades.',
    examples: 'Examples: sponsorship_invoice_sent, sponsorship_approved, payment_confirmed.',
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
    icon: <Mail className="h-5 w-5 text-gray-500" />,
    title: 'Invitations & welcome',
    description: 'Onboarding emails the M3 team sends to introduce the platform.',
    examples: 'Examples: partner_onboarding_welcome.',
  },
];

export function NotificationPreferencesTab() {
  const { user, profile, refreshProfile } = useAuth();
  const [prefs, setPrefs] = useState<Record<string, boolean>>(profile?.notification_prefs || {});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  if (!user || !profile) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
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

    const { error } = await supabase
      .from('profiles')
      .update({ notification_prefs: nextPrefs })
      .eq('user_id', user.id);

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
      {/* Header */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            Notification preferences
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600">
            Choose which email notifications you want to receive. Everything is on by default. Turning a category off applies immediately and silently skips matching emails — you can re-enable any category at any time.
          </p>
          <div className="mt-3 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <p>
              <strong>Account lifecycle</strong> emails (approval, rejection, organization claim codes) are critical for using the platform. We strongly recommend keeping them on.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Toggles */}
      <div className="space-y-3">
        {CATEGORIES.map((cat) => {
          const enabled = isEnabled(cat.key);
          return (
            <Card key={cat.key} className={enabled ? '' : 'opacity-70'}>
              <CardContent className="py-4">
                <div className="flex items-start gap-4">
                  <div className="shrink-0 mt-0.5">{cat.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium text-gray-900">{cat.title}</h3>
                      {cat.critical && (
                        <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 bg-amber-50">
                          Recommended on
                        </Badge>
                      )}
                      {savingKey === cat.key && (
                        <span className="text-[10px] text-gray-400">Saving…</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mt-0.5">{cat.description}</p>
                    <p className="text-xs text-gray-400 mt-1.5">{cat.examples}</p>
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

      <p className="text-xs text-gray-400 text-center">
        Changes save automatically. Anonymous notifications (e.g. team invitations sent to someone who doesn't have an account yet) are not affected by these preferences.
      </p>
    </div>
  );
}
