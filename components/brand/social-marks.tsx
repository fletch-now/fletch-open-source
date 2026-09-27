interface MarkProps { size?: number }

export function XMark({ size = 18 }: MarkProps): React.JSX.Element {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.9 2h3.3l-7.2 8.2L23.5 22h-6.7l-5.2-7.1L5.4 22H2.1l7.8-8.9L1.5 2h6.9l4.7 6.5L18.9 2Zm-1.2 18h1.8L7.4 3.9H5.5L17.7 20Z" /></svg>;
}

export function GitHubMark({ size = 18 }: MarkProps): React.JSX.Element {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .9a11.1 11.1 0 0 0-3.5 21.6c.6.1.8-.2.8-.5v-2c-3.4.7-4.1-1.4-4.1-1.4-.5-1.3-1.2-1.6-1.2-1.6-1.1-.8.1-.8.1-.8 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.5 0-1.2.4-2.2 1.1-3-.1-.3-.5-1.4.1-3 0 0 .9-.3 3.1 1.1a10.8 10.8 0 0 1 5.6 0c2.1-1.4 3-1.1 3-1.1.6 1.6.3 2.7.1 3 .7.8 1.2 1.8 1.2 3 0 4.3-2.8 5.2-5.5 5.5.4.4.8 1.1.8 2.2V22c0 .3.2.6.8.5A11.1 11.1 0 0 0 12 .9Z" /></svg>;
}
