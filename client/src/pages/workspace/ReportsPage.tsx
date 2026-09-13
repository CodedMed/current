import { BreakdownPanel } from '../../components/cashflow/BreakdownPanel.tsx';
import { MonthlyFlowChart } from '../../components/cashflow/MonthlyFlowChart.tsx';
import { PageHeading } from './PageHeading.tsx';
import { useWorkspace } from './WorkspaceLayout.tsx';

/** Where the money went: month over month, and by category for the chosen period. */
export default function ReportsPage() {
  const { data } = useWorkspace();

  return (
    <>
      <PageHeading title="Reports">
        Money in against money out for each month, and what {data.period.label.toLowerCase()} was actually spent on.
      </PageHeading>

      <div className="grid gap-5 xl:grid-cols-5">
        <div className="grid min-w-0 xl:col-span-3">
          <MonthlyFlowChart months={data.monthlyFlows} period={data.period} cashIn={data.kpis.cashIn.value} cashOut={data.kpis.cashOut.value} />
        </div>
        <div className="grid min-w-0 xl:col-span-2">
          <BreakdownPanel breakdown={data.breakdown} periodLabel={data.period.label} />
        </div>
      </div>
    </>
  );
}
