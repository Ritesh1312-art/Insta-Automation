'use client';

import type { InputHTMLAttributes } from 'react';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_MESSAGE,
  PASSWORD_POLICY_PATTERN,
} from '@/lib/password-policy';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'minLength' | 'maxLength' | 'pattern'> & {
  showHelp?: boolean;
};

export default function PasswordInput({ showHelp = true, className = '', ...props }: Props) {
  return (
    <div className="space-y-1.5">
      <input
        {...props}
        type="password"
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={PASSWORD_MAX_LENGTH}
        pattern={PASSWORD_POLICY_PATTERN}
        title={PASSWORD_POLICY_MESSAGE}
        className={className}
      />
      {showHelp && <p className="text-[11px] leading-relaxed text-slate-400">{PASSWORD_POLICY_MESSAGE}</p>}
    </div>
  );
}
