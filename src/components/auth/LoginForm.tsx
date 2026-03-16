import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

interface LoginFormProps {
  onSuccess?: () => void;
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const { t } = useTranslation();
  const { signIn } = useAuth();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await signIn(email, password);

    if (error) {
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: t('auth.loginSuccess'),
      });
      onSuccess?.();
    }

    setLoading(false);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast({ title: t('common.error'), description: t('auth.enterEmailFirst', 'Please enter your email address'), variant: 'destructive' });
      return;
    }
    setForgotLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setForgotLoading(false);
    if (error) {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    } else {
      setForgotSent(true);
      toast({ title: t('auth.resetEmailSent', 'Reset email sent'), description: t('auth.checkEmailForReset', 'Check your email for a password reset link.') });
    }
  };

  if (forgotMode) {
    return (
      <form onSubmit={handleForgotPassword} className="space-y-4">
        <p className="text-sm text-gray-600">{t('auth.forgotPasswordDesc', 'Enter your email and we\'ll send you a link to reset your password.')}</p>
        <div className="space-y-2">
          <Label htmlFor="forgot-email">{t('auth.email')}</Label>
          <Input
            id="forgot-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        {forgotSent ? (
          <div className="text-center space-y-2">
            <p className="text-sm text-green-600 font-medium">{t('auth.resetEmailSent', 'Reset email sent! Check your inbox.')}</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setForgotMode(false); setForgotSent(false); }}>
              {t('auth.backToLogin', 'Back to login')}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Button type="submit" className="w-full" disabled={forgotLoading}>
              {forgotLoading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{t('common.loading')}</> : t('auth.sendResetLink', 'Send reset link')}
            </Button>
            <Button type="button" variant="ghost" className="w-full" size="sm" onClick={() => setForgotMode(false)}>
              {t('auth.backToLogin', 'Back to login')}
            </Button>
          </div>
        )}
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">{t('auth.email')}</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">{t('auth.password')}</Label>
          <button
            type="button"
            onClick={() => setForgotMode(true)}
            className="text-xs text-primary hover:underline"
          >
            {t('auth.forgotPassword')}
          </button>
        </div>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
            tabIndex={-1}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? t('common.loading') : t('auth.login')}
      </Button>
    </form>
  );
}
