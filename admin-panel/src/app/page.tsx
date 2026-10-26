import { DashboardShell } from '@/components/layout/DashboardShell';
import MasterDashboardPage from './(dashboard)/page';

export default function RootPage() {
  return (
    <DashboardShell>
      <MasterDashboardPage />
    </DashboardShell>
  );
}