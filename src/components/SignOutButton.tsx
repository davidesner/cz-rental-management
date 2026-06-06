import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

export function SignOutButton() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  async function signOut() {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
    qc.clear();
    navigate('/login');
  }
  return <Button variant="ghost" onClick={signOut}>Odhlásit</Button>;
}
