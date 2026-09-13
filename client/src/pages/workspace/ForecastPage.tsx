import { CashPositionChart } from '../../components/cashflow/CashPositionChart.tsx';
import { OutlookPanel } from '../../components/cashflow/OutlookPanel.tsx';
import { UpcomingPanel } from '../../components/cashflow/UpcomingPanel.tsx';
import { PageHeading } from './PageHeading.tsx';
import { useWorkspace } from './WorkspaceLayout.tsx';

/** Where the balance goes from here, under the scenario and horizon you choose. */
export default function ForecastPage() {
  const { data, accountIds, showForecast, setShowForecast, setHorizon, setScenario } = useWorkspace();

  return (
    <>
      <PageHeading title="Forecast">
        Projected balance day by day, built from scheduled payments and recurring patterns already in your ledger — not
        a trend line drawn through the past.
      </PageHeading>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="grid min-w-0 xl:col-span-2">
          <CashPositionChart
            position={data.cashPosition}
            showForecast={showForecast}
            onShowForecast={setShowForecast}
            onHorizon={setHorizon}
            onScenario={setScenario}
            animationKey={`${data.company.id}:${accountIds?.join(',') ?? 'all'}`}
          />
        </div>
        <div className="grid min-w-0">
          <OutlookPanel runway={data.kpis.runway} cashPosition={data.cashPosition} today={data.today} />
        </div>
      </div>

      <div className="mt-5">
        <UpcomingPanel upcoming={data.upcoming} />
      </div>
    </>
  );
}
