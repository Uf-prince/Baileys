import * as constants from '../../WABinary/constants'
import { decodeBinaryNode, decodeDecompressedBinaryNode, decompressingIfRequired } from '../../WABinary/decode'
import { encodeBinaryNode } from '../../WABinary/encode'
import type { BinaryNode } from '../../WABinary/types'

describe('WABinary encode/decode', () => {
	const roundtrip = async (node: BinaryNode): Promise<BinaryNode> => {
		const encoded = encodeBinaryNode(node)
		// encodeBinaryNode prefixes with 0x00; decodeBinaryNode expects compressed/uncompressed prefix
		return decodeBinaryNode(encoded)
	}

	describe('roundtrip: encode then decode', () => {
		it('handles a simple node with string attributes', async () => {
			const node: BinaryNode = {
				tag: 'iq',
				attrs: { id: 'abc123', type: 'get' }
			}
			const decoded = await roundtrip(node)
			expect(decoded.tag).toBe('iq')
			expect(decoded.attrs.id).toBe('abc123')
			expect(decoded.attrs.type).toBe('get')
		})

		it('handles a node with binary content', async () => {
			const content = Buffer.from([0x01, 0x02, 0x03, 0x04])
			const node: BinaryNode = {
				tag: 'data',
				attrs: { xmlns: 'test' },
				content
			}
			const decoded = await roundtrip(node)
			expect(decoded.tag).toBe('data')
			expect(Buffer.from(decoded.content as Buffer)).toEqual(content)
		})

		it('handles a node with child nodes', async () => {
			const node: BinaryNode = {
				tag: 'iq',
				attrs: { id: '1', type: 'set' },
				content: [
					{ tag: 'query', attrs: { xmlns: 'test' } },
					{ tag: 'item', attrs: { name: 'foo' } }
				]
			}
			const decoded = await roundtrip(node)
			expect(decoded.tag).toBe('iq')
			expect(Array.isArray(decoded.content)).toBe(true)
			const children = decoded.content as BinaryNode[]
			expect(children).toHaveLength(2)
			expect(children[0]!.tag).toBe('query')
			expect(children[1]!.tag).toBe('item')
			expect(children[1]!.attrs.name).toBe('foo')
		})

		it('handles deeply nested nodes', async () => {
			const node: BinaryNode = {
				tag: 'root',
				attrs: {},
				content: [
					{
						tag: 'level1',
						attrs: { depth: '1' },
						content: [{ tag: 'level2', attrs: { depth: '2' }, content: Buffer.from('leaf') }]
					}
				]
			}
			const decoded = await roundtrip(node)
			const level1 = (decoded.content as BinaryNode[])[0]!
			expect(level1.tag).toBe('level1')
			const level2 = (level1.content as BinaryNode[])[0]!
			expect(level2.tag).toBe('level2')
			expect(Buffer.from(level2.content as Buffer).toString()).toBe('leaf')
		})

		it('handles node with JID attribute', async () => {
			const node: BinaryNode = {
				tag: 'message',
				attrs: { from: '1234567890@s.whatsapp.net', to: '9876543210@s.whatsapp.net' }
			}
			const decoded = await roundtrip(node)
			expect(decoded.attrs.from).toBe('1234567890@s.whatsapp.net')
			expect(decoded.attrs.to).toBe('9876543210@s.whatsapp.net')
		})

		it('handles nibble-encoded strings (numeric with dots/dashes)', async () => {
			const node: BinaryNode = {
				tag: 'item',
				attrs: { version: '2.23.4' }
			}
			const decoded = await roundtrip(node)
			expect(decoded.attrs.version).toBe('2.23.4')
		})

		it('handles hex-encoded strings', async () => {
			const node: BinaryNode = {
				tag: 'item',
				attrs: { hash: 'ABCDEF01' }
			}
			const decoded = await roundtrip(node)
			expect(decoded.attrs.hash).toBe('ABCDEF01')
		})

		it('handles node with empty content array', async () => {
			const node: BinaryNode = {
				tag: 'empty',
				attrs: { id: 'x' },
				content: []
			}
			// empty array won't produce content on round-trip since writeListStart(0) = LIST_EMPTY
			const encoded = encodeBinaryNode(node)
			const decoded = await decodeBinaryNode(encoded)
			expect(decoded.tag).toBe('empty')
		})
	})

	describe('decompressingIfRequired', () => {
		it('strips the leading byte for uncompressed data', async () => {
			const data = Buffer.from([0x00, 0x41, 0x42, 0x43])
			const result = await decompressingIfRequired(data)
			expect(result).toEqual(Buffer.from([0x41, 0x42, 0x43]))
		})
	})

	describe('decodeDecompressedBinaryNode', () => {
		it('throws on invalid (empty) buffer', () => {
			expect(() => decodeDecompressedBinaryNode(Buffer.from([]), constants)).toThrow()
		})
	})

	describe('encodeBinaryNode', () => {
		it('throws for node with undefined tag', () => {
			const node = { tag: '', attrs: {} } as unknown as BinaryNode
			expect(() => encodeBinaryNode(node)).toThrow()
		})

		it('skips null/undefined attributes', async () => {
			const node: BinaryNode = {
				tag: 'test',
				attrs: { keep: 'yes', drop: undefined as unknown as string }
			}
			const decoded = await roundtrip(node)
			expect(decoded.attrs.keep).toBe('yes')
			expect(decoded.attrs.drop).toBeUndefined()
		})
	})
})
