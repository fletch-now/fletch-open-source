// Telegram's paper plane, drawn as a single path so it inherits the surrounding text
// colour and stays crisp from 12px up. Used wherever a link goes to Telegram or a
// feature delivers through it.

interface TelegramMarkProps {
  size?: number;
  className?: string;
}

export function TelegramMark({ size = 16, className }: TelegramMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M21.6 3.4 2.9 10.6c-1.1.4-1.1 1.1-.2 1.4l4.8 1.5 1.8 5.7c.2.6.4.8.9.8.4 0 .6-.2.9-.5l2.3-2.3 4.8 3.5c.9.5 1.5.2 1.7-.8L22.9 5c.3-1.3-.5-1.9-1.3-1.6ZM8.6 13.3l9.9-6.2c.5-.3.9-.1.6.2l-8.1 7.3-.3 3.3-2.1-4.6Z"
        fill="currentColor"
      />
    </svg>
  );
}
