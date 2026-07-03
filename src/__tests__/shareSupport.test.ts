import { describe, it, expect } from 'vitest'
import {
  supportsClipboardImage,
  supportsFileShare,
  supportsUrlShare,
  type ShareEnv,
} from '@/utils/shareSupport'

const noop = () => {}

describe('supportsClipboardImage', () => {
  it('true only when both clipboard.write and ClipboardItem are present', () => {
    expect(supportsClipboardImage({ clipboardWrite: noop, clipboardItem: noop })).toBe(true)
  })

  it('false when clipboard.write is missing', () => {
    expect(supportsClipboardImage({ clipboardItem: noop })).toBe(false)
  })

  it('false when ClipboardItem is missing', () => {
    expect(supportsClipboardImage({ clipboardWrite: noop })).toBe(false)
  })

  it('false when both are missing (typical jsdom / older browsers)', () => {
    expect(supportsClipboardImage({})).toBe(false)
  })

  it('false when write is present but not a function', () => {
    expect(supportsClipboardImage({ clipboardWrite: {}, clipboardItem: noop })).toBe(false)
  })
})

describe('supportsFileShare', () => {
  const file = new File(['x'], 'probe.png', { type: 'image/png' })

  it('true when share + canShare exist and canShare approves the files payload', () => {
    const env: ShareEnv = { share: noop, canShare: () => true }
    expect(supportsFileShare(file, env)).toBe(true)
  })

  it('false when canShare rejects the files payload (typical desktop)', () => {
    const env: ShareEnv = { share: noop, canShare: () => false }
    expect(supportsFileShare(file, env)).toBe(false)
  })

  it('false when navigator.share is absent even if canShare exists', () => {
    const env: ShareEnv = { canShare: () => true }
    expect(supportsFileShare(file, env)).toBe(false)
  })

  it('false when canShare is absent', () => {
    const env: ShareEnv = { share: noop }
    expect(supportsFileShare(file, env)).toBe(false)
  })

  it('passes the file through to canShare inside a files array', () => {
    let received: { files?: File[] } | null = null
    const env: ShareEnv = {
      share: noop,
      canShare: (data) => {
        received = data
        return true
      },
    }
    supportsFileShare(file, env)
    expect(received).toEqual({ files: [file] })
  })
})

describe('supportsUrlShare', () => {
  it('true when navigator.share exists (canShare not required for a url)', () => {
    expect(supportsUrlShare({ share: noop })).toBe(true)
  })

  it('false when navigator.share is absent', () => {
    expect(supportsUrlShare({})).toBe(false)
    expect(supportsUrlShare({ canShare: () => true })).toBe(false)
  })
})
