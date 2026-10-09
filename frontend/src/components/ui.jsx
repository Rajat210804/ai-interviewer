import { useId, useState } from 'react';
import { CircleAlert, LoaderCircle, X } from 'lucide-react';

const BUTTON_STYLES = {
  primary:
    'border border-accent-strong bg-accent-strong text-white hover:border-[#2b609f] hover:bg-[#2b609f] disabled:border-line disabled:bg-raised disabled:text-muted',
  secondary:
    'border border-line-strong bg-raised text-ink hover:border-muted hover:bg-[#212733] disabled:opacity-50',
  ghost:
    'border border-transparent text-ink-soft hover:text-ink hover:bg-raised disabled:opacity-40',
  danger:
    'border border-critical/60 bg-critical/15 text-critical hover:bg-critical/25 disabled:opacity-50',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...props
}) {
  const sizing =
    size === 'lg'
      ? 'min-h-12 px-5 py-2.5 text-sm'
      : size === 'sm'
        ? 'min-h-9 px-3 py-1.5 text-xs'
        : 'min-h-10 px-4 py-2 text-sm';
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${sizing} ${BUTTON_STYLES[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export const Spinner = ({ className = 'size-4' }) => (
  <LoaderCircle className={`shrink-0 animate-spin ${className}`} aria-hidden />
);

export function ErrorBanner({ message, onDismiss, action }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex flex-wrap items-start gap-3 rounded-lg border border-critical/35 bg-critical/8 px-4 py-3 text-sm text-ink"
    >
      <CircleAlert
        className="mt-0.5 size-4 shrink-0 text-critical"
        aria-hidden
      />
      <p className="min-w-0 flex-1 leading-relaxed">{message}</p>
      {action}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="rounded p-1 text-muted hover:text-ink"
          aria-label="Dismiss message"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

// Native radio inputs provide keyboard navigation and announce the selected option.
export function OptionGroup({ label, options, value, onChange, columns = 3 }) {
  const name = useId();
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2.5 text-sm font-medium text-ink-soft">
        {label}
      </legend>
      <div
        className="option-grid grid gap-2"
        style={{ '--option-columns': columns }}
      >
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <label
              key={String(option.id)}
              className="group relative block min-w-0 cursor-pointer"
            >
              <input
                type="radio"
                name={name}
                value={String(option.id)}
                checked={selected}
                onChange={() => onChange(option.id)}
                className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0"
              />
              <span
                className={`block h-full rounded-lg border px-3.5 py-3 transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${
                  selected
                    ? 'border-accent/80 bg-accent-soft/40'
                    : 'border-line bg-raised/35 group-hover:border-line-strong'
                }`}
              >
                <span
                  className={`block text-sm font-medium ${selected ? 'text-ink' : 'text-ink-soft'}`}
                >
                  {option.label}
                </span>
                {option.description && (
                  <span className="mt-1 block text-xs leading-relaxed text-muted">
                    {option.description}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function TextField({ label, hint, className = '', ...props }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-ink-soft">
        {label} {hint && <span className="font-normal text-muted">{hint}</span>}
      </span>
      <input
        className={`h-11 w-full rounded-lg border border-line-strong bg-canvas/45 px-3.5 text-sm text-ink placeholder:text-muted transition-colors hover:border-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent ${className}`}
        {...props}
      />
    </label>
  );
}

// Photos represent AI personas. An unavailable external image leaves a readable initials fallback.
export function Portrait({
  avatar,
  className = '',
  initialsClassName = 'text-lg',
}) {
  const [failedPhoto, setFailedPhoto] = useState(null);
  const initials = avatar.name
    .split(' ')
    .map((part) => part[0])
    .join('');
  return (
    <div className={`relative overflow-hidden bg-raised ${className}`}>
      <span
        className={`absolute inset-0 grid place-items-center font-semibold text-muted ${initialsClassName}`}
        aria-hidden
      >
        {initials}
      </span>
      {failedPhoto !== avatar.photo && (
        <img
          src={avatar.photo}
          alt={`${avatar.name}, AI interviewer avatar`}
          className="relative size-full object-cover"
          loading="lazy"
          onError={() => setFailedPhoto(avatar.photo)}
        />
      )}
      {failedPhoto === avatar.photo && (
        <span className="sr-only">{avatar.name}, AI interviewer avatar</span>
      )}
    </div>
  );
}
