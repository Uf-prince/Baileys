import type { BinaryNode } from '../WABinary'
import { S_WHATSAPP_NET } from '../WABinary'

/**
 * Build an IQ query targeting the `w:biz` business-profile namespace.
 */
export const makeBizProfileQuery = (
	type: 'get' | 'set',
	content: BinaryNode[],
	query: (node: BinaryNode) => Promise<BinaryNode>
) =>
	query({
		tag: 'iq',
		attrs: {
			to: S_WHATSAPP_NET,
			type,
			xmlns: 'w:biz'
		},
		content: [
			{
				tag: 'business_profile',
				attrs: {
					v: '3',
					mutation_type: 'delta'
				},
				content
			}
		]
	})

/**
 * Build an IQ query targeting the `w:biz:catalog` namespace.
 */
export const makeCatalogQuery = (
	type: 'get' | 'set',
	content: BinaryNode[],
	query: (node: BinaryNode) => Promise<BinaryNode>,
	extraAttrs?: Record<string, string>
) =>
	query({
		tag: 'iq',
		attrs: {
			to: S_WHATSAPP_NET,
			type,
			xmlns: 'w:biz:catalog',
			...extraAttrs
		},
		content
	})

/**
 * A reusable width+height dimension node pair (100x100),
 * used throughout the catalog/product APIs.
 */
export const imageDimensionNodes = (): BinaryNode[] => [
	{
		tag: 'width',
		attrs: {},
		content: Buffer.from('100')
	},
	{
		tag: 'height',
		attrs: {},
		content: Buffer.from('100')
	}
]
