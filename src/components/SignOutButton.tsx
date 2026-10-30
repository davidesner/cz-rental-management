import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

export function useSignOut() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  return async function signOut() {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
    qc.clear();
    navigate('/login');
  };
}

export function SignOutButton() {
  const signOut = useSignOut();
  return <Button variant="ghost" onClick={signOut}>Odhlásit</Button>;
}
