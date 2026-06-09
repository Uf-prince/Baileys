import {
	assertNodeErrorFree,
	binaryNodeToString,
	getAllBinaryNodeChildren,
	getBinaryNodeChild,
	getBinaryNodeChildBuffer,
	getBinaryNodeChildren,
	getBinaryNodeChildString,
	getBinaryNodeChildUInt,
	reduceBinaryNodeToDictionary
} from '../../WABinary/generic-utils'
import type { BinaryNode } from '../../WABinary/types'

describe('generic-utils', () => {
	describe('getBinaryNodeChildren', () => {
		it('returns matching children by tag', () => {
			const node: BinaryNode = {
				tag: 'parent',
				attrs: {},
				content: [
					{ tag: 'child', attrs: { id: '1' } },
					{ tag: 'child', attrs: { id: '2' } },
					{ tag: 'other', attrs: { id: '3' } }
				]
			}
			const children = getBinaryNodeChildren(node, 'child')
			expect(children).toHaveLength(2)
			expect(children[0]!.attrs.id).toBe('1')
			expect(children[1]!.attrs.id).toBe('2')
		})

		it('returns empty array when no matching children', () => {
			const node: BinaryNode = {
				tag: 'parent',
				attrs: {},
				content: [{ tag: 'other', attrs: {} }]
			}
			expect(getBinaryNodeChildren(node, 'child')).toEqual([])
		})

		it('returns empty array for undefined node', () => {
			expect(getBinaryNodeChildren(undefined, 'child')).toEqual([])
		})

		it('returns empty array when content is not an array', () => {
			const node: BinaryNode = {
				tag: 'parent',
				attrs: {},
				content: Buffer.from('hello')
			}
			expect(getBinaryNodeChildren(node, 'child')).toEqual([])
		})

		it('uses cached index on repeated calls', () => {
			const node: BinaryNode = {
				tag: 'parent',
				attrs: {},
				content: [
					{ tag: 'a', attrs: {} },
					{ tag: 'b', attrs: {} }
				]
			}
			const first = getBinaryNodeChildren(node, 'a')
			const second = getBinaryNodeChildren(node, 'a')
			expect(first).toBe(second)
		})
	})

	describe('getBinaryNodeChild', () => {
		it('returns first matching child', () => {
			const node: BinaryNode = {
				tag: 'parent',
				attrs: {},
				content: [
					{ tag: 'child', attrs: { id: '1' } },
					{ tag: 'child', attrs: { id: '2' } }
				]
			}
			const child = getBinaryNodeChild(node, 'child')
			expect(child!.attrs.id).toBe('1')
		})

		it('returns undefined when no match', () => {
			const node: BinaryNode = {
				tag: 'parent',
				attrs: {},
				content: []
			}
			expect(getBinaryNodeChild(node, 'child')).toBeUndefined()
		})
	})

	describe('getAllBinaryNodeChildren', () => {
		it('returns all content items when content is array', () => {
			const children: BinaryNode[] = [
				{ tag: 'a', attrs: {} },
				{ tag: 'b', attrs: {} }
			]
			const node: BinaryNode = { tag: 'parent', attrs: {}, content: children }
			expect(getAllBinaryNodeChildren(node)).toEqual(children)
		})

		it('returns empty array when content is not array', () => {
			const node: BinaryNode = { tag: 'parent', attrs: {}, content: Buffer.from('data') }
			expect(getAllBinaryNodeChildren(node)).toEqual([])
		})

		it('returns empty array when content is undefined', () => {
			const node: BinaryNode = { tag: 'parent', attrs: {} }
			expect(getAllBinaryNodeChildren(node)).toEqual([])
		})
	})

	describe('getBinaryNodeChildBuffer', () => {
		it('returns buffer content from matching child', () => {
			const buf = Buffer.from([1, 2, 3])
			const node: BinaryNode = {
				tag: 'parent',
				attrs: {},
				content: [{ tag: 'data', attrs: {}, content: buf }]
			}
			expect(getBinaryNodeChildBuffer(node, 'data')).toBe(buf)
		})

		it('returns Uint8Array content from matching child', () => {
			const arr = new Uint8Array([4, 5, 6])
			const node: BinaryNode = {
				tag: 'parent',
				attrs: {},
				content: [{ tag: 'data', attrs: {}, content: arr }]
			}
			expect(getBinaryNodeChildBuffer(node, 'data')).toBe(arr)
		})

		it('returns undefined when child content is string', () => {
			const node: BinaryNode = {
				tag: 'parent',
				attrs: {},
				content: [{ tag: 'data', attrs: {}, content: 'text' }]
			}
			expect(getBinaryNodeChildBuffer(node, 'data')).toBeUndefined()
		})

		it('returns undefined when child not found', () => {
			const node: BinaryNode = { tag: 'parent', attrs: {}, content: [] }
			expect(getBinaryNodeChildBuffer(node, 'missing')).toBeUndefined()
		})
	})

	describe('getBinaryNodeChildString', () => {
		it('returns string from buffer child', () => {
			const node: BinaryNode = {
				tag: 'parent',
				attrs: {},
				content: [{ tag: 'body', attrs: {}, content: Buffer.from('hello world') }]
			}
			expect(getBinaryNodeChildString(node, 'body')).toBe('hello world')
		})

		it('returns string content directly', () => {
			const node: BinaryNode = {
				tag: 'parent',
				attrs: {},
				content: [{ tag: 'body', attrs: {}, content: 'direct string' }]
			}
			expect(getBinaryNodeChildString(node, 'body')).toBe('direct string')
		})

		it('returns undefined for non-string/non-buffer content', () => {
			const node: BinaryNode = {
				tag: 'parent',
				attrs: {},
				content: [{ tag: 'body', attrs: {}, content: [{ tag: 'nested', attrs: {} }] }]
			}
			expect(getBinaryNodeChildString(node, 'body')).toBeUndefined()
		})
	})

	describe('getBinaryNodeChildUInt', () => {
		it('reads a 2-byte unsigned int', () => {
			const node: BinaryNode = {
				tag: 'parent',
				attrs: {},
				content: [{ tag: 'count', attrs: {}, content: Buffer.from([0x01, 0x00]) }]
			}
			expect(getBinaryNodeChildUInt(node, 'count', 2)).toBe(256)
		})

		it('reads a 1-byte unsigned int', () => {
			const node: BinaryNode = {
				tag: 'parent',
				attrs: {},
				content: [{ tag: 'val', attrs: {}, content: Buffer.from([42]) }]
			}
			expect(getBinaryNodeChildUInt(node, 'val', 1)).toBe(42)
		})

		it('returns undefined when child not found', () => {
			const node: BinaryNode = { tag: 'parent', attrs: {}, content: [] }
			expect(getBinaryNodeChildUInt(node, 'missing', 2)).toBeUndefined()
		})
	})

	describe('assertNodeErrorFree', () => {
		it('does not throw for node without error child', () => {
			const node: BinaryNode = {
				tag: 'iq',
				attrs: {},
				content: [{ tag: 'result', attrs: {} }]
			}
			expect(() => assertNodeErrorFree(node)).not.toThrow()
		})

		it('throws Boom when error child is present', () => {
			const node: BinaryNode = {
				tag: 'iq',
				attrs: {},
				content: [{ tag: 'error', attrs: { code: '404', text: 'not found' } }]
			}
			expect(() => assertNodeErrorFree(node)).toThrow('not found')
		})

		it('throws with "Unknown error" when error has no text', () => {
			const node: BinaryNode = {
				tag: 'iq',
				attrs: {},
				content: [{ tag: 'error', attrs: { code: '500' } }]
			}
			expect(() => assertNodeErrorFree(node)).toThrow('Unknown error')
		})
	})

	describe('reduceBinaryNodeToDictionary', () => {
		it('reduces children to a dictionary by name attribute', () => {
			const node: BinaryNode = {
				tag: 'parent',
				attrs: {},
				content: [
					{ tag: 'item', attrs: { name: 'key1', value: 'val1' } },
					{ tag: 'item', attrs: { name: 'key2', value: 'val2' } }
				]
			}
			const dict = reduceBinaryNodeToDictionary(node, 'item')
			expect(dict).toEqual({ key1: 'val1', key2: 'val2' })
		})

		it('uses config_code when name is not present', () => {
			const node: BinaryNode = {
				tag: 'parent',
				attrs: {},
				content: [{ tag: 'cfg', attrs: { config_code: 'c1', config_value: 'cv1' } }]
			}
			const dict = reduceBinaryNodeToDictionary(node, 'cfg')
			expect(dict).toEqual({ c1: 'cv1' })
		})

		it('returns empty object when no children match', () => {
			const node: BinaryNode = { tag: 'parent', attrs: {}, content: [] }
			expect(reduceBinaryNodeToDictionary(node, 'item')).toEqual({})
		})
	})

	describe('binaryNodeToString', () => {
		it('formats a simple node as XML-like string', () => {
			const node: BinaryNode = {
				tag: 'message',
				attrs: { id: '123', from: 'user@s.whatsapp.net' }
			}
			const str = binaryNodeToString(node)
			expect(str).toContain('<message')
			expect(str).toContain("id='123'")
			expect(str).toContain("from='user@s.whatsapp.net'")
			expect(str).toContain('/>')
		})

		it('formats a node with children', () => {
			const node: BinaryNode = {
				tag: 'parent',
				attrs: {},
				content: [{ tag: 'child', attrs: { x: '1' } }]
			}
			const str = binaryNodeToString(node)
			expect(str).toContain('<parent')
			expect(str).toContain('<child')
			expect(str).toContain('</parent>')
		})

		it('formats buffer content as hex', () => {
			const node: BinaryNode = {
				tag: 'data',
				attrs: {},
				content: Buffer.from([0xab, 0xcd])
			}
			const str = binaryNodeToString(node)
			expect(str).toContain('abcd')
		})

		it('handles string content', () => {
			const str = binaryNodeToString('hello')
			expect(str).toBe('hello')
		})

		it('handles null/undefined input', () => {
			expect(binaryNodeToString(undefined)).toBeUndefined()
		})
	})
})
