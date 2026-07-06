import { describe, it, expect } from 'vitest'
import { moveReducer, IDLE, type MoveState } from '@/interaction/moveMachine'

describe('moveReducer', () => {
  it('POINTER_DOWN from idle enters pressed with the press geometry', () => {
    const s = moveReducer(IDLE, { type: 'POINTER_DOWN', slotIndex: 3, pointerId: 1, x: 10, y: 20 })
    expect(s).toEqual({ kind: 'pressed', slotIndex: 3, pointerId: 1, startX: 10, startY: 20 })
  })

  it('POINTER_DOWN is ignored when not idle', () => {
    const dragging: MoveState = { kind: 'dragging', from: 0, source: 'cell', over: null }
    expect(moveReducer(dragging, { type: 'POINTER_DOWN', slotIndex: 1, pointerId: 2, x: 0, y: 0 })).toBe(dragging)
  })

  it('DRAG_START from idle begins a drag (mouse/pen path)', () => {
    const s = moveReducer(IDLE, { type: 'DRAG_START', from: 5, source: 'cell' })
    expect(s).toEqual({ kind: 'dragging', from: 5, source: 'cell', over: null })
  })

  it('DRAG_START from pressed begins a drag (touch path)', () => {
    const pressed: MoveState = { kind: 'pressed', slotIndex: 5, pointerId: 1, startX: 0, startY: 0 }
    const s = moveReducer(pressed, { type: 'DRAG_START', from: 5, source: 'cell' })
    expect(s).toEqual({ kind: 'dragging', from: 5, source: 'cell', over: null })
  })

  it('DRAG_START carries the search source', () => {
    const s = moveReducer(IDLE, { type: 'DRAG_START', from: -1, source: 'search' })
    expect(s).toEqual({ kind: 'dragging', from: -1, source: 'search', over: null })
  })

  it('DRAG_OVER updates the destination only while dragging', () => {
    const dragging: MoveState = { kind: 'dragging', from: 0, source: 'cell', over: null }
    expect(moveReducer(dragging, { type: 'DRAG_OVER', over: 4 })).toEqual({
      kind: 'dragging', from: 0, source: 'cell', over: 4,
    })
    // no-op when unchanged (referential stability)
    const over4: MoveState = { kind: 'dragging', from: 0, source: 'cell', over: 4 }
    expect(moveReducer(over4, { type: 'DRAG_OVER', over: 4 })).toBe(over4)
    // ignored outside dragging
    expect(moveReducer(IDLE, { type: 'DRAG_OVER', over: 4 })).toBe(IDLE)
  })

  it('GRAB from idle arms move with over on the source cell', () => {
    expect(moveReducer(IDLE, { type: 'GRAB', from: 7 })).toEqual({ kind: 'moveArmed', from: 7, over: 7 })
  })

  it('GRAB is ignored when already dragging or armed', () => {
    const armed: MoveState = { kind: 'moveArmed', from: 2, over: 2 }
    expect(moveReducer(armed, { type: 'GRAB', from: 9 })).toBe(armed)
  })

  it('RETARGET moves the armed destination only while armed', () => {
    const armed: MoveState = { kind: 'moveArmed', from: 2, over: 2 }
    expect(moveReducer(armed, { type: 'RETARGET', over: 5 })).toEqual({ kind: 'moveArmed', from: 2, over: 5 })
    // no-op when unchanged
    expect(moveReducer(armed, { type: 'RETARGET', over: 2 })).toBe(armed)
    // ignored when not armed
    const dragging: MoveState = { kind: 'dragging', from: 0, source: 'cell', over: 1 }
    expect(moveReducer(dragging, { type: 'RETARGET', over: 5 })).toBe(dragging)
  })

  it('RESET returns to idle from any state', () => {
    const states: MoveState[] = [
      IDLE,
      { kind: 'pressed', slotIndex: 1, pointerId: 1, startX: 0, startY: 0 },
      { kind: 'dragging', from: 1, source: 'cell', over: 2 },
      { kind: 'moveArmed', from: 1, over: 3 },
    ]
    for (const s of states) expect(moveReducer(s, { type: 'RESET' })).toEqual(IDLE)
  })

  it('a full keyboard grab → retarget → reset cycle', () => {
    let s = moveReducer(IDLE, { type: 'GRAB', from: 0 })
    s = moveReducer(s, { type: 'RETARGET', over: 1 })
    s = moveReducer(s, { type: 'RETARGET', over: 2 })
    expect(s).toEqual({ kind: 'moveArmed', from: 0, over: 2 })
    s = moveReducer(s, { type: 'RESET' })
    expect(s).toBe(IDLE)
  })

  it('a full pointer drag cycle', () => {
    let s = moveReducer(IDLE, { type: 'DRAG_START', from: 3, source: 'cell' })
    s = moveReducer(s, { type: 'DRAG_OVER', over: 6 })
    expect(s).toEqual({ kind: 'dragging', from: 3, source: 'cell', over: 6 })
    s = moveReducer(s, { type: 'RESET' })
    expect(s).toBe(IDLE)
  })
})
