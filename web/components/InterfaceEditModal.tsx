'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { api, compareNames } from '@/lib/api';
import type { ConfigApplied, Interface, InterfaceConfig, InterfaceConfigChange, InterfaceKind } from '@/lib/types';
import {
  diffForm,
  initialForm,
  keyOf,
  renderCommands,
  schemaFor,
  validateForm,
  type Changes,
  type Field,
  type FormState,
  type Section,
} from '@/lib/interface-schema';
import { Modal } from '@/components/ds/Modal';
import { Tabs } from '@/components/ds/Tabs';
import { Button } from '@/components/ds/Button';
import { Checkbox, FormField, Input, Select } from '@/components/ds/forms';
import { Alert, Badge } from '@/components/ds/misc';
import { KindLabel } from '@/components/status';

/** Edit an existing interface, or create a VLAN on a parent. */
export type EditTarget = { name: string } | { create: 'vlan' };

export interface InterfaceEditModalProps {
  /** What to open; null keeps the modal closed. */
  target: EditTarget | null;
  /** Every interface, for VLAN parents and duplicate checks. */
  interfaces: Interface[];
  onClose: () => void;
  /** Called after a successful commit with what VyOS printed. */
  onSaved: (name: string, output: string) => void;
}

/** Kinds a `vif` can hang off, and their config-tree type word. */
const VLAN_PARENTS: Partial<Record<InterfaceKind, string>> = {
  ethernet: 'ethernet',
  bonding: 'bonding',
  bridge: 'bridge',
};

/** One list-valued leaf (addresses, prefixes): rows plus an add box. */
function MultiInput({
  field,
  values,
  onChange,
}: {
  field: Field;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    const e = field.validate ? field.validate(v) : null;
    if (e) {
      setDraftError(e);
      return;
    }
    if (!values.includes(v)) onChange([...values, v]);
    setDraft('');
    setDraftError(null);
  };
  return (
    <div className="cfg-multi">
      {values.map((v) => (
        <div key={v} className="cfg-multi-row">
          <span>{v}</span>
          <Button sm variant="link-neutral" icon="times" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} />
        </div>
      ))}
      <div className="cfg-multi-add">
        <Input
          value={draft}
          placeholder={field.placeholder}
          className={field.mono ? 'mono' : ''}
          aria-label={`Add ${field.label}`}
          onChange={(e) => {
            setDraft(e.target.value);
            setDraftError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button sm icon="plus" onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
      {draftError && <span className="clr-subtext" style={{ color: 'var(--cds-alias-status-danger)' }}>{draftError}</span>}
    </div>
  );
}

function SectionFields({
  section,
  form,
  errors,
  onChange,
  before,
}: {
  section: Section;
  form: FormState;
  errors: Record<string, string>;
  onChange: (key: string, value: FormState[string]) => void;
  /** Extra controls at the top of the grid (the VLAN parent and ID). */
  before?: React.ReactNode;
}) {
  const inputs = section.fields.filter((f) => f.type !== 'flag');
  const flags = section.fields.filter((f) => f.type === 'flag');
  return (
    <>
      {(inputs.length > 0 || before) && (
        <div className="cfg-grid">
          {before}
          {inputs.map((f) => {
            const k = keyOf(f.path);
            const id = 'cfg-' + k.replace(/\W+/g, '-');
            const error = errors[k];
            const cls = f.full ? 'cfg-full' : '';
            if (f.type === 'multi') {
              return (
                <FormField key={k} label={f.label} helper={f.help} error={error} className={cls}>
                  <MultiInput field={f} values={form[k] as string[]} onChange={(v) => onChange(k, v)} />
                </FormField>
              );
            }
            if (f.type === 'select') {
              return (
                <FormField key={k} label={f.label} htmlFor={id} helper={f.help} error={error} className={cls}>
                  <Select id={id} value={form[k] as string} options={f.options} onChange={(e) => onChange(k, e.target.value)} />
                </FormField>
              );
            }
            return (
              <FormField key={k} label={f.label} htmlFor={id} helper={f.help} error={error} className={cls}>
                <Input
                  id={id}
                  value={form[k] as string}
                  placeholder={f.placeholder}
                  inputMode={f.type === 'number' ? 'numeric' : undefined}
                  className={f.mono ? 'mono' : ''}
                  onChange={(e) => onChange(k, e.target.value)}
                />
              </FormField>
            );
          })}
        </div>
      )}
      {flags.length > 0 && (
        <div className="cfg-flags">
          {flags.map((f) => {
            const k = keyOf(f.path);
            return (
              <Checkbox
                key={k}
                checked={!!form[k]}
                onChange={(e) => onChange(k, e.target.checked)}
                label={
                  <>
                    {f.label}
                    {f.help && <span className="cfg-flag-help">{f.help}</span>}
                  </>
                }
              />
            );
          })}
        </div>
      )}
    </>
  );
}

export function InterfaceEditModal({ target, interfaces, onClose, onSaved }: InterfaceEditModalProps) {
  const creating = target != null && 'create' in target;
  const [config, setConfig] = useState<InterfaceConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({});
  const [tab, setTab] = useState('general');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Create mode: which parent and which tag.
  const [parent, setParent] = useState('');
  const [vlanId, setVlanId] = useState('');

  const parents = useMemo(
    () => interfaces.filter((i) => VLAN_PARENTS[i.kind]).sort((a, b) => compareNames(a.name, b.name)),
    [interfaces],
  );

  useEffect(() => {
    setConfig(null);
    setLoadError(null);
    setSaveError(null);
    setTab('general');
    if (!target) return;
    if ('create' in target) {
      const sections = schemaFor('vlan') || [];
      setForm(initialForm(sections, {}));
      setParent(parents[0]?.name ?? '');
      setVlanId('');
      setConfig({ name: '', kind: 'vlan', path: [], config: {} });
      return;
    }
    let cancelled = false;
    api<InterfaceConfig>(`/api/config/interfaces/${encodeURIComponent(target.name)}`)
      .then((c) => {
        if (cancelled) return;
        const sections = schemaFor(c.kind);
        if (!sections) {
          setLoadError(`${c.name}: no editor for ${c.kind} interfaces yet.`);
          return;
        }
        setForm(initialForm(sections, c.config));
        setConfig(c);
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
    // `parents` only matters for the initial pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // In create mode the interface name and config path follow the form.
  const parentRow = parents.find((p) => p.name === parent);
  const newName = creating ? (parent && vlanId ? `${parent}.${vlanId}` : '') : config?.name ?? '';
  const path = useMemo(() => {
    if (!creating) return config?.path ?? [];
    if (!parentRow || !vlanId) return [];
    return ['interfaces', VLAN_PARENTS[parentRow.kind] ?? parentRow.kind, parentRow.name, 'vif', vlanId];
  }, [creating, config, parentRow, vlanId]);

  const createError = useMemo(() => {
    if (!creating) return null;
    if (!parent) return 'No ethernet, bond or bridge interface to attach a VLAN to.';
    if (!/^\d+$/.test(vlanId) || Number(vlanId) < 1 || Number(vlanId) > 4094 || String(Number(vlanId)) !== vlanId)
      return 'VLAN ID must be 1–4094.';
    if (interfaces.some((i) => i.name === newName)) return `${newName} already exists; edit it instead.`;
    return null;
  }, [creating, parent, vlanId, newName, interfaces]);

  const sections = useMemo(() => (config ? schemaFor(config.kind) || [] : []), [config]);
  const errors = useMemo(() => validateForm(sections, form), [sections, form]);
  const changes = useMemo<Changes>(() => {
    if (!config) return { set: [], delete: [] };
    const d = diffForm(sections, config.config, form);
    // Creating: the bare node first, so an all-defaults VLAN still exists.
    return creating ? { set: [[], ...d.set], delete: d.delete } : d;
  }, [sections, config, form, creating]);
  const nChanges = changes.set.length + changes.delete.length;
  const hasErrors = Object.keys(errors).length > 0 || createError != null;

  const errorsIn = (s: Section) => s.fields.filter((f) => errors[keyOf(f.path)]).length + (s.id === 'general' && createError ? 1 : 0);

  const save = async () => {
    if (!config || nChanges === 0 || hasErrors) return;
    setSaving(true);
    setSaveError(null);
    try {
      const body: InterfaceConfigChange = { interface: newName, set: changes.set, delete: changes.delete };
      const applied = await api<ConfigApplied>('/api/config/interfaces', { method: 'POST', body: JSON.stringify(body) });
      onSaved(newName, applied.output);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const createFields = creating ? (
    <>
      <FormField label="Parent interface" htmlFor="cfg-parent" required helper="Ethernet, bond or bridge carrying the tagged frames.">
        <Select id="cfg-parent" value={parent} onChange={(e) => setParent(e.target.value)}>
          {parents.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
              {p.description ? ` — ${p.description}` : ''}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="VLAN ID" htmlFor="cfg-vlan-id" required error={vlanId && createError ? createError : undefined} helper="802.1Q tag, 1–4094.">
        <Input id="cfg-vlan-id" className="mono" inputMode="numeric" placeholder="100" value={vlanId} onChange={(e) => setVlanId(e.target.value.trim())} autoFocus />
      </FormField>
    </>
  ) : undefined;

  return (
    <Modal
      open={target != null}
      size="lg"
      onClose={saving ? undefined : onClose}
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          {creating ? 'New VLAN' : 'Edit'}
          {newName && <span className="cfg-title-name">{newName}</span>}
          {config && !creating && <KindLabel kind={config.kind} />}
        </span>
      }
      footer={
        <>
          <span className="dim" style={{ marginRight: 'auto', fontSize: 12, alignSelf: 'center' }}>
            {config && (nChanges === 0 ? 'No changes' : `${nChanges} change${nChanges === 1 ? '' : 's'} · commit and save`)}
          </span>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!config || saving || nChanges === 0 || hasErrors}>
            {creating ? 'Create' : 'Save'}
          </Button>
        </>
      }
    >
      {loadError && <Alert status="danger">{loadError}</Alert>}
      {!config && !loadError && (
        <div className="page-loading" style={{ padding: 32 }}>
          <span className="spinner spinner-md"></span>Loading configuration…
        </div>
      )}
      {config && (
        <>
          {saveError && (
            <Alert status="danger">
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{saveError}</pre>
            </Alert>
          )}
          <Tabs
            tabs={sections.map((s) => ({
              id: s.id,
              label: s.label,
              badge: errorsIn(s) > 0 ? <Badge status="danger">{errorsIn(s)}</Badge> : undefined,
            }))}
            active={tab}
            onChange={setTab}
          />
          <div className="clr-tab-content">
            {sections
              .filter((s) => s.id === tab)
              .map((s) => (
                <SectionFields
                  key={s.id}
                  section={s}
                  form={form}
                  errors={errors}
                  before={s.id === 'general' ? createFields : undefined}
                  onChange={(k, v) => setForm((f) => ({ ...f, [k]: v }))}
                />
              ))}
          </div>
          {nChanges > 0 && path.length > 0 && (
            <details className="cfg-commands">
              <summary>Show the {nChanges === 1 ? 'command' : 'commands'} this will run</summary>
              <pre className="mono">{renderCommands(path, changes)}</pre>
            </details>
          )}
        </>
      )}
    </Modal>
  );
}

export interface DeleteInterfacesModalProps {
  /** Names to remove; empty keeps the modal closed. */
  names: string[];
  onClose: () => void;
  onDeleted: (names: string[], failed: string | null) => void;
}

/** Confirm and remove VLANs, one commit each. */
export function DeleteInterfacesModal({ names, onClose, onDeleted }: DeleteInterfacesModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [names]);
  const run = async () => {
    setBusy(true);
    setError(null);
    const done: string[] = [];
    try {
      for (const name of names) {
        await api<ConfigApplied>('/api/config/interfaces', {
          method: 'POST',
          body: JSON.stringify({ interface: name, set: [], delete: [[]] } satisfies InterfaceConfigChange),
        });
        done.push(name);
      }
      onDeleted(done, null);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      if (done.length) onDeleted(done, message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={names.length > 0}
      title={`Delete ${names.length === 1 ? names[0] : `${names.length} VLANs`}`}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={run} loading={busy} disabled={busy}>
            Delete
          </Button>
        </>
      }
    >
      {error && (
        <Alert status="danger">
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{error}</pre>
        </Alert>
      )}
      <p style={{ margin: '0 0 8px' }}>
        This removes the interface and everything configured under it, then commits and saves. Anything referring to it (firewall, DHCP
        server, routes) will fail to commit.
      </p>
      <ul className="mono" style={{ margin: 0, paddingLeft: 20 }}>
        {names.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </Modal>
  );
}
