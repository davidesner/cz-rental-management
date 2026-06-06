import { useForm } from 'react-hook-form';
import { useNavigate, Link } from 'react-router-dom';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useQueryClient } from '@tanstack/react-query';

interface RegisterForm { email: string; password: string; name: string }

export function RegisterPage() {
  const { register, handleSubmit } = useForm<RegisterForm>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(values: RegisterForm) {
    setError(null);
    const res = await fetch('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError((body as { message?: string } | null)?.message ?? 'Registration failed');
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['me'] });
    navigate('/');
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Vytvořit účet</CardTitle>
          <CardDescription>Začni spravovat své pronájmy dnes.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
            <div>
              <Label htmlFor="name">Jméno</Label>
              <Input id="name" type="text" {...register('name', { required: true })} />
            </div>
            <div>
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" {...register('email', { required: true })} />
            </div>
            <div>
              <Label htmlFor="password">Heslo</Label>
              <Input id="password" type="password" {...register('password', { required: true })} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full">Vytvořit účet</Button>
            <p className="text-sm text-muted-foreground text-center">
              Už máš účet? <Link className="underline" to="/login">Přihlásit</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
