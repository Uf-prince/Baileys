import { Boom } from '@hapi/boom'
import { proto } from '../../WAProto/index.js'
import type { ParticipantAction, SocketConfig, WAMessageKey } from '../Types'
import { WAMessageStubType } from '../Types'
import { generateMessageIDV2, unixTimestampSeconds } from '../Utils'
import { type BinaryNode, getBinaryNodeChild, isLidUser } from '../WABinary'
import { makeChatsSocket } from './chats'
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

export const makeGroupsSocket = (config: SocketConfig) => {
	const sock = makeChatsSocket(config)
	const { authState, ev, query, upsertMessage } = sock

	const groupQuery = async (jid: string, type: 'get' | 'set', content: BinaryNode[]) =>
		makeGroupIqQuery(jid, type, content, query)

	// Helper: LID ko PN mein convert karo
	const resolveParticipantJid = (jid: string): string => {
		if (!jid || !isLidUser(jid)) return jid
		const parts = jid.split('@')
		const lidNum = parts[0]
		if (!lidNum) return jid
		const mapping = (authState.creds as any).lidMapping as Record<string, string> | undefined
		if (mapping) {
			if (mapping[lidNum]) return `${mapping[lidNum]}@s.whatsapp.net`
			for (const [pn, lid] of Object.entries(mapping)) {
				if (lid === lidNum || lid === jid) return `${pn}@s.whatsapp.net`
			}
		}

		return jid
	}

	const groupMetadata = async (jid: string) => {
		const result = await groupQuery(jid, 'get', [{ tag: 'query', attrs: { request: 'interactive' } }])
		return extractGroupMetadata(result)
	}

	const groupFetchAllParticipating = async () => {
		const data = await fetchAllParticipating('groups', 'group', extractGroupMetadata, query)

		sock.ev.emit('groups.update', Object.values(data))

		return data
	}

	sock.ws.on('CB:ib,,dirty', async (node: BinaryNode) => {
		const { attrs } = getBinaryNodeChild(node, 'dirty')!
		if (attrs.type !== 'groups') {
			return
		}

		await groupFetchAllParticipating()
		await sock.cleanDirtyBits('groups')
	})

	return {
		...sock,
		groupMetadata,
		groupCreate: async (subject: string, participants: string[]) => {
			const key = generateMessageIDV2()
			const result = await groupQuery('@g.us', 'set', [
				{
					tag: 'create',
					attrs: {
						subject,
						key
					},
					content: toParticipantNodes(participants.map(resolveParticipantJid))
				}
			])
			return extractGroupMetadata(result)
		},
		groupLeave: async (id: string) => {
			await groupQuery('@g.us', 'set', [
				{
					tag: 'leave',
					attrs: {},
					content: [{ tag: 'group', attrs: { id } }]
				}
			])
		},
		groupUpdateSubject: async (jid: string, subject: string) => {
			await groupQuery(jid, 'set', [
				{
					tag: 'subject',
					attrs: {},
					content: Buffer.from(subject, 'utf-8')
				}
			])
		},
		groupRequestParticipantsList: async (jid: string) => {
			return fetchMembershipRequests(jid, groupQuery)
		},
		groupRequestParticipantsUpdate: async (jid: string, participants: string[], action: 'approve' | 'reject') => {
			return updateMembershipRequests(jid, participants.map(resolveParticipantJid), action, groupQuery)
		},
		groupParticipantsUpdate: async (jid: string, participants: string[], action: ParticipantAction) => {
			// LID → PN conversion — v7 fix
			const resolvedParticipants = participants.map(p => resolveParticipantJid(p))

			let result: BinaryNode
			try {
				result = await groupQuery(jid, 'set', [
					{
						tag: action,
						attrs: {},
						content: toParticipantNodes(resolvedParticipants)
					}
				])
			} catch (err: any) {
				// Retry with original JIDs if resolved failed
				result = await groupQuery(jid, 'set', [
					{
						tag: action,
						attrs: {},
						content: toParticipantNodes(participants)
					}
				])
			}

			return parseParticipantResult(result, action)
		},
		groupUpdateDescription: async (jid: string, description?: string) => {
			const metadata = await groupMetadata(jid)
			const prev = metadata.descId ?? null

			await groupQuery(jid, 'set', [
				{
					tag: 'description',
					attrs: {
						...(description ? { id: generateMessageIDV2() } : { delete: 'true' }),
						...(prev ? { prev } : {})
					},
					content: description ? [{ tag: 'body', attrs: {}, content: Buffer.from(description, 'utf-8') }] : undefined
				}
			])
		},
		groupInviteCode: async (jid: string) => {
			return fetchInviteCode(jid, groupQuery)
		},
		groupRevokeInvite: async (jid: string) => {
			return revokeInviteCode(jid, groupQuery)
		},
		groupAcceptInvite: async (code: string) => {
			return acceptInviteCode(code, 'group', groupQuery)
		},

		groupRevokeInviteV4: async (groupJid: string, invitedJid: string) => {
			const result = await groupQuery(groupJid, 'set', [
				{
					tag: 'revoke',
					attrs: {},
					content: toParticipantNodes([resolveParticipantJid(invitedJid)])
				}
			])
			return !!result
		},

		groupAcceptInviteV4: ev.createBufferedFunction(
			async (key: string | WAMessageKey, inviteMessage: proto.Message.IGroupInviteMessage) => {
				key = typeof key === 'string' ? { remoteJid: key } : key
				const results = await groupQuery(inviteMessage.groupJid!, 'set', [
					{
						tag: 'accept',
						attrs: {
							code: inviteMessage.inviteCode!,
							expiration: inviteMessage.inviteExpiration!.toString(),
							admin: key.remoteJid!
						}
					}
				])

				if (key.id) {
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

				await upsertMessage(
					{
						key: {
							remoteJid: inviteMessage.groupJid,
							id: generateMessageIDV2(sock.user?.id),
							fromMe: false,
							participant: key.remoteJid
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
		groupGetInviteInfo: async (code: string) => {
			const results = await groupQuery('@g.us', 'get', [{ tag: 'invite', attrs: { code } }])
			return extractGroupMetadata(results)
		},
		groupToggleEphemeral: async (jid: string, ephemeralExpiration: number) => {
			const content: BinaryNode = ephemeralExpiration
				? { tag: 'ephemeral', attrs: { expiration: ephemeralExpiration.toString() } }
				: { tag: 'not_ephemeral', attrs: {} }
			await groupQuery(jid, 'set', [content])
		},
		groupSettingUpdate: async (jid: string, setting: 'announcement' | 'not_announcement' | 'locked' | 'unlocked') => {
			// Try primary method
			try {
				await groupQuery(jid, 'set', [{ tag: setting, attrs: {} }])
			} catch (err1: any) {
				// Retry with explicit id attr
				try {
					await query({
						tag: 'iq',
						attrs: {
							id: generateMessageIDV2(),
							type: 'set',
							xmlns: 'w:g2',
							to: jid
						},
						content: [{ tag: setting, attrs: {} }]
					})
				} catch (err2: any) {
					throw new Boom(err2?.message || 'groupSettingUpdate failed', { statusCode: 500 })
				}
			}
		},
		groupMemberAddMode: async (jid: string, mode: 'admin_add' | 'all_member_add') => {
			await groupQuery(jid, 'set', [{ tag: 'member_add_mode', attrs: {}, content: mode }])
		},
		groupJoinApprovalMode: async (jid: string, mode: 'on' | 'off') => {
			await groupQuery(jid, 'set', [
				{ tag: 'membership_approval_mode', attrs: {}, content: [{ tag: 'group_join', attrs: { state: mode } }] }
			])
		},
		groupFetchAllParticipating
	}
}

export const extractGroupMetadata = (result: BinaryNode) => {
	const group = getBinaryNodeChild(result, 'group')
	if (!group) {
		const errorNode = getBinaryNodeChild(result, 'error')
		if (errorNode) {
			const code = errorNode.attrs.code ? +errorNode.attrs.code : 500
			const text = errorNode.attrs.text || 'group metadata query failed'
			throw new Boom(text, { statusCode: code, data: errorNode })
		}

		throw new Boom('Invalid group metadata response: missing <group> node', { data: result })
	}

	if (!group.attrs.id) {
		throw new Boom('Invalid group metadata response: missing group id', { data: group })
	}

	return extractEntityMetadata(result, { entityTag: 'group', extended: true })
}

export type GroupsSocket = ReturnType<typeof makeGroupsSocket>
