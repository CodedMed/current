import { CalendarDays, Check, CheckCheck, ListTodo, Pencil, Play, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { CopilotTodo, TodoPriority, TodoStatus, UpdateTodoInput } from '../../../shared/copilot.ts';
import { Field, inputClass, selectClass, textareaClass } from '../components/cashflow/FormControls.tsx';
import { CopilotPageShell } from '../components/layout/CopilotPageShell.tsx';
import { Alert } from '../components/ui/Alert.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { Button, buttonClasses } from '../components/ui/Button.tsx';
import { Spinner } from '../components/ui/Spinner.tsx';
import { ApiError, api } from '../lib/api.ts';
import { cn } from '../lib/cn.ts';
import { mediumDate, titleCase } from '../lib/format.ts';

type TaskFilter = 'all' | 'proposed' | 'active' | 'completed' | 'declined';
const FILTERS: Array<{ id: TaskFilter; label: string; statuses: TodoStatus[] }> = [
  { id: 'all', label: 'All', statuses: ['PROPOSED', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'DECLINED'] },
  { id: 'proposed', label: 'Proposed', statuses: ['PROPOSED'] },
  { id: 'active', label: 'Active', statuses: ['APPROVED', 'IN_PROGRESS'] },
  { id: 'completed', label: 'Completed', statuses: ['COMPLETED'] },
  { id: 'declined', label: 'Declined', statuses: ['DECLINED'] },
];

interface TaskFields {
  title: string;
  description: string;
  priority: TodoPriority;
  dueDate: string | null;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<CopilotTodo[] | null>(null);
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formVersion, setFormVersion] = useState(0);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const next = await api.copilot.todos.list(signal);
      if (signal?.aborted) return;
      setTasks(next);
      setLoadError(null);
    } catch (error) {
      if (signal?.aborted) return;
      setLoadError(error instanceof ApiError ? error.message : 'Could not load tasks. Please try again.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const create = async (fields: TaskFields) => {
    if (busyId) return;
    setBusyId('new');
    setActionError(null);
    setNotice(null);
    try {
      const task = await api.copilot.todos.create({ ...fields, source: 'MANUAL', status: 'APPROVED' });
      setTasks((previous) => [task, ...(previous ?? [])]);
      setFormVersion((version) => version + 1);
      setFilter('active');
      setNotice('Task added to your active list.');
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : 'Could not add the task. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const update = async (task: CopilotTodo, patch: UpdateTodoInput, success: string) => {
    if (busyId) return;
    setBusyId(task.id);
    setActionError(null);
    setNotice(null);
    try {
      const next = await api.copilot.todos.update(task.id, patch);
      setTasks((previous) => previous?.map((item) => item.id === task.id ? next : item) ?? [next]);
      setEditingId(null);
      setNotice(success);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : 'Could not update the task. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (task: CopilotTodo) => {
    if (busyId) return;
    setBusyId(task.id);
    setActionError(null);
    setNotice(null);
    try {
      await api.copilot.todos.remove(task.id);
      setTasks((previous) => previous?.filter((item) => item.id !== task.id) ?? []);
      setDeleteId(null);
      setNotice('Task deleted.');
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : 'Could not delete the task. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const selectedFilter = FILTERS.find((item) => item.id === filter)!;
  const visible = (tasks ?? []).filter((task) => selectedFilter.statuses.includes(task.status));

  return (
    <CopilotPageShell title="Financial tasks" description="Keep advisor recommendations and your own notes in one place. Approve proposals, track progress, and mark work complete.">
      {actionError && <Alert tone="danger">{actionError}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="overflow-hidden rounded-2xl bg-panel shadow-card ring-1 ring-ink/5" aria-labelledby="tasks-heading">
          <div className="flex items-center justify-between gap-3 px-5 pt-5 sm:px-6">
            <h2 id="tasks-heading" className="text-base font-semibold text-ink">Your task list</h2>
            <Button size="sm" variant="secondary" onClick={() => void refresh()} loading={loading} disabled={busyId !== null} icon={<RefreshCw className="size-4" aria-hidden="true" />}>Refresh</Button>
          </div>
          <div className="mt-4 flex flex-wrap gap-1 border-b border-line px-5 pb-4 sm:px-6" role="group" aria-label="Filter tasks">{FILTERS.map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)} className={cn('rounded-lg px-3 py-2 text-sm font-medium transition-colors', filter === item.id ? 'bg-brand-50 text-brand-800 ring-1 ring-inset ring-brand-200' : 'text-ink-secondary hover:bg-surface')}>
            {item.label} <span className="ml-1 text-xs opacity-70">{(tasks ?? []).filter((task) => item.statuses.includes(task.status)).length}</span>
          </button>)}</div>
          {loadError && <Alert tone="danger" className="m-5" action={<Button size="sm" variant="secondary" onClick={() => void refresh()}>Retry loading tasks</Button>}>{loadError}</Alert>}
          {loading && !tasks ? <p role="status" className="flex items-center justify-center gap-2 p-12 text-sm text-ink-muted"><Spinner className="size-4" />Loading tasks…</p> : tasks && visible.length === 0 ? <div className="px-6 py-12 text-center"><ListTodo className="mx-auto size-9 text-ink-muted/60" aria-hidden="true" /><p className="mt-3 text-sm font-semibold text-ink">{filter === 'all' ? 'Your task list is ready.' : `No ${selectedFilter.label.toLowerCase()} tasks.`}</p><p className="mt-1 text-sm text-ink-muted">Add a manual task or save a recommendation from the advisor.</p><Link to="/advisor" className={buttonClasses('secondary', 'sm', false, 'mt-4')}>Ask the advisor</Link></div> : tasks && <ul className="divide-y divide-line">{visible.map((task) => {
            const terminal = task.status === 'COMPLETED' || task.status === 'DECLINED';
            return <li key={task.id} id={`task-${task.id}`} className="p-5 sm:p-6">
              {editingId === task.id ? <TaskForm initial={task} submitLabel="Save changes" busy={busyId === task.id} disabled={busyId !== null || loading} onSubmit={(fields) => void update(task, fields, 'Task updated.')} onCancel={() => setEditingId(null)} /> : <>
                <div className="flex items-start gap-3"><span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg', task.status === 'COMPLETED' ? 'bg-positive-50 text-positive-700' : task.status === 'DECLINED' ? 'bg-surface text-ink-muted' : 'bg-brand-50 text-brand-700')}>{task.status === 'COMPLETED' ? <CheckCheck className="size-4" aria-hidden="true" /> : <ListTodo className="size-4" aria-hidden="true" />}</span><div className="min-w-0 flex-1"><h3 className={cn('break-words text-sm font-semibold', terminal ? 'text-ink-secondary' : 'text-ink')}>{task.title}</h3>{task.description && <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-secondary">{task.description}</p>}</div></div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><Badge tone={task.status === 'COMPLETED' ? 'success' : task.status === 'PROPOSED' ? 'warning' : 'neutral'}>{titleCase(task.status)}</Badge><Badge tone={task.priority === 'HIGH' ? 'danger' : task.priority === 'MEDIUM' ? 'warning' : 'neutral'}>{titleCase(task.priority)} priority</Badge><span className="text-ink-muted">{task.source === 'MANUAL' ? 'Manual task' : `From ${titleCase(task.source)}`}</span>{task.dueDate && <span className="inline-flex items-center gap-1 text-ink-secondary"><CalendarDays className="size-3.5" aria-hidden="true" />Due {mediumDate(task.dueDate)}</span>}</div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {task.status === 'PROPOSED' && <Button size="sm" disabled={busyId !== null || loading} onClick={() => void update(task, { status: 'APPROVED' }, 'Proposal approved. Find it in Active tasks.')} icon={<Check className="size-4" aria-hidden="true" />}>Approve</Button>}
                  {task.status === 'APPROVED' && <Button size="sm" variant="secondary" disabled={busyId !== null || loading} onClick={() => void update(task, { status: 'IN_PROGRESS' }, 'Task marked in progress.')} icon={<Play className="size-4" aria-hidden="true" />}>Start task</Button>}
                  {(task.status === 'APPROVED' || task.status === 'IN_PROGRESS') && <Button size="sm" disabled={busyId !== null || loading} onClick={() => void update(task, { status: 'COMPLETED' }, 'Task completed. Find it in Completed tasks.')} icon={<Check className="size-4" aria-hidden="true" />}>Complete</Button>}
                  {!terminal && <Button size="sm" variant="ghost" disabled={busyId !== null || loading} onClick={() => void update(task, { status: 'DECLINED' }, 'Task declined. Find it in Declined tasks.')} icon={<X className="size-4" aria-hidden="true" />}>Decline</Button>}
                  <Button size="sm" variant="ghost" disabled={busyId !== null || loading} onClick={() => { setEditingId(task.id); setDeleteId(null); }} icon={<Pencil className="size-3.5" aria-hidden="true" />} aria-label={`Edit ${task.title}`}>Edit</Button>
                  <Button size="sm" variant="ghost" disabled={busyId !== null || loading} onClick={() => setDeleteId(task.id)} icon={<Trash2 className="size-3.5" aria-hidden="true" />} aria-label={`Delete ${task.title}`}>Delete</Button>
                  {busyId === task.id && <Spinner className="size-4 text-brand-600" />}
                </div>
                {deleteId === task.id && <div className="mt-3 rounded-xl bg-surface p-3 text-sm"><p className="text-ink-secondary">Permanently delete this task?</p><div className="mt-2 flex gap-2"><Button size="sm" variant="danger" loading={busyId === task.id} onClick={() => void remove(task)}>Delete task</Button><Button size="sm" variant="secondary" disabled={busyId !== null} onClick={() => setDeleteId(null)}>Cancel</Button></div></div>}
              </>}
            </li>;
          })}</ul>}
        </section>
        <aside className="rounded-2xl bg-panel p-5 shadow-card ring-1 ring-ink/5 sm:p-6">
          <h2 className="text-base font-semibold text-ink">Add a task or note</h2>
          <p className="mt-1 mb-4 text-sm leading-relaxed text-ink-secondary">Manual tasks start in your active list.</p>
          <TaskForm key={formVersion} submitLabel="Add task" busy={busyId === 'new'} disabled={busyId !== null || loading} onSubmit={(fields) => void create(fields)} />
          <p className="mt-4 text-xs leading-relaxed text-ink-muted">Completing a task records your progress. It does not send messages or move money.</p>
        </aside>
      </div>
    </CopilotPageShell>
  );
}

function TaskForm({ initial, submitLabel, busy, disabled, onSubmit, onCancel }: { initial?: CopilotTodo; submitLabel: string; busy: boolean; disabled: boolean; onSubmit: (fields: TaskFields) => void; onCancel?: () => void }) {
  const id = useId();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [priority, setPriority] = useState<TodoPriority>(initial?.priority ?? 'MEDIUM');
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || disabled) return;
    onSubmit({ title: title.trim(), description: description.trim(), priority, dueDate: dueDate || null });
  };
  return <form onSubmit={submit}>
    <fieldset className="space-y-4" disabled={disabled}>
      <Field label="Title" htmlFor={`${id}-title`}><input id={`${id}-title`} className={inputClass} required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Follow up on an overdue invoice" /></Field>
      <Field label="Details (optional)" htmlFor={`${id}-description`}><textarea id={`${id}-description`} className={textareaClass} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Add a note or next step…" /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Priority" htmlFor={`${id}-priority`}><select id={`${id}-priority`} className={selectClass} value={priority} onChange={(event) => setPriority(event.target.value as TodoPriority)}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></select></Field><Field label="Due date" htmlFor={`${id}-due`}><input id={`${id}-due`} className={inputClass} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></Field></div>
      <div className="flex flex-wrap gap-2"><Button type="submit" loading={busy} disabled={!title.trim()} icon={initial ? <Check className="size-4" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}>{submitLabel}</Button>{onCancel && <Button variant="secondary" onClick={onCancel}>Cancel</Button>}</div>
    </fieldset>
  </form>;
}
