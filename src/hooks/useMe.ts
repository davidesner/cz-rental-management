import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Me {
  user: { id: string; email: string; name: string };
  memberships: Array<{ membershipId: string; orgId: string; orgName: string; role: 'owner' | 'member' }>;
  activeOrgId: string | null;
}

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/api/me'),
    retry: false,
  });
}
