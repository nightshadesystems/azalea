'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { ConfigApplied, InterfaceConfig, InterfaceConfigChange } from '@/lib/types';
import {
  diffForm,
  initialForm,
  keyOf,
  renderCommands,
  schemaFor,
  validateForm,
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

export interface InterfaceEditModalProps {
  /** Interface to edit; null keeps the modal closed. */
  name: string | null;
  onClose: () => void;
  /** Called after a successful commit with what VyOS printed. */
  onSaved: (name: string, output: string) => void;
}

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
}: {
  section: Section;
  form: FormState;
  errors: Record<string, string>;
  onChange: (key: string, value: FormState[string]) => void;
}) {
  const inputs = section.fields.filter((f) => f.type !== 'flag');
  const flags = section.fields.filter((f) => f.type === 'flag');
  return (
    <>
      {inputs.length > 0 && (
        <div className="cfg-grid">
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

export function InterfaceEditModal({ name, onClose, onSaved }: InterfaceEditModalProps) {
  const [config, setConfig] = useState<InterfaceConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({});
  const [tab, setTab] = useState('general');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setConfig(null);
    setLoadError(null);
    setSaveError(null);
    setTab('general');
    if (!name) return;
    let cancelled = false;
    api<InterfaceConfig>(`/api/config/interfaces/${encodeURIComponent(name)}`)
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
  }, [name]);

  const sections = useMemo(() => (config ? schemaFor(config.kind) || [] : []), [config]);
  const errors = useMemo(() => validateForm(sections, form), [sections, form]);
  const changes = useMemo(() => (config ? diffForm(sections, config.config, form) : { set: [], delete: [] }), [sections, config, form]);
  const nChanges = changes.set.length + changes.delete.length;

  const errorsIn = (s: Section) => s.fields.filter((f) => errors[keyOf(f.path)]).length;

  const save = async () => {
    if (!config || nChanges === 0 || Object.keys(errors).length > 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const body: InterfaceConfigChange = { interface: config.name, set: changes.set, delete: changes.delete };
      const applied = await api<ConfigApplied>('/api/config/interfaces', { method: 'POST', body: JSON.stringify(body) });
      onSaved(config.name, applied.output);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <Modal
      open={name != null}
      size="lg"
      onClose={saving ? undefined : onClose}
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          Edit <span className="cfg-title-name">{name}</span>
          {config && <KindLabel kind={config.kind} />}
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
            Save
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
                <SectionFields key={s.id} section={s} form={form} errors={errors} onChange={(k, v) => setForm((f) => ({ ...f, [k]: v }))} />
              ))}
          </div>
          {nChanges > 0 && (
            <details className="cfg-commands">
              <summary>Show the {nChanges === 1 ? 'command' : 'commands'} this will run</summary>
              <pre className="mono">{renderCommands(config.path, changes)}</pre>
            </details>
          )}
        </>
      )}
    </Modal>
  );
}
