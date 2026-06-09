import type { GetCatalogOptions, ProductCreate, ProductUpdate, SocketConfig, WAMediaUpload } from '../Types'
import type { UpdateBussinesProfileProps } from '../Types/Bussines'
import { getRawMediaUploadData } from '../Utils'
import {
	parseCatalogNode,
	parseCollectionsNode,
	parseOrderDetailsNode,
	parseProductNode,
	toProductNode,
	uploadingNecessaryImagesOfProduct
} from '../Utils/business'
import { type BinaryNode, jidNormalizedUser, S_WHATSAPP_NET } from '../WABinary'
import { getBinaryNodeChild } from '../WABinary/generic-utils'
import { imageDimensionNodes, makeBizProfileQuery, makeCatalogQuery } from './business-utils'
import { makeMessagesRecvSocket } from './messages-recv'

export const makeBusinessSocket = (config: SocketConfig) => {
	const sock = makeMessagesRecvSocket(config)
	const { authState, query, waUploadToServer } = sock

	const updateBussinesProfile = async (args: UpdateBussinesProfileProps) => {
		const node: BinaryNode[] = []
		const simpleFields: (keyof UpdateBussinesProfileProps)[] = ['address', 'email', 'description']

		node.push(
			...simpleFields
				.filter(key => args[key] !== undefined && args[key] !== null)
				.map(key => ({
					tag: key,
					attrs: {},
					content: args[key] as string
				}))
		)

		if (args.websites !== undefined) {
			node.push(
				...args.websites.map(website => ({
					tag: 'website',
					attrs: {},
					content: website
				}))
			)
		}

		if (args.hours !== undefined) {
			node.push({
				tag: 'business_hours',
				attrs: { timezone: args.hours.timezone },
				content: args.hours.days.map(dayConfig => {
					const base = {
						tag: 'business_hours_config',
						attrs: {
							day_of_week: dayConfig.day,
							mode: dayConfig.mode
						}
					} as const

					if (dayConfig.mode === 'specific_hours') {
						return {
							...base,
							attrs: {
								...base.attrs,
								open_time: dayConfig.openTimeInMinutes,
								close_time: dayConfig.closeTimeInMinutes
							}
						}
					}

					return base
				})
			})
		}

		return makeBizProfileQuery('set', node, query)
	}

	const updateCoverPhoto = async (photo: WAMediaUpload) => {
		const { fileSha256, filePath } = await getRawMediaUploadData(photo, 'biz-cover-photo')
		const fileSha256B64 = fileSha256.toString('base64')

		const { meta_hmac, fbid, ts } = await waUploadToServer(filePath, {
			fileEncSha256B64: fileSha256B64,
			mediaType: 'biz-cover-photo'
		})

		await makeBizProfileQuery(
			'set',
			[
				{
					tag: 'cover_photo',
					attrs: { id: String(fbid), op: 'update', token: meta_hmac!, ts: String(ts) }
				}
			],
			query
		)

		return fbid!
	}

	const removeCoverPhoto = async (id: string) => {
		return makeBizProfileQuery(
			'set',
			[
				{
					tag: 'cover_photo',
					attrs: { op: 'delete', id }
				}
			],
			query
		)
	}

	const getCatalog = async ({ jid, limit, cursor }: GetCatalogOptions) => {
		jid = jid || authState.creds.me?.id
		jid = jidNormalizedUser(jid)

		const queryParamNodes: BinaryNode[] = [
			{
				tag: 'limit',
				attrs: {},
				content: Buffer.from((limit || 10).toString())
			},
			...imageDimensionNodes()
		]

		if (cursor) {
			queryParamNodes.push({
				tag: 'after',
				attrs: {},
				content: cursor
			})
		}

		const result = await makeCatalogQuery(
			'get',
			[
				{
					tag: 'product_catalog',
					attrs: {
						jid,
						allow_shop_source: 'true'
					},
					content: queryParamNodes
				}
			],
			query
		)
		return parseCatalogNode(result)
	}

	const getCollections = async (jid?: string, limit = 51) => {
		jid = jid || authState.creds.me?.id
		jid = jidNormalizedUser(jid)
		const result = await makeCatalogQuery(
			'get',
			[
				{
					tag: 'collections',
					attrs: {
						biz_jid: jid
					},
					content: [
						{
							tag: 'collection_limit',
							attrs: {},
							content: Buffer.from(limit.toString())
						},
						{
							tag: 'item_limit',
							attrs: {},
							content: Buffer.from(limit.toString())
						},
						...imageDimensionNodes()
					]
				}
			],
			query,
			{ smax_id: '35' }
		)

		return parseCollectionsNode(result)
	}

	const getOrderDetails = async (orderId: string, tokenBase64: string) => {
		const result = await query({
			tag: 'iq',
			attrs: {
				to: S_WHATSAPP_NET,
				type: 'get',
				xmlns: 'fb:thrift_iq',
				smax_id: '5'
			},
			content: [
				{
					tag: 'order',
					attrs: {
						op: 'get',
						id: orderId
					},
					content: [
						{
							tag: 'image_dimensions',
							attrs: {},
							content: imageDimensionNodes()
						},
						{
							tag: 'token',
							attrs: {},
							content: Buffer.from(tokenBase64)
						}
					]
				}
			]
		})

		return parseOrderDetailsNode(result)
	}

	const productUpdate = async (productId: string, update: ProductUpdate) => {
		update = await uploadingNecessaryImagesOfProduct(update, waUploadToServer)
		const editNode = toProductNode(productId, update)

		const result = await makeCatalogQuery(
			'set',
			[
				{
					tag: 'product_catalog_edit',
					attrs: { v: '1' },
					content: [editNode, ...imageDimensionNodes()]
				}
			],
			query
		)

		const productCatalogEditNode = getBinaryNodeChild(result, 'product_catalog_edit')
		const productNode = getBinaryNodeChild(productCatalogEditNode, 'product')

		return parseProductNode(productNode!)
	}

	const productCreate = async (create: ProductCreate) => {
		// ensure isHidden is defined
		create.isHidden = !!create.isHidden
		create = await uploadingNecessaryImagesOfProduct(create, waUploadToServer)
		const createNode = toProductNode(undefined, create)

		const result = await makeCatalogQuery(
			'set',
			[
				{
					tag: 'product_catalog_add',
					attrs: { v: '1' },
					content: [createNode, ...imageDimensionNodes()]
				}
			],
			query
		)

		const productCatalogAddNode = getBinaryNodeChild(result, 'product_catalog_add')
		const productNode = getBinaryNodeChild(productCatalogAddNode, 'product')

		return parseProductNode(productNode!)
	}

	const productDelete = async (productIds: string[]) => {
		const result = await makeCatalogQuery(
			'set',
			[
				{
					tag: 'product_catalog_delete',
					attrs: { v: '1' },
					content: productIds.map(id => ({
						tag: 'product',
						attrs: {},
						content: [
							{
								tag: 'id',
								attrs: {},
								content: Buffer.from(id)
							}
						]
					}))
				}
			],
			query
		)

		const productCatalogDelNode = getBinaryNodeChild(result, 'product_catalog_delete')
		return {
			deleted: +(productCatalogDelNode?.attrs.deleted_count || 0)
		}
	}

	return {
		...sock,
		logger: config.logger,
		getOrderDetails,
		getCatalog,
		getCollections,
		productCreate,
		productDelete,
		productUpdate,
		updateBussinesProfile,
		updateCoverPhoto,
		removeCoverPhoto
	}
}
