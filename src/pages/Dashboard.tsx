import { useMe } from '@/hooks/useMe';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function DashboardPage() {
  const { data: me } = useMe();
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Přehled</h1>
      <Card>
        <CardHeader><CardTitle>Vítej, {me?.user.name}</CardTitle></CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Aktivní organizace: {me?.memberships[0]?.orgName ?? '—'}</div>
          {(me?.memberships ?? []).length === 0 && <p>Použij API nebo MCP pro vytvoření organizace.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
