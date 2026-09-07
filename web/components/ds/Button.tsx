'use client';
import React from 'react';

export type ButtonVariant =
  | 'outline'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'neutral'
  | 'success-outline'
  | 'warning-outline'
  | 'danger-outline'
  | 'link'
  | 'link-neutral'
  | 'inverse';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  outline: '',
  primary: 'btn-primary',
  success: 'btn-success',
  warning: 'btn-warning',
  danger: 'btn-danger',
  neutral: 'btn-neutral',
  'success-outline': 'btn-success-outline',
  'warning-outline': 'btn-warning-outline',
  'danger-outline': 'btn-danger-outline',
  link: 'btn-link',
  'link-neutral': 'btn-link-neutral',
  inverse: 'btn-inverse',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  sm?: boolean;
  block?: boolean;
  icon?: string;
  iconRight?: string;
  loading?: boolean;
}

export function Button({
  variant = 'outline',
  sm,
  block,
  icon,
  iconRight,
  loading,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const cls = [
    'btn',
    VARIANT_CLASS[variant],
    sm ? 'btn-sm' : '',
    block ? 'btn-block' : '',
    icon && !children ? 'btn-icon' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={cls} {...rest}>
      {loading && (
        <span
          className="spinner spinner-sm"
          style={{ borderTopColor: 'currentColor', borderWidth: 2, width: 12, height: 12 }}
        ></span>
      )}
      {icon && !loading && <clr-icon shape={icon} size="16"></clr-icon>}
      {children}
      {iconRight && <clr-icon shape={iconRight} size="16"></clr-icon>}
    </button>
  );
}

export function ButtonGroup({
  children,
  className = '',
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={'btn-group ' + className} {...rest}>
      {children}
    </div>
  );
}
