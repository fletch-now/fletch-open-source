"use client";

import type { ReactElement } from "react";
import type { BuildAttachment } from "@/lib/build/types";
import { Paperclip } from "@/components/ui/icons";
import { attachmentBytes, isImageAttachment } from "@/lib/build/attachments";
import Image from "next/image";

interface Props {
  file: BuildAttachment;
  onRemove?: () => void;
}

export function BriefFile({ file, onRemove }: Props): ReactElement {
  const image = isImageAttachment(file);
  const source = image ? `data:${file.mediaType};base64,${file.data}` : `data:text/plain;charset=utf-8,${encodeURIComponent(file.content)}`;
  return <div className="flex w-full min-w-0 items-start rounded-xl border border-line bg-raised text-ink">
    <details className="min-w-0 flex-1">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-hood">
        {image ? <Image unoptimized src={source} alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded object-contain" /> : <Paperclip className="h-4 w-4 shrink-0" />}
        <span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span>
        <span className="shrink-0 text-xs text-ink-faint">{Math.max(1, Math.ceil(attachmentBytes(file) / 1024))} KB · Open</span>
      </summary>
      <div className="border-t border-line p-3">
        <a href={source} download={file.name} className="text-xs underline underline-offset-4">Download {image ? "image" : "full text"}</a>
        {image ? <Image unoptimized src={source} alt={file.name} width={800} height={600} className="mt-3 max-h-80 w-full object-contain" /> : <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5">{file.content}</pre>}
      </div>
    </details>
    {onRemove ? <button type="button" onClick={onRemove} aria-label={`Remove ${file.name}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-faint hover:text-ink focus-visible:outline-2 focus-visible:outline-hood">×</button> : null}
  </div>;
}
