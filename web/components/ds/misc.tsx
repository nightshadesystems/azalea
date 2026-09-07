'use client';
import React from 'react';

export type Status = 'info' | 'success' | 'warning' | 'danger';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  header?: React.ReactNode;
  footer?: React.ReactNode;
  clickable?: boolean;
}

export function Card({ header, footer, clickable, className = '', children, onClick, ...rest }: CardProps) {
  const cls = ['card', clickable ? 'clickable' : '', className].filter(Boolean).join(' ');
  return (
    <div className={cls} onClick={onClick} {...rest}>
      {header && <div className="card-header">{header}</div>}
      {children}
      {footer && <div className="card-footer">{footer}</div>}
    </div>
  );
}

export interface CardBlockProps {
  title?: React.ReactNode;
  text?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export function CardBlock({ title, text, className = '', children }: CardBlockProps) {
  return (
    <div className={'card-block ' + className}>
      {title && <div className="card-title">{title}</div>}
      {text && <div className="card-text">{text}</div>}
      {children}
    </div>
  );
}

export interface LabelProps extends React.HTMLAttributes<HTMLSpanElement> {
  status?: Status;
  accent?: boolean;
  clickable?: boolean;
  dismissable?: boolean;
  onDismiss?: () => void;
  badge?: React.ReactNode;
}

export function Label({
  status,
  accent,
  clickable,
  dismissable,
  onDismiss,
  badge,
  className = '',
  children,
  ...rest
}: LabelProps) {
  const cls = [
    'label',
    status ? 'label-' + status : '',
    accent ? 'label-accent' : '',
    clickable ? 'clickable' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cls} {...rest}>
      {children}
      {badge != null && <Badge>{badge}</Badge>}
      {dismissable && (
        <button className="label-dismiss" aria-label="Dismiss" onClick={onDismiss}>
          ×
        </button>
      )}
    </span>
  );
}

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status?: Status;
  accent?: boolean;
}

export function Badge({ status, accent, className = '', children, ...rest }: BadgeProps) {
  const cls = ['badge', status ? 'badge-' + status : '', accent ? 'badge-accent' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  );
}

const alertShapes: Record<Status, string> = {
  info: 'info-circle',
  success: 'check-circle',
  warning: 'exclamation-triangle',
  danger: 'exclamation-circle',
};

export interface AlertAction {
  label: React.ReactNode;
  onClick?: () => void;
}

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  status?: Status;
  appLevel?: boolean;
  sm?: boolean;
  closable?: boolean;
  onClose?: () => void;
  actions?: AlertAction[];
  items?: React.ReactNode[];
}

export function Alert({
  status = 'info',
  appLevel,
  sm,
  closable,
  onClose,
  actions,
  items,
  children,
  className = '',
  ...rest
}: AlertProps) {
  const [closed, setClosed] = React.useState(false);
  if (closed) return null;
  const cls = ['alert', 'alert-' + status, appLevel ? 'alert-app-level' : '', sm ? 'alert-sm' : '', className]
    .filter(Boolean)
    .join(' ');
  const close = () => {
    setClosed(true);
    if (onClose) onClose();
  };
  const body = items ? (
    <div className="alert-items">
      {items.map((it, i) => (
        <div key={i} className="alert-item">
          <span className="alert-text">{it}</span>
        </div>
      ))}
    </div>
  ) : (
    <span className="alert-text">{children}</span>
  );
  return (
    <div className={cls} role="alert" {...rest}>
      <clr-icon class="alert-icon is-solid" shape={alertShapes[status]} size={sm ? 14 : 16}></clr-icon>
      {body}
      {actions && (
        <div className="alert-actions">
          {actions.map((a, i) => (
            <button key={i} className="alert-action" onClick={a.onClick}>
              {a.label}
            </button>
          ))}
        </div>
      )}
      {closable && (
        <button className="close" aria-label="Close" onClick={close}>
          ×
        </button>
      )}
    </div>
  );
}

export interface IconProps extends React.HTMLAttributes<HTMLElement> {
  shape: string;
  size?: number | string;
  solid?: boolean;
  dir?: 'up' | 'down' | 'left' | 'right';
}

export function Icon({ shape, size = 16, solid, dir, className = '', style, ...rest }: IconProps) {
  const cls = [solid ? 'is-solid' : '', className].filter(Boolean).join(' ');
  return <clr-icon shape={shape} size={String(size)} class={cls || undefined} dir={dir} style={style} {...rest}></clr-icon>;
}

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  inline?: boolean;
  className?: string;
}

export function Spinner({ size = 'md', inline, className = '' }: SpinnerProps) {
  const cls = ['spinner', size === 'sm' ? 'spinner-sm' : size === 'md' ? 'spinner-md' : '', inline ? 'spinner-inline' : '', className]
    .filter(Boolean)
    .join(' ');
  return <span className={cls}></span>;
}
