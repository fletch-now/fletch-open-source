// The one "something is happening" mark: a dot with a soft ping behind it.
interface PulseDotProps {
  className?: string;
}

export function PulseDot({ className = "" }: PulseDotProps) {
  return (
    <span className={`relative flex h-2 w-2 shrink-0 ${className}`} aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-hood opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-hood" />
    </span>
  );
}
