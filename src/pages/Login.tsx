import { useForm } from 'react-hook-form';
import { useNavigate, Link } from 'react-router-dom';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useQueryClient } from '@tanstack/react-query';

interface LoginForm { email: string; password: string }

export function LoginPage() {
  const { register, handleSubmit } = useForm<LoginForm>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(values: LoginForm) {
    setError(null);
    const res = await fetch('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(values),
    });
    if (!res.ok) { setError('Nesprávné přihlašovací údaje'); return; }
    await queryClient.invalidateQueries({ queryKey: ['me'] });
    navigate('/');
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Přihlásit</CardTitle>
          <CardDescription>Vítej zpátky na správě pronájmu.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
            <div>
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" {...register('email', { required: true })} />
            </div>
            <div>
              <Label htmlFor="password">Heslo</Label>
              <Input id="password" type="password" {...register('password', { required: true })} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full">Přihlásit</Button>
            <p className="text-sm text-muted-foreground text-center">
              Nemáš účet? <Link className="underline" to="/register">Registrovat</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
