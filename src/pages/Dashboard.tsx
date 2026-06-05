import { useMe } from '@/hooks/useMe';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function DashboardPage() {
  const { data: me } = useMe();
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>
      <Card>
        <CardHeader><CardTitle>Welcome, {me?.user.name}</CardTitle></CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Active org: {me?.memberships[0]?.orgName ?? '—'}</div>
          {(me?.memberships ?? []).length === 0 && <p>Use API or MCP to create an organization.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
