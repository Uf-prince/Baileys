import type { GroupMetadata, GroupParticipant } from '../Types'
import { WAMessageAddressingMode } from '../Types'
import {
	type BinaryNode,
	getBinaryNodeChild,
	getBinaryNodeChildren,
	getBinaryNodeChildString,
	isLidUser,
	isPnUser,
	jidEncode,
	jidNormalizedUser
} from '../WABinary'

/**
 * Build an IQ query node targeting the `w:g2` namespace.
 * Shared by both group and community operations.
 */
export const makeGroupIqQuery = (
	jid: string,
	type: 'get' | 'set',
	content: BinaryNode[],
	query: (node: BinaryNode) => Promise<BinaryNode>
) =>
	query({
		tag: 'iq',
		attrs: {
			type,
			xmlns: 'w:g2',
			to: jid
		},
		content
	})

/**
 * Map JID strings to `<participant jid="..." />` binary nodes.
 */
export const toParticipantNodes = (participants: string[]): BinaryNode[] =>
	participants.map(jid => ({
		tag: 'participant',
		attrs: { jid }
	}))

/**
 * Parse the result of a participant-mutating IQ (add/remove/promote/demote).
 * Returns an array of `{ status, jid, content }` per participant.
 */
export const parseParticipantResult = (result: BinaryNode, action: string) => {
	const node = getBinaryNodeChild(result, action)
	const participantsAffected = getBinaryNodeChildren(node, 'participant')
	return participantsAffected.map(p => ({
		status: p.attrs.error || '200',
		jid: p.attrs.jid,
		content: p
	}))
}

/**
 * Fetch the list of pending membership-approval requests for a group or community.
 */
export const fetchMembershipRequests = async (
	jid: string,
	entityQuery: (jid: string, type: 'get' | 'set', content: BinaryNode[]) => Promise<BinaryNode>
) => {
	const result = await entityQuery(jid, 'get', [
		{
			tag: 'membership_approval_requests',
			attrs: {}
		}
	])
	const node = getBinaryNodeChild(result, 'membership_approval_requests')
	const participants = getBinaryNodeChildren(node, 'membership_approval_request')
	return participants.map(v => v.attrs)
}

/**
 * Approve or reject pending membership-approval requests.
 */
export const updateMembershipRequests = async (
	jid: string,
	participants: string[],
	action: 'approve' | 'reject',
	entityQuery: (jid: string, type: 'get' | 'set', content: BinaryNode[]) => Promise<BinaryNode>
) => {
	const result = await entityQuery(jid, 'set', [
		{
			tag: 'membership_requests_action',
			attrs: {},
			content: [
				{
					tag: action,
					attrs: {},
					content: toParticipantNodes(participants)
				}
			]
		}
	])
	const node = getBinaryNodeChild(result, 'membership_requests_action')
	const nodeAction = getBinaryNodeChild(node, action)
	const participantsAffected = getBinaryNodeChildren(nodeAction, 'participant')
	return participantsAffected.map(p => ({
		status: p.attrs.error || '200',
		jid: p.attrs.jid
	}))
}

/**
 * Fetch an invite code from a group/community.
 */
export const fetchInviteCode = async (
	jid: string,
	entityQuery: (jid: string, type: 'get' | 'set', content: BinaryNode[]) => Promise<BinaryNode>
) => {
	const result = await entityQuery(jid, 'get', [{ tag: 'invite', attrs: {} }])
	const inviteNode = getBinaryNodeChild(result, 'invite')
	return inviteNode?.attrs.code
}

/**
 * Revoke and regenerate an invite code for a group/community.
 */
export const revokeInviteCode = async (
	jid: string,
	entityQuery: (jid: string, type: 'get' | 'set', content: BinaryNode[]) => Promise<BinaryNode>
) => {
	const result = await entityQuery(jid, 'set', [{ tag: 'invite', attrs: {} }])
	const inviteNode = getBinaryNodeChild(result, 'invite')
	return inviteNode?.attrs.code
}

/**
 * Accept an invite code and return the entity JID.
 * @param entityTag - `'group'` or `'community'` — the child tag in the response.
 */
export const acceptInviteCode = async (
	code: string,
	entityTag: 'group' | 'community',
	entityQuery: (jid: string, type: 'get' | 'set', content: BinaryNode[]) => Promise<BinaryNode>
) => {
	const results = await entityQuery('@g.us', 'set', [{ tag: 'invite', attrs: { code } }])
	const result = getBinaryNodeChild(results, entityTag)
	return result?.attrs.jid
}

/**
 * Fetch all groups/communities the user is participating in.
 */
export const fetchAllParticipating = async (
	entityChildTag: 'groups' | 'communities',
	entityNodeTag: 'group' | 'community',
	extractMetadata: (result: BinaryNode) => GroupMetadata,
	query: (node: BinaryNode) => Promise<BinaryNode>
) => {
	const result = await query({
		tag: 'iq',
		attrs: {
			to: '@g.us',
			xmlns: 'w:g2',
			type: 'get'
		},
		content: [
			{
				tag: 'participating',
				attrs: {},
				content: [
					{ tag: 'participants', attrs: {} },
					{ tag: 'description', attrs: {} }
				]
			}
		]
	})
	const data: { [_: string]: GroupMetadata } = {}
	const containerChild = getBinaryNodeChild(result, entityChildTag)
	if (containerChild) {
		const entities = getBinaryNodeChildren(containerChild, entityNodeTag)
		for (const entityNode of entities) {
			const meta = extractMetadata({
				tag: 'result',
				attrs: {},
				content: [entityNode]
			})
			data[meta.id] = meta
		}
	}

	return data
}

interface ExtractMetadataOptions {
	/**
	 * The tag name to look up in the result node: `'group'` or `'community'`.
	 */
	entityTag: 'group' | 'community'
	/**
	 * Whether to extract extended owner/description metadata
	 * (phone-number, username fields). Groups have these, communities do not.
	 */
	extended: boolean
}

/**
 * Shared core of `extractGroupMetadata` and `extractCommunityMetadata`.
 * Parses the common fields from a `<group>` or `<community>` binary node.
 */
export const extractEntityMetadata = (result: BinaryNode, opts: ExtractMetadataOptions): GroupMetadata => {
	const { entityTag, extended } = opts
	const entity = getBinaryNodeChild(result, entityTag)!

	const descChild = getBinaryNodeChild(entity, 'description')
	let desc: string | undefined
	let descId: string | undefined
	let descOwner: string | undefined
	let descOwnerPn: string | undefined
	let descOwnerUsername: string | undefined
	let descTime: number | undefined
	if (descChild) {
		desc = getBinaryNodeChildString(descChild, 'body')
		descId = descChild.attrs.id
		if (extended) {
			descOwner = descChild.attrs.participant ? jidNormalizedUser(descChild.attrs.participant) : undefined
			descOwnerPn = descChild.attrs.participant_pn ? jidNormalizedUser(descChild.attrs.participant_pn) : undefined
			descOwnerUsername = descChild.attrs.participant_username || undefined
			descTime = +descChild.attrs.t!
		}
	}

	const entityId = entity.attrs.id?.includes('@') ? entity.attrs.id : jidEncode(entity.attrs.id || '', 'g.us')
	const eph = getBinaryNodeChild(entity, 'ephemeral')?.attrs.expiration
	const memberAddMode = getBinaryNodeChildString(entity, 'member_add_mode') === 'all_member_add'

	const metadata: GroupMetadata = {
		id: entityId,
		subject: entity.attrs.subject || '',
		subjectOwner: entity.attrs.s_o,
		subjectTime: Number(entity.attrs.s_t || 0),
		size: entity.attrs.size ? +entity.attrs.size : getBinaryNodeChildren(entity, 'participant').length,
		creation: Number(entity.attrs.creation || 0),
		owner: entity.attrs.creator ? jidNormalizedUser(entity.attrs.creator) : undefined,
		desc,
		descId,
		linkedParent: getBinaryNodeChild(entity, 'linked_parent')?.attrs.jid || undefined,
		restrict: !!getBinaryNodeChild(entity, 'locked'),
		announce: !!getBinaryNodeChild(entity, 'announcement'),
		isCommunity: !!getBinaryNodeChild(entity, 'parent'),
		isCommunityAnnounce: !!getBinaryNodeChild(
			entity,
			entityTag === 'group' ? 'default_sub_group' : 'default_sub_community'
		),
		joinApprovalMode: !!getBinaryNodeChild(entity, 'membership_approval_mode'),
		memberAddMode,
		participants: getBinaryNodeChildren(entity, 'participant').map(({ attrs }) => {
			if (extended) {
				return {
					id: attrs.jid!,
					phoneNumber: isLidUser(attrs.jid) && isPnUser(attrs.phone_number) ? attrs.phone_number : undefined,
					lid: isPnUser(attrs.jid) && isLidUser(attrs.lid) ? attrs.lid : undefined,
					username: attrs.participant_username || attrs.username || undefined,
					admin: (attrs.type || null) as GroupParticipant['admin']
				}
			}

			return {
				id: attrs.jid!,
				admin: (attrs.type || null) as GroupParticipant['admin']
			}
		}),
		ephemeralDuration: eph ? +eph : undefined
	}

	if (extended) {
		metadata.notify = entity.attrs.notify
		metadata.addressingMode =
			entity.attrs.addressing_mode === 'lid' ? WAMessageAddressingMode.LID : WAMessageAddressingMode.PN
		metadata.subjectOwnerPn = entity.attrs.s_o_pn
		metadata.subjectOwnerUsername = entity.attrs.s_o_username
		metadata.ownerPn = entity.attrs.creator_pn ? jidNormalizedUser(entity.attrs.creator_pn) : undefined
		metadata.ownerUsername = entity.attrs.creator_username || undefined
		metadata.owner_country_code = entity.attrs.creator_country_code
		metadata.descOwner = descOwner
		metadata.descOwnerPn = descOwnerPn
		metadata.descOwnerUsername = descOwnerUsername
		metadata.descTime = descTime
	} else {
		metadata.addressingMode = getBinaryNodeChildString(entity, 'addressing_mode')! as GroupMetadata['addressingMode']
	}

	return metadata
}
