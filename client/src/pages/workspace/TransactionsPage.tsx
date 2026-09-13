import { ReviewPanel } from '../../components/cashflow/ReviewPanel.tsx';
import { TransactionsPanel } from '../../components/cashflow/TransactionsPanel.tsx';
import { PageHeading } from './PageHeading.tsx';
import { useWorkspace } from './WorkspaceLayout.tsx';

/** Everything that moved, and the bills that want a decision before they count as normal. */
export default function TransactionsPage() {
  const { data, companyId, accountIds, version, openTransaction, decide } = useWorkspace();

  return (
    <>
      <PageHeading title="Transactions">
        Every movement in and out, with the bills flagged for review listed first. Search, filter, and open a row to edit
        its category or note.
      </PageHeading>

      {data.reviews.items.length > 0 && (
        <div className="mb-5">
          <ReviewPanel queue={data.reviews} onDecide={decide} onOpen={openTransaction} />
        </div>
      )}

      <TransactionsPanel
        companyId={companyId}
        accountIds={accountIds}
        recent={data.recentTransactions}
        accounts={data.accounts}
        categories={data.categories}
        version={version}
        onOpen={openTransaction}
      />
    </>
  );
}
