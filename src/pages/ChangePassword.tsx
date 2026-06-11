import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useMe } from '@/hooks/useMe';

interface ChangePasswordForm {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export function ChangePasswordPage() {
  const { data: me } = useMe();
  const { register, handleSubmit, watch } = useForm<ChangePasswordForm>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const newPassword = watch('newPassword');

  async function onSubmit(values: ChangePasswordForm) {
    setError(null);
    if (values.newPassword !== values.confirmPassword) {
      setError('Nová hesla se neshodují.');
      return;
    }
    if (values.newPassword.length < 10) {
      setError('Nové heslo musí mít alespoň 10 znaků.');
      return;
    }
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        revokeOtherSessions: true,
      }),
    });
    if (!res.ok) {
      setError('Nelze změnit heslo. Zkontrolujte současné heslo.');
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['me'] });
    navigate('/');
  }

  const forced = me?.user.mustChangePassword === true;

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Změnit heslo</CardTitle>
          <CardDescription>
            {forced
              ? 'Tvůj účet byl založen ručně — pro pokračování si nastav vlastní heslo.'
              : 'Změna hesla tvého účtu.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
            <div>
              <Label htmlFor="currentPassword">Současné heslo</Label>
              <Input id="currentPassword" type="password" autoComplete="current-password" {...register('currentPassword', { required: true })} />
            </div>
            <div>
              <Label htmlFor="newPassword">Nové heslo (min. 10 znaků)</Label>
              <Input id="newPassword" type="password" autoComplete="new-password" {...register('newPassword', { required: true, minLength: 10 })} />
            </div>
            <div>
              <Label htmlFor="confirmPassword">Nové heslo znovu</Label>
              <Input id="confirmPassword" type="password" autoComplete="new-password" {...register('confirmPassword', { required: true })} />
            </div>
            {newPassword && newPassword.length > 0 && newPassword.length < 10 && (
              <p className="text-sm text-muted-foreground">Heslo musí mít alespoň 10 znaků.</p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full">Uložit nové heslo</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
