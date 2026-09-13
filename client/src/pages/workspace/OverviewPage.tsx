import { CopilotOverview } from '../../components/copilot/CopilotOverview.tsx';
import { InsightsPanel } from '../../components/cashflow/InsightsPanel.tsx';
import { KpiStrip } from '../../components/cashflow/KpiStrip.tsx';
import { UpcomingPanel } from '../../components/cashflow/UpcomingPanel.tsx';
import { PageHeading } from './PageHeading.tsx';
import { useWorkspace } from './WorkspaceLayout.tsx';

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** Where you land: the position, what the copilot has found, what is coming, what to look at. */
export default function OverviewPage() {
  const { data, user, version } = useWorkspace();
  const asOf = new Date(`${data.today}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <>
      <PageHeading title={`${greeting()}, ${user?.givenName ?? 'there'}`}>
        Here is where <span className="font-semibold text-ink">{data.company.name}</span> stands on {asOf}. Figures cover{' '}
        {data.period.label.toLowerCase()} across{' '}
        {data.kpis.totalCash.accountCount === data.accounts.length
          ? 'all accounts'
          : `${data.kpis.totalCash.accountCount} of ${data.accounts.length} accounts`}
        .
      </PageHeading>

      <KpiStrip kpis={data.kpis} period={data.period} />

      <div className="mt-5">
        <CopilotOverview version={version} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-5">
        <div className="grid min-w-0 xl:col-span-3">
          <UpcomingPanel upcoming={data.upcoming} />
        </div>
        <div className="grid min-w-0 xl:col-span-2">
          <InsightsPanel insights={data.insights} />
        </div>
      </div>
    </>
  );
}
