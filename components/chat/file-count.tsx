interface Props { value: number }

export function FileCount({ value }: Props): React.ReactElement {
  return <span className="inline-flex min-w-[1.5ch] justify-center overflow-hidden align-middle font-mono tabular-nums">
    <span key={value} className="motion-safe:animate-[file-arrival_240ms_ease-out]">{value}</span>
  </span>;
}
