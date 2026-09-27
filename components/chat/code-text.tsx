import { Fragment } from "react";

interface CodeTextProps {
  content: string;
}

// Render tokens as text nodes, never HTML: generated files are untrusted input.
export function CodeText({ content }: CodeTextProps): React.ReactElement {
  const tokens = content.split(
    /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:pragma|solidity|contract|interface|library|function|constructor|event|error|modifier|mapping|address|uint256|bool|string|bytes32|public|private|internal|external|view|pure|payable|returns|return|import|from|export|default|const|let|var|async|await|if|else|for|while|new|true|false|null|undefined|type|extends|class)\b|\b\d+(?:\.\d+)?\b)/g,
  );
  return (
    <pre className="whitespace-pre font-mono text-[12px] leading-5 text-ink">
      {tokens.map(function token(text, index) {
        if (index % 2 === 0) return <Fragment key={index}>{text}</Fragment>;
        let tone = "text-violet-700";
        if (/^["'`]/.test(text)) tone = "text-emerald-700";
        else if (text.startsWith("//") || text.startsWith("/*"))
          tone = "text-ink-faint";
        else if (/^\d/.test(text)) tone = "text-amber-700";
        return (
          <span key={index} className={tone}>
            {text}
          </span>
        );
      })}
    </pre>
  );
}
