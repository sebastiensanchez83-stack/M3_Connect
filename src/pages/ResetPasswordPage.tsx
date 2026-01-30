import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [verified, setVerified] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasVerified = useRef(false);

  useEffect(() => {
    // Prevent double execution in StrictMode
    if (hasVerified.current) return;
    
    const tokenHash = searchParams.get('token_hash');
    const type = searchParams.get('type');

    if (!tokenHash || type !== 'recovery') {
      setError('Invalid or missing reset link. Please request a new password reset.');
      setVerifying(false);
      return;
    }

    hasVerified.current = true;

    const verifyToken = async () => {
      try {
        const { data, error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: 'recovery',
        });

        if (verifyError) {
          setError('This reset link has expired or is invalid. Please request a new one.');
        } else if (data?.session) {
          setVerified(true);
        } else {
          setError('Could not verify reset link. Please request a new one.');
        }
      } catch (err) {
        setError('An error occurred. Please try again.');
      } finally {
        setVerifying(false);
      }
    };

    verifyToken();
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast({ title: 'Error', description: 'Passwords do not match', variant: 'destructive' });
      return;
    }

    if (password.length < 6) {
      toast({ title: 'Error', description: 'Password must be at least 6 characters', variant: 'destructive' });
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
        setLoading(false);
      } else {
        setSuccess(true);
        toast({ title: 'Success', description: 'Password updated successfully' });
        await supabase.auth.signOut();
        setTimeout(() => navigate('/'), 2000);
      }
    } catch (err) {
      toast({ title: 'Error', description: 'An error occurred.', variant: 'destructive' });
      setLoading(false);
    }
  };

  if (verifying) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-md">
        <Card>
          <CardContent className="pt-6 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p className="text-gray-600">Verifying reset link...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-md">
        <Card>
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Link Invalid</h2>
            <p className="text-gray-600 mb-4">{error}</p>
            <Button onClick={() => navigate('/')}>Return Home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-md">
        <Card>
          <CardContent className="pt-6 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Password Updated!</h2>
            <p className="text-gray-600">Redirecting to login...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!verified) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-md">
        <Card>
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Session Error</h2>
            <p className="text-gray-600 mb-4">Could not establish session.</p>
            <Button onClick={() => navigate('/')}>Return Home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-16 max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Reset Your Password</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter new password"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Update Password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
