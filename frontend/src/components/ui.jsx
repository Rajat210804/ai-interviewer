import { CircleAlert, LoaderCircle, X } from 'lucide-react';

const BUTTON_STYLES = {
  primary: 'bg-accent text-white hover:bg-accent-strong disabled:bg-accent/40 disabled:text-white/60',
  secondary: 'bg-raised text-ink border border-line hover:border-line-strong hover:bg-[#1c212b] disabled:opacity-50',
  ghost: 'text-ink-soft hover:text-ink hover:bg-raised disabled:opacity-40',
  danger: 'bg-critical/90 text-white hover:bg-critical disabled:opacity-50',
};

export function Button({ variant = 'secondary', size = 'md', className = '', children, ...props }) {
  const sizing = size === 'lg' ? 'h-12 px-6 text-[15px]' : size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm';
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

export const Spinner = ({ className = 'size-4' }) => <LoaderCircle className={`animate-spin ${className}`} aria-hidden />;

export function ErrorBanner({ message, onDismiss, action }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-critical/40 bg-critical/10 px-4 py-3 text-sm text-ink animate-rise">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-critical" aria-hidden />
      <p className="flex-1 leading-relaxed">{message}</p>
      {action}
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="text-muted hover:text-ink" aria-label="Dismiss">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

// A row of selectable cards; used for interview type, difficulty and length.
export function OptionGroup({ label, options, value, onChange, columns = 3 }) {
  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-medium text-ink-soft">{label}</legend>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.id)}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                selected ? 'border-accent bg-accent-soft/60' : 'border-line bg-raised/60 hover:border-line-strong'
              }`}
            >
              <span className={`block text-sm font-medium ${selected ? 'text-ink' : 'text-ink-soft'}`}>{option.label}</span>
              {option.description && <span className="mt-0.5 block text-xs leading-snug text-muted">{option.description}</span>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function TextField({ label, hint, ...props }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-soft">
        {label} {hint && <span className="font-normal text-muted">{hint}</span>}
      </span>
      <input
        className="h-11 w-full rounded-lg border border-line bg-raised/60 px-3.5 text-[15px] text-ink placeholder:text-muted/70 transition-colors hover:border-line-strong focus:border-accent focus:outline-none"
        {...props}
      />
    </label>
  );
}

// Interviewer photo with a graceful fallback if the image can't load.
export function Portrait({ avatar, className = '', initialsClassName = 'text-lg' }) {
  const initials = avatar.name.split(' ').map((part) => part[0]).join('');
  return (
    <div className={`relative overflow-hidden bg-gradient-to-br from-[#1d2533] to-[#121720] ${className}`}>
      <span className={`absolute inset-0 grid place-items-center font-semibold text-muted ${initialsClassName}`}>{initials}</span>
      <img
        src={avatar.photo}
        alt={`${avatar.name}, ${avatar.label.toLowerCase()} avatar`}
        className="relative size-full object-cover"
        onError={(event) => { event.currentTarget.style.display = 'none'; }}
      />
    </div>
  );
}
