'use client';
import React, { useState } from 'react';
import type { CfgNode } from '@/lib/types';
import {
  humanize,
  isEnum,
  isNumeric,
  isTree,
  leafValues,
  placeholderFor,
  validateValue,
  type CfgTree,
  type SchemaNode,
} from '@/lib/vyos-schema';
import { Button } from '@/components/ds/Button';
import { Checkbox, FormField, Input, Select } from '@/components/ds/forms';

/** Shared context: interface names for completion, and whether flags stay compact. */
export interface EditorContext {
  /** Names of every interface on the router, offered where VyOS completes from `interfaces …`. */
  interfaces: string[];
}

interface ValueControlProps {
  node: SchemaNode;
  id: string;
  value: string;
  onChange: (v: string) => void;
  ctx: EditorContext;
  placeholder?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
}

/** One value: a select for enumerations, otherwise an input with hints. */
function ValueControl({ node, id, value, onChange, ctx, placeholder, autoFocus, onEnter }: ValueControlProps) {
  if (isEnum(node)) {
    return (
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{node.default ? `Default (${node.default})` : 'Not set'}</option>
        {node.values!.map((o) => (
          <option key={o.value} value={o.value} title={o.help}>
            {o.value}
            {o.help ? ` — ${o.help}` : ''}
          </option>
        ))}
      </Select>
    );
  }
  const suggestions = node.completionPath?.startsWith('interfaces') ? ctx.interfaces : node.values?.map((v) => v.value) ?? [];
  const listId = suggestions.length ? id + '-list' : undefined;
  return (
    <>
      <Input
        id={id}
        list={listId}
        className="mono"
        inputMode={isNumeric(node) ? 'numeric' : undefined}
        value={value}
        placeholder={placeholder ?? (node.default ? `default ${node.default}` : placeholderFor(node))}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
      />
      {listId && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </>
  );
}

const idFor = (path: string[]) => 'cfg-' + path.join('-').replace(/[^A-Za-z0-9_-]+/g, '_');

/**
 * Help text, then one line per value format VyOS accepts. A format
 * whose description just repeats the help (`txt Description`) is noise
 * and dropped; a lone `txt` says nothing either.
 */
function helperFor(node: SchemaNode): React.ReactNode {
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  let formats = (node.formats ?? []).filter((f) => f.help && !same(f.help, node.help ?? ''));
  if (formats.length === 1 && formats[0]!.format === 'txt') formats = [];
  if (!node.help && formats.length === 0) return undefined;
  return (
    <span className="cfg-help">
      {node.help && <span>{node.help}</span>}
      {formats.map((f) => (
        <span key={f.format} className="cfg-format">
          <span className="mono">{f.format}</span> {f.help}
        </span>
      ))}
    </span>
  );
}

/** A leaf holding several values. */
function MultiLeaf({ node, path, values, onChange, ctx }: { node: SchemaNode; path: string[]; values: string[]; onChange: (v: string[]) => void; ctx: EditorContext }) {
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const id = idFor(path);
  if (isEnum(node)) {
    return (
      <div className="cfg-flags cfg-enum-multi">
        {node.values!.map((o) => (
          <Checkbox
            key={o.value}
            checked={values.includes(o.value)}
            onChange={(e) => onChange(e.target.checked ? [...values, o.value] : values.filter((v) => v !== o.value))}
            label={
              <>
                <span className="mono">{o.value}</span>
                {o.help && <span className="cfg-flag-help">{o.help}</span>}
              </>
            }
          />
        ))}
      </div>
    );
  }
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    const e = validateValue(node, v);
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
      {values.map((v) => {
        const bad = validateValue(node, v);
        return (
          <div key={v} className={'cfg-multi-row' + (bad ? ' cfg-bad' : '')} title={bad ?? undefined}>
            <span>{v}</span>
            <Button sm variant="link-neutral" icon="times" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} />
          </div>
        );
      })}
      <div className="cfg-multi-add">
        <ValueControl
          node={node}
          id={id}
          value={draft}
          ctx={ctx}
          onChange={(v) => {
            setDraft(v);
            setDraftError(null);
          }}
          onEnter={add}
        />
        <Button sm icon="plus" onClick={add} disabled={!draft.trim()} aria-label={`Add ${humanize(node.name)}`}>
          Add
        </Button>
      </div>
      {draftError && <span className="clr-subtext cfg-error">{draftError}</span>}
    </div>
  );
}

interface LeafProps {
  node: SchemaNode;
  path: string[];
  value: CfgNode | undefined;
  onChange: (v: CfgNode | undefined) => void;
  ctx: EditorContext;
}

function LeafField({ node, path, value, onChange, ctx }: LeafProps) {
  const id = idFor(path);
  const label = humanize(node.name);
  if (node.multi) {
    return (
      <FormField label={label} helper={helperFor(node)} className="cfg-full">
        <MultiLeaf node={node} path={path} values={leafValues(value)} onChange={(v) => onChange(v.length ? v : undefined)} ctx={ctx} />
      </FormField>
    );
  }
  const current = leafValues(value)[0] ?? '';
  const error = current ? validateValue(node, current) : null;
  return (
    <FormField label={label} htmlFor={id} helper={helperFor(node)} error={error ?? undefined}>
      <ValueControl node={node} id={id} value={current} ctx={ctx} onChange={(v) => onChange(v === '' ? undefined : v)} />
    </FormField>
  );
}

function FlagField({ node, value, onChange }: LeafProps) {
  return (
    <Checkbox
      checked={value !== undefined}
      onChange={(e) => onChange(e.target.checked ? {} : undefined)}
      label={
        <>
          {humanize(node.name)}
          {node.help && <span className="cfg-flag-help">{node.help}</span>}
        </>
      }
    />
  );
}

export interface ChildrenProps {
  /** The schema node whose children are rendered. */
  node: SchemaNode;
  path: string[];
  value: CfgTree | undefined;
  onChange: (v: CfgTree | undefined) => void;
  ctx: EditorContext;
  /** Render only these child kinds (the modal splits leaves from groups at the top level). */
  only?: 'leaves' | 'groups';
}

/** A node's children: value leaves in a grid, flags in a list, groups and tag lists below. */
export function ChildrenEditor({ node, path, value, onChange, ctx, only }: ChildrenProps) {
  const tree = value ?? {};
  const set = (name: string, v: CfgNode | undefined) => {
    const next = { ...tree };
    if (v === undefined) delete next[name];
    else next[name] = v;
    onChange(next);
  };
  const children = node.children ?? [];
  const leaves = children.filter((c) => c.kind === 'leaf' && !c.valueless);
  const flags = children.filter((c) => c.kind === 'leaf' && c.valueless);
  const groups = children.filter((c) => c.kind !== 'leaf');
  const showLeaves = only !== 'groups';
  const showGroups = only !== 'leaves';
  return (
    <>
      {showLeaves && leaves.length > 0 && (
        <div className="cfg-grid">
          {leaves.map((c) => (
            <LeafField key={c.name} node={c} path={[...path, c.name]} value={tree[c.name]} onChange={(v) => set(c.name, v)} ctx={ctx} />
          ))}
        </div>
      )}
      {showLeaves && flags.length > 0 && (
        <div className="cfg-flags">
          {flags.map((c) => (
            <FlagField key={c.name} node={c} path={[...path, c.name]} value={tree[c.name]} onChange={(v) => set(c.name, v)} ctx={ctx} />
          ))}
        </div>
      )}
      {showGroups &&
        groups.map((c) =>
          c.kind === 'tag' ? (
            <TagList key={c.name} node={c} path={[...path, c.name]} value={isTree(tree[c.name]) ? (tree[c.name] as CfgTree) : undefined} onChange={(v) => set(c.name, v)} ctx={ctx} />
          ) : (
            <GroupPanel key={c.name} node={c} path={[...path, c.name]} value={isTree(tree[c.name]) ? (tree[c.name] as CfgTree) : undefined} onChange={(v) => set(c.name, v)} ctx={ctx} />
          ),
        )}
    </>
  );
}

/** A group for a `node`: its fields when present in the config, otherwise just an Enable button. */
export function GroupPanel({ node, path, value, onChange, ctx, title }: ChildrenProps & { title?: React.ReactNode }) {
  const present = value !== undefined;
  const count = present ? Object.keys(value).length : 0;
  return (
    <section className={'cfg-group' + (present ? '' : ' cfg-group-off')}>
      <header className="cfg-group-head">
        <span className="cfg-group-title">
          {title ?? humanize(node.name)}
          {count > 0 && <span className="cfg-group-count">{count}</span>}
        </span>
        {node.help && <span className="cfg-group-help">{node.help}</span>}
        {present ? (
          <Button sm variant="link-neutral" icon="trash" onClick={() => onChange(undefined)} title={`Remove ${humanize(node.name)} and everything under it`}>
            Remove
          </Button>
        ) : (
          <Button sm variant="link" icon="plus" onClick={() => onChange({})}>
            Enable
          </Button>
        )}
      </header>
      {present && (
        <div className="cfg-group-body">
          <ChildrenEditor node={node} path={path} value={value} onChange={(v) => onChange(v ?? {})} ctx={ctx} />
        </div>
      )}
    </section>
  );
}

/** A `tagNode`: one panel per key, plus an add row. */
export function TagList({ node, path, value, onChange, ctx }: ChildrenProps) {
  const entries = value ?? {};
  const keys = Object.keys(entries);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const label = humanize(node.name);
  const add = () => {
    const k = draft.trim();
    if (!k) return;
    const e = validateValue(node, k);
    if (e) {
      setDraftError(e);
      return;
    }
    if (keys.includes(k)) {
      setDraftError(`${k} is already listed.`);
      return;
    }
    onChange({ ...entries, [k]: {} });
    setDraft('');
    setDraftError(null);
  };
  const remove = (k: string) => {
    const next = { ...entries };
    delete next[k];
    onChange(Object.keys(next).length ? next : undefined);
  };
  return (
    <section className="cfg-group cfg-taglist">
      <header className="cfg-group-head">
        <span className="cfg-group-title">
          {label}
          {keys.length > 0 && <span className="cfg-group-count">{keys.length}</span>}
        </span>
        {node.help && <span className="cfg-group-help">{node.help}</span>}
      </header>
      <div className="cfg-group-body">
        {keys.map((k) => (
          <GroupPanel
            key={k}
            node={node}
            path={[...path, k]}
            value={isTree(entries[k]) ? (entries[k] as CfgTree) : {}}
            onChange={(v) => (v === undefined ? remove(k) : onChange({ ...entries, [k]: v }))}
            ctx={ctx}
            title={
              <>
                {label} <span className="mono">{k}</span>
              </>
            }
          />
        ))}
        <div className="cfg-multi-add">
          <ValueControl node={node} id={idFor([...path, '+'])} value={draft} ctx={ctx} placeholder={placeholderFor(node) || 'name'} onChange={(v) => { setDraft(v); setDraftError(null); }} onEnter={add} />
          <Button sm icon="plus" onClick={add} disabled={!draft.trim()}>
            Add {label}
          </Button>
        </div>
        {draftError && <span className="clr-subtext cfg-error">{draftError}</span>}
      </div>
    </section>
  );
}
