// Pure feature-detection for the shareability actions (I1 clipboard-image copy,
// I2 Web Share). The relevant globals are passed in as plain env objects so the
// logic stays a pure function and is unit-testable in jsdom, where none of these
// browser APIs exist. The real-env readers below are the only impure glue.

export interface ClipboardEnv {
  /** navigator.clipboard.write, if present. */
  clipboardWrite?: unknown
  /** The ClipboardItem constructor, if present. */
  clipboardItem?: unknown
}

export interface ShareEnv {
  /** navigator.share, if present. */
  share?: unknown
  /** navigator.canShare, if present. */
  canShare?: (data: { files?: File[] }) => boolean
}

// True when the browser can write an image Blob to the clipboard. Requires both
// navigator.clipboard.write and the ClipboardItem constructor — the practical gate
// for image copy (a Blob alone can't go on the clipboard without ClipboardItem).
export function supportsClipboardImage(env: ClipboardEnv): boolean {
  return typeof env.clipboardWrite === 'function' && typeof env.clipboardItem === 'function'
}

// True when the native share sheet can share files (the PNG). canShare({ files })
// is the only reliable probe and needs a representative file, so callers pass one.
export function supportsFileShare(file: File, env: ShareEnv): boolean {
  return (
    typeof env.share === 'function' &&
    typeof env.canShare === 'function' &&
    env.canShare({ files: [file] })
  )
}

// True when the native share sheet can share a URL (the share link). Sharing a bare
// URL needs only navigator.share; canShare is not required for the { url } payload.
export function supportsUrlShare(env: ShareEnv): boolean {
  return typeof env.share === 'function'
}

// Impure adapters that read the real globals into the env shapes above. Kept out of
// the pure functions so tests target the logic, not the environment. `typeof X` is
// used before touching a possibly-undefined global so these never throw.
export function realClipboardEnv(): ClipboardEnv {
  return {
    clipboardWrite: typeof navigator !== 'undefined' ? navigator.clipboard?.write : undefined,
    clipboardItem: typeof ClipboardItem !== 'undefined' ? ClipboardItem : undefined,
  }
}

export function realShareEnv(): ShareEnv {
  if (typeof navigator === 'undefined') return {}
  return {
    share: navigator.share?.bind(navigator),
    canShare: navigator.canShare?.bind(navigator),
  }
}
