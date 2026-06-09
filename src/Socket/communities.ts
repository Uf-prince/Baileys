import { proto } from '../../WAProto/index.js'
import type { ParticipantAction, SocketConfig, WAMessageKey } from '../Types'
import { WAMessageStubType } from '../Types'
import { generateMessageID, generateMessageIDV2, unixTimestampSeconds } from '../Utils'
import logger from '../Utils/logger'
import { type BinaryNode, getBinaryNodeChild, getBinaryNodeChildren, jidEncode, jidNormalizedUser } from '../WABinary'
import { makeBusinessSocket } from './business'
import {
	acceptInviteCode,
	extractEntityMetadata,
	fetchAllParticipating,
	fetchInviteCode,
	fetchMembershipRequests,
	makeGroupIqQuery,
	parseParticipantResult,
	revokeInviteCode,
	toParticipantNodes,
	updateMembershipRequests
} from './group-utils'

export const makeCommunitiesSocket = (config: SocketConfig) => {
	const sock = makeBusinessSocket(config)
	const { authState, ev, query, upsertMessage } = sock

	const communityQuery = async (jid: string, type: 'get' | 'set', content: BinaryNode[]) =>
		makeGroupIqQuery(jid, type, content, query)

	const communityMetadata = async (jid: string) => {
		const result = await communityQuery(jid, 'get', [{ tag: 'query', attrs: { request: 'interactive' } }])
		return extractCommunityMetadata(result)
	}

	const communityFetchAllParticipating = async () => {
		const data = await fetchAllParticipating('communities', 'community', extractCommunityMetadata, query)

		sock.ev.emit('groups.update', Object.values(data))

		return data
	}

	async function parseGroupResult(node: BinaryNode) {
		logger.info({ node }, 'parseGroupResult')
		const groupNode = getBinaryNodeChild(node, 'group')
		if (groupNode) {
			try {
				logger.info({ groupNode }, 'groupNode')
				const metadata = await sock.groupMetadata(`${groupNode.attrs.id}@g.us`)
				return metadata ? metadata : Optional.empty()
			} catch (error) {
				console.error('Error parsing group metadata:', error)
				return Optional.empty()
			}
		}

		return Optional.empty()
	}

	const Optional = {
		empty: () => null,
		of: (value: null) => (value !== null ? { value } : null)
	}

	sock.ws.on('CB:ib,,dirty', async (node: BinaryNode) => {
		const { attrs } = getBinaryNodeChild(node, 'dirty')!
		if (attrs.type !== 'communities') {
			return
		}

		await communityFetchAllParticipating()
		await sock.cleanDirtyBits('groups')
	})

	return {
		...sock,
		communityMetadata,
		communityCreate: async (subject: string, body: string) => {
			const descriptionId = generateMessageID().substring(0, 12)

			const result = await communityQuery('@g.us', 'set', [
				{
					tag: 'create',
					attrs: { subject },
					content: [
						{
							tag: 'description',
							attrs: { id: descriptionId },
							content: [
								{
									tag: 'body',
									attrs: {},
									content: Buffer.from(body || '', 'utf-8')
								}
							]
						},
						{
							tag: 'parent',
							attrs: { default_membership_approval_mode: 'request_required' }
						},
						{
							tag: 'allow_non_admin_sub_group_creation',
							attrs: {}
						},
						{
							tag: 'create_general_chat',
							attrs: {}
						}
					]
				}
			])

			return await parseGroupResult(result)
		},
		communityCreateGroup: async (subject: string, participants: string[], parentCommunityJid: string) => {
			const key = generateMessageIDV2()
			const result = await communityQuery('@g.us', 'set', [
				{
					tag: 'create',
					attrs: {
						subject,
						key
					},
					content: [...toParticipantNodes(participants), { tag: 'linked_parent', attrs: { jid: parentCommunityJid } }]
				}
			])
			return await parseGroupResult(result)
		},
		communityLeave: async (id: string) => {
			await communityQuery('@g.us', 'set', [
				{
					tag: 'leave',
					attrs: {},
					content: [{ tag: 'community', attrs: { id } }]
				}
			])
		},
		communityUpdateSubject: async (jid: string, subject: string) => {
			await communityQuery(jid, 'set', [
				{
					tag: 'subject',
					attrs: {},
					content: Buffer.from(subject, 'utf-8')
				}
			])
		},
		communityLinkGroup: async (groupJid: string, parentCommunityJid: string) => {
			await communityQuery(parentCommunityJid, 'set', [
				{
					tag: 'links',
					attrs: {},
					content: [
						{
							tag: 'link',
							attrs: { link_type: 'sub_group' },
							content: [{ tag: 'group', attrs: { jid: groupJid } }]
						}
					]
				}
			])
		},
		communityUnlinkGroup: async (groupJid: string, parentCommunityJid: string) => {
			await communityQuery(parentCommunityJid, 'set', [
				{
					tag: 'unlink',
					attrs: { unlink_type: 'sub_group' },
					content: [{ tag: 'group', attrs: { jid: groupJid } }]
				}
			])
		},
		communityFetchLinkedGroups: async (jid: string) => {
			let communityJid = jid
			let isCommunity = false

			// Try to determine if it is a subgroup or a community
			const metadata = await sock.groupMetadata(jid)
			if (metadata.linkedParent) {
				// It is a subgroup, get the community jid
				communityJid = metadata.linkedParent
			} else {
				// It is a community
				isCommunity = true
			}

			// Fetch all subgroups of the community
			const result = await communityQuery(communityJid, 'get', [{ tag: 'sub_groups', attrs: {} }])

			const linkedGroupsData = []
			const subGroupsNode = getBinaryNodeChild(result, 'sub_groups')
			if (subGroupsNode) {
				const groupNodes = getBinaryNodeChildren(subGroupsNode, 'group')
				for (const groupNode of groupNodes) {
					linkedGroupsData.push({
						id: groupNode.attrs.id ? jidEncode(groupNode.attrs.id, 'g.us') : undefined,
						subject: groupNode.attrs.subject || '',
						creation: groupNode.attrs.creation ? Number(groupNode.attrs.creation) : undefined,
						owner: groupNode.attrs.creator ? jidNormalizedUser(groupNode.attrs.creator) : undefined,
						size: groupNode.attrs.size ? Number(groupNode.attrs.size) : undefined
					})
				}
			}

			return {
				communityJid,
				isCommunity,
				linkedGroups: linkedGroupsData
			}
		},
		communityRequestParticipantsList: async (jid: string) => {
			return fetchMembershipRequests(jid, communityQuery)
		},
		communityRequestParticipantsUpdate: async (jid: string, participants: string[], action: 'approve' | 'reject') => {
			return updateMembershipRequests(jid, participants, action, communityQuery)
		},
		communityParticipantsUpdate: async (jid: string, participants: string[], action: ParticipantAction) => {
			const result = await communityQuery(jid, 'set', [
				{
					tag: action,
					attrs: action === 'remove' ? { linked_groups: 'true' } : {},
					content: toParticipantNodes(participants)
				}
			])
			return parseParticipantResult(result, action)
		},
		communityUpdateDescription: async (jid: string, description?: string) => {
			const metadata = await communityMetadata(jid)
			const prev = metadata.descId ?? null

			await communityQuery(jid, 'set', [
				{
					tag: 'description',
					attrs: {
						...(description ? { id: generateMessageID() } : { delete: 'true' }),
						...(prev ? { prev } : {})
					},
					content: description ? [{ tag: 'body', attrs: {}, content: Buffer.from(description, 'utf-8') }] : undefined
				}
			])
		},
		communityInviteCode: async (jid: string) => {
			return fetchInviteCode(jid, communityQuery)
		},
		communityRevokeInvite: async (jid: string) => {
			return revokeInviteCode(jid, communityQuery)
		},
		communityAcceptInvite: async (code: string) => {
			return acceptInviteCode(code, 'community', communityQuery)
		},

		/**
		 * revoke a v4 invite for someone
		 * @param communityJid community jid
		 * @param invitedJid jid of person you invited
		 * @returns true if successful
		 */
		communityRevokeInviteV4: async (communityJid: string, invitedJid: string) => {
			const result = await communityQuery(communityJid, 'set', [
				{
					tag: 'revoke',
					attrs: {},
					content: toParticipantNodes([invitedJid])
				}
			])
			return !!result
		},

		/**
		 * accept a CommunityInviteMessage
		 * @param key the key of the invite message, or optionally only provide the jid of the person who sent the invite
		 * @param inviteMessage the message to accept
		 */
		communityAcceptInviteV4: ev.createBufferedFunction(
			async (key: string | WAMessageKey, inviteMessage: proto.Message.IGroupInviteMessage) => {
				key = typeof key === 'string' ? { remoteJid: key } : key
				const results = await communityQuery(inviteMessage.groupJid!, 'set', [
					{
						tag: 'accept',
						attrs: {
							code: inviteMessage.inviteCode!,
							expiration: inviteMessage.inviteExpiration!.toString(),
							admin: key.remoteJid!
						}
					}
				])

				// if we have the full message key
				// update the invite message to be expired
				if (key.id) {
					// create new invite message that is expired
					inviteMessage = proto.Message.GroupInviteMessage.fromObject(inviteMessage)
					inviteMessage.inviteExpiration = 0
					inviteMessage.inviteCode = ''
					ev.emit('messages.update', [
						{
							key,
							update: {
								message: {
									groupInviteMessage: inviteMessage
								}
							}
						}
					])
				}

				// generate the community add message
				await upsertMessage(
					{
						key: {
							remoteJid: inviteMessage.groupJid,
							id: generateMessageIDV2(sock.user?.id),
							fromMe: false,
							participant: key.remoteJid // TODO: investigate if this makes any sense at all
						},
						messageStubType: WAMessageStubType.GROUP_PARTICIPANT_ADD,
						messageStubParameters: [JSON.stringify(authState.creds.me)],
						participant: key.remoteJid,
						messageTimestamp: unixTimestampSeconds()
					},
					'notify'
				)

				return results.attrs.from
			}
		),
		communityGetInviteInfo: async (code: string) => {
			const results = await communityQuery('@g.us', 'get', [{ tag: 'invite', attrs: { code } }])
			return extractCommunityMetadata(results)
		},
		communityToggleEphemeral: async (jid: string, ephemeralExpiration: number) => {
			const content: BinaryNode = ephemeralExpiration
				? { tag: 'ephemeral', attrs: { expiration: ephemeralExpiration.toString() } }
				: { tag: 'not_ephemeral', attrs: {} }
			await communityQuery(jid, 'set', [content])
		},
		communitySettingUpdate: async (
			jid: string,
			setting: 'announcement' | 'not_announcement' | 'locked' | 'unlocked'
		) => {
			await communityQuery(jid, 'set', [{ tag: setting, attrs: {} }])
		},
		communityMemberAddMode: async (jid: string, mode: 'admin_add' | 'all_member_add') => {
			await communityQuery(jid, 'set', [{ tag: 'member_add_mode', attrs: {}, content: mode }])
		},
		communityJoinApprovalMode: async (jid: string, mode: 'on' | 'off') => {
			await communityQuery(jid, 'set', [
				{ tag: 'membership_approval_mode', attrs: {}, content: [{ tag: 'community_join', attrs: { state: mode } }] }
			])
		},
		communityFetchAllParticipating
	}
}

export const extractCommunityMetadata = (result: BinaryNode) => {
	return extractEntityMetadata(result, { entityTag: 'community', extended: false })
}
