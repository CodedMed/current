import { AccountsPanel } from '../../components/cashflow/AccountsPanel.tsx';
import { PageHeading } from './PageHeading.tsx';
import { useWorkspace } from './WorkspaceLayout.tsx';

/** The accounts behind every figure on the other pages, and which of them are in view. */
export default function AccountsPage() {
  const { data, accountIds, setAccountIds } = useWorkspace();
  const shown = accountIds?.length ?? data.accounts.length;

  return (
    <>
      <PageHeading title="Accounts">
        {shown === data.accounts.length
          ? `All ${data.accounts.length} accounts are included in the figures on every page.`
          : `${shown} of ${data.accounts.length} accounts are included in the figures on every page.`}{' '}
        Choose which ones count here.
      </PageHeading>

      <AccountsPanel accounts={data.accounts} selectedIds={accountIds} onSelect={setAccountIds} />
    </>
  );
}
