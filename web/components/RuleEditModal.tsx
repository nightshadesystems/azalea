'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { ConfigApplied, ScopeConfigChange } from '@/lib/types';
import { diffTree, humanize, isTree, placeholderFor, validateTree, validateValue, type CfgTree, type Changes, type SchemaNode } from '@/lib/vyos-schema';
import { useDetail } from '@/lib/detail';
import { basicSchema, countLeaves } from '@/lib/basic-options';
import { nounOf, type RuleTab } from '@/lib/config-tables';
import { Modal } from '@/components/ds/Modal';
import { Button } from '@/components/ds/Button';
import { FormField, Input } from '@/components/ds/forms';
import { Alert } from '@/components/ds/misc';
import { SchemaEditor } from '@/components/SchemaEditor';
import type { EditorContext } from '@/components/ConfigTreeEditor';

/** Edit an existing entry of the tab's tag node, or create one. */
export type RuleTarget = { key: string } | { create: true };

export interface RuleEditModalProps {
  target: RuleTarget | null;
  /** Where changes go (`/api/config/nat`, `/api/config/routing`) and the scope that endpoint takes. */
  endpoint: string;
  scope: string;
  /** Full config path of the scope node (from the API), for the command preview. */
  scopePath: string[];
  tab: RuleTab;
  /** The tag node's schema. */
  schema: SchemaNode;
  /** Every entry under the tag node, for the initial tree and duplicate checks. */
  entries: CfgTree;
  ctx: EditorContext;
  onClose: () => void;
  onSaved: (key: string, output: string) => void;
}

export function RuleEditModal({ target, endpoint, scope, scopePath, tab, schema, entries, ctx, onClose, onSaved }: RuleEditModalProps) {
  const creating = target != null && 'create' in target;
  const existingKey = target && 'key' in target ? target.key : null;
  const [tree, setTree] = useState<CfgTree>({});
  const [original, setOriginal] = useState<CfgTree>({});
  const [newKey, setNewKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const detail = useDetail();

  useEffect(() => {
    setSaveError(null);
    setNewKey('');
    const initial = existingKey && isTree(entries[existingKey]) ? (entries[existingKey] as CfgTree) : {};
    setTree(initial);
    setOriginal(initial);
    // Only re-seed when a different target opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const key = creating ? newKey.trim() : existingKey ?? '';
  const trimmed = useMemo(() => (detail === 'basic' ? basicSchema(schema, tab.basic) : schema), [schema, tab.basic, detail]);
  const hidden = countLeaves(schema) - countLeaves(trimmed);
  const complaints = useMemo(() => validateTree(trimmed, tree), [trimmed, tree]);
  const keyError = useMemo(() => {
    if (!creating) return null;
    if (!key) return `Enter a ${nounOf(tab.keyLabel)} ${placeholderFor(schema) ? `(${placeholderFor(schema)})` : ''}`.trim() + '.';
    const m = validateValue(schema, key);
    if (m) return m;
    if (entries[key] !== undefined) return `${tab.keyLabel} ${key} already exists; edit it instead.`;
    return null;
  }, [creating, key, schema, entries, tab.keyLabel]);
  const changes = useMemo<Changes>(() => {
    const d = diffTree(trimmed, original, tree);
    return creating ? { set: [[], ...d.set], delete: d.delete } : d;
  }, [trimmed, original, tree, creating]);
  const nChanges = changes.set.length + changes.delete.length;
  const hasErrors = complaints.length > 0 || keyError != null;
  const entryPath = key ? [...tab.path, key] : [];

  const save = async () => {
    if (nChanges === 0 || hasErrors || !key) return;
    setSaving(true);
    setSaveError(null);
    try {
      const body: ScopeConfigChange = {
        scope,
        set: changes.set.map((p) => [...entryPath, ...p]),
        delete: changes.delete.map((p) => [...entryPath, ...p]),
      };
      const applied = await api<ConfigApplied>(endpoint, { method: 'POST', body: JSON.stringify(body) });
      onSaved(key, applied.output);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const before = creating ? (
    <div className="cfg-grid">
      <FormField label={tab.keyLabel} htmlFor="cfg-rule-key" required error={newKey && keyError ? keyError : undefined} helper={schema.help}>
        <Input id="cfg-rule-key" className="mono" inputMode={tab.numeric ? 'numeric' : undefined} placeholder={placeholderFor(schema)} value={newKey} onChange={(e) => setNewKey(e.target.value)} autoFocus />
      </FormField>
    </div>
  ) : undefined;

  return (
    <Modal
      open={target != null}
      size="xl"
      onClose={saving ? undefined : onClose}
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          {creating ? `New ${nounOf(tab.keyLabel)}` : `Edit ${nounOf(tab.keyLabel)}`}
          {key && <span className="cfg-title-name">{key}</span>}
          <span className="dim" style={{ fontSize: 13, fontWeight: 400 }}>
            {humanize(tab.path[0] ?? '')} {tab.path.length > 1 ? humanize(tab.path[1] ?? '') : ''}
          </span>
        </span>
      }
      footer={
        <>
          <span className="dim" style={{ marginRight: 'auto', fontSize: 12, alignSelf: 'center' }}>
            {nChanges === 0 ? 'No changes' : `${nChanges} change${nChanges === 1 ? '' : 's'} · commit and save`}
            {complaints.length > 0 && <span className="cfg-error"> · {complaints.length} to fix</span>}
          </span>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={saving || nChanges === 0 || hasErrors}>
            {creating ? 'Create' : 'Save'}
          </Button>
        </>
      }
    >
      {saveError && (
        <Alert status="danger">
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{saveError}</pre>
        </Alert>
      )}
      <SchemaEditor
        schema={trimmed}
        hidden={hidden}
        tree={tree}
        onChange={setTree}
        path={key ? [...scopePath, ...entryPath] : []}
        changes={changes}
        complaints={complaints}
        ctx={ctx}
        before={before}
        generalError={keyError != null}
      />
    </Modal>
  );
}

export interface DeleteRulesModalProps {
  endpoint: string;
  scope: string;
  tab: RuleTab;
  /** Keys to remove; empty keeps the modal closed. */
  keys: string[];
  onClose: () => void;
  onDeleted: (keys: string[], output: string) => void;
}

/** Confirm and remove entries, in one commit. */
export function DeleteRulesModal({ endpoint, scope, tab, keys, onClose, onDeleted }: DeleteRulesModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [keys]);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: ScopeConfigChange = { scope, set: [], delete: keys.map((k) => [...tab.path, k]) };
      const applied = await api<ConfigApplied>(endpoint, { method: 'POST', body: JSON.stringify(body) });
      onDeleted(keys, applied.output);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const noun = nounOf(tab.keyLabel);
  return (
    <Modal
      open={keys.length > 0}
      title={`Delete ${keys.length === 1 ? `${noun} ${keys[0]}` : `${keys.length} ${noun}s`}`}
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
      <p style={{ margin: '0 0 8px' }}>This removes the following and everything configured under them, then commits and saves.</p>
      <ul className="mono" style={{ margin: 0, paddingLeft: 20 }}>
        {keys.map((k) => (
          <li key={k}>
            {humanize(tab.path.join(' '))} {k}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
