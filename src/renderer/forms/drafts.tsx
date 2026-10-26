import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { secretKeys } from '../../shared/secrets';

type Values = Record<string, unknown>;
interface DraftEntry { values: Values; baseline: Values; }
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function mergeDraft(baseline: Values, values: Values, incoming: Values): Values {
  return Object.fromEntries(Object.keys(incoming).map(key => [key, equal(values[key], baseline[key]) ? incoming[key] : values[key]]));
}
export function sanitizeDraft(values: Values): Values {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, secretKeys.includes(key as typeof secretKeys[number]) ? (value ? '***' : '') : value]));
}

export class DraftStore {
  readonly entries = new Map<string, DraftEntry>();
  readonly resets = new Map<string, () => void>();
  readonly updates = new Map<string, (values: Values, baseline: Values) => void>();
  readonly pendingSaves = new Set<object>();
  hasDirtyDrafts = () => [...this.entries.values()].some(entry => !equal(entry.values, entry.baseline));
  hasPendingSaves = () => this.pendingSaves.size > 0;
  discardAllDrafts = () => { this.entries.clear(); for (const reset of this.resets.values()) reset(); };
}
const DraftContext = createContext<DraftStore | null>(null);
export function DraftProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new DraftStore());
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (store.hasDirtyDrafts()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [store]);
  return <DraftContext.Provider value={store}>{children}</DraftContext.Provider>;
}
export function useDrafts() {
  const store = useContext(DraftContext);
  return { hasDirtyDrafts: store?.hasDirtyDrafts ?? (() => false), hasPendingSaves: store?.hasPendingSaves ?? (() => false), discardAllDrafts: store?.discardAllDrafts ?? (() => {}) };
}
export interface FormDraft<T extends FieldValues> {
  dirty: boolean;
  discard: () => void;
  commit: (values?: T) => void;
  submit: (save: (values: T) => Promise<void>) => (values: T) => Promise<void>;
}

/** RAM-only drafts survive page unmounts. Server updates replace only untouched fields. */
export function useFormDraft<T extends FieldValues>(section: string, form: UseFormReturn<T>, initial: T): FormDraft<T> {
  const context = useContext(DraftContext);
  const local = useRef(new DraftStore());
  const store = context ?? local.current;
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const [dirty, setDirty] = useState(false);
  const signature = JSON.stringify(initial);
  const resetting = useRef(false);
  const reset = (values: T, baseline: T = values) => {
    resetting.current = true;
    form.reset(baseline);
    // Resetting the baseline first retains react-hook-form's own dirty field semantics.
    for (const [key, value] of Object.entries(values)) {
      if (!equal(value, baseline[key])) form.setValue(key as never, value as never, { shouldDirty: true });
    }
    store.entries.set(section, { values: { ...values }, baseline: { ...baseline } });
    setDirty(!equal(values, baseline));
    resetting.current = false;
  };
  useLayoutEffect(() => {
    const incoming = initialRef.current;
    const prior = store.entries.get(section);
    reset((prior ? mergeDraft(prior.baseline, prior.values, incoming) : incoming) as T, incoming);
    store.resets.set(section, () => reset(initialRef.current));
    const update = (values: Values, baseline: Values) => reset(values as T, baseline as T);
    store.updates.set(section, update);
    return () => { store.resets.delete(section); if (store.updates.get(section) === update) store.updates.delete(section); };
  }, [section, signature, store]);
  useEffect(() => {
    const subscription = form.watch(values => {
      if (resetting.current) return;
      const baseline = store.entries.get(section)?.baseline ?? initialRef.current;
      store.entries.set(section, { values: { ...values }, baseline });
      setDirty(!equal(values, baseline));
    });
    return () => subscription.unsubscribe();
  }, [section, form, store]);
  const commit = (values: T = form.getValues()) => reset(sanitizeDraft(values) as T);
  return { dirty, discard: () => reset(initialRef.current), commit, submit: save => async values => {
    const submitted = { ...form.getValues() };
    const pending = {};
    store.pendingSaves.add(pending);
    try {
      await save(values);
      const baseline = sanitizeDraft(values);
      const current = store.entries.get(section)?.values ?? submitted;
      // A form may have unmounted/re-mounted while saving. Preserve newer edits and
      // update the currently mounted instance rather than the old submit closure.
      const next = mergeDraft(submitted, current, baseline);
      store.entries.set(section, { values: next, baseline });
      store.updates.get(section)?.(next, baseline);
    } finally { store.pendingSaves.delete(pending); }
  } };
}
