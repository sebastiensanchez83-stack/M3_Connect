import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

interface SignupFormProps {
  onSuccess?: () => void;
}

export function SignupForm({ onSuccess }: SignupFormProps) {
  const { signUp } = useAuth();

  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({ email: '', password: '', confirmPassword: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.password !== formData.confirmPassword) {
      toast({ title: 'Erreur', description: 'Les mots de passe ne correspondent pas.', variant: 'destructive' });
      return;
    }

    if (formData.password.length < 8) {
      toast({ title: 'Erreur', description: 'Mot de passe trop court (min. 8 caractères).', variant: 'destructive' });
      return;
    }

    setLoading(true);
    const { error } = await signUp(formData.email, formData.password);
    setLoading(false);

    if (error) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
      return;
    }

    toast({
      title: 'Inscription réussie !',
      description: "Vérifiez votre email pour confirmer votre compte, puis connectez-vous pour compléter votre profil.",
    });

    onSuccess?.();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Email</Label>
        <Input
          type="email"
          required
          value={formData.email}
          onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
          placeholder="you@company.com"
        />
      </div>

      <div className="space-y-2">
        <Label>Mot de passe</Label>
        <Input
          type="password"
          required
          value={formData.password}
          onChange={(e) => setFormData((p) => ({ ...p, password: e.target.value }))}
          placeholder="Min. 8 caractères"
        />
      </div>

      <div className="space-y-2">
        <Label>Confirmer le mot de passe</Label>
        <Input
          type="password"
          required
          value={formData.confirmPassword}
          onChange={(e) => setFormData((p) => ({ ...p, confirmPassword: e.target.value }))}
        />
      </div>

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Création...</> : 'Créer mon compte'}
      </Button>
    </form>
  );
}                <div className="font-semibold text-gray-900 group-hover:text-primary">{p.title}</div>
                <div className="text-sm text-gray-500">{p.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const selected = personas.find((p) => p.value === selectedPersona);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <button type="button" onClick={() => setStep(1)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ChevronLeft className="h-4 w-4" /> Retour
      </button>
      {selected && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
          <div className="text-primary">{selected.icon}</div>
          <div><div className="font-medium text-primary">{selected.title}</div><div className="text-xs text-gray-500">{selected.desc}</div></div>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="email">Email professionnel *</Label>
        <Input id="email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} required placeholder="vous@exemple.com" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Mot de passe *</Label>
        <Input id="password" type="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} required minLength={8} placeholder="Min. 8 caractères" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirmer le mot de passe *</Label>
        <Input id="confirmPassword" type="password" value={formData.confirmPassword} onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })} required />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        {loading ? 'Création...' : 'Créer mon compte'}
      </Button>
    </form>
  );
}
