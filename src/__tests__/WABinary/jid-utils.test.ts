import {
	areJidsSameUser,
	getServerFromDomainType,
	isHostedLidUser,
	isHostedPnUser,
	isJidBot,
	isJidBroadcast,
	isJidGroup,
	isJidMetaAI,
	isJidNewsletter,
	isJidStatusBroadcast,
	isLidUser,
	isPnUser,
	jidDecode,
	jidEncode,
	jidNormalizedUser,
	META_AI_JID,
	OFFICIAL_BIZ_JID,
	PSA_WID,
	S_WHATSAPP_NET,
	SERVER_JID,
	STORIES_JID,
	transferDevice,
	WAJIDDomains
} from '../../WABinary/jid-utils'

describe('jid-utils', () => {
	describe('constants', () => {
		it('S_WHATSAPP_NET is correct', () => {
			expect(S_WHATSAPP_NET).toBe('@s.whatsapp.net')
		})

		it('OFFICIAL_BIZ_JID is correct', () => {
			expect(OFFICIAL_BIZ_JID).toBe('16505361212@c.us')
		})

		it('SERVER_JID is correct', () => {
			expect(SERVER_JID).toBe('server@c.us')
		})

		it('PSA_WID is correct', () => {
			expect(PSA_WID).toBe('0@c.us')
		})

		it('STORIES_JID is correct', () => {
			expect(STORIES_JID).toBe('status@broadcast')
		})

		it('META_AI_JID is correct', () => {
			expect(META_AI_JID).toBe('13135550002@c.us')
		})
	})

	describe('getServerFromDomainType', () => {
		it('returns lid for LID domain', () => {
			expect(getServerFromDomainType('s.whatsapp.net', WAJIDDomains.LID)).toBe('lid')
		})

		it('returns hosted for HOSTED domain', () => {
			expect(getServerFromDomainType('s.whatsapp.net', WAJIDDomains.HOSTED)).toBe('hosted')
		})

		it('returns hosted.lid for HOSTED_LID domain', () => {
			expect(getServerFromDomainType('s.whatsapp.net', WAJIDDomains.HOSTED_LID)).toBe('hosted.lid')
		})

		it('returns initial server for WHATSAPP domain', () => {
			expect(getServerFromDomainType('c.us', WAJIDDomains.WHATSAPP)).toBe('c.us')
		})

		it('returns initial server for undefined domain', () => {
			expect(getServerFromDomainType('g.us', undefined)).toBe('g.us')
		})
	})

	describe('jidEncode', () => {
		it('encodes a simple user jid', () => {
			expect(jidEncode('1234567890', 's.whatsapp.net')).toBe('1234567890@s.whatsapp.net')
		})

		it('encodes a group jid', () => {
			expect(jidEncode('123456789', 'g.us')).toBe('123456789@g.us')
		})

		it('encodes with device number', () => {
			expect(jidEncode('1234567890', 's.whatsapp.net', 2)).toBe('1234567890:2@s.whatsapp.net')
		})

		it('encodes with agent number', () => {
			expect(jidEncode('1234567890', 's.whatsapp.net', undefined, 1)).toBe('1234567890_1@s.whatsapp.net')
		})

		it('encodes with both device and agent', () => {
			expect(jidEncode('1234567890', 's.whatsapp.net', 3, 1)).toBe('1234567890_1:3@s.whatsapp.net')
		})

		it('encodes with null user', () => {
			expect(jidEncode(null, 's.whatsapp.net')).toBe('@s.whatsapp.net')
		})

		it('encodes with zero device (treated as falsy, not included)', () => {
			expect(jidEncode('1234567890', 's.whatsapp.net', 0)).toBe('1234567890@s.whatsapp.net')
		})
	})

	describe('jidDecode', () => {
		it('decodes a simple user jid', () => {
			const result = jidDecode('1234567890@s.whatsapp.net')
			expect(result).toEqual({
				server: 's.whatsapp.net',
				user: '1234567890',
				domainType: WAJIDDomains.WHATSAPP,
				device: undefined
			})
		})

		it('decodes a jid with device', () => {
			const result = jidDecode('1234567890:2@s.whatsapp.net')
			expect(result).toEqual({
				server: 's.whatsapp.net',
				user: '1234567890',
				domainType: WAJIDDomains.WHATSAPP,
				device: 2
			})
		})

		it('decodes a LID jid', () => {
			const result = jidDecode('abcdef@lid')
			expect(result).toEqual({
				server: 'lid',
				user: 'abcdef',
				domainType: WAJIDDomains.LID,
				device: undefined
			})
		})

		it('decodes a hosted jid', () => {
			const result = jidDecode('user123@hosted')
			expect(result).toEqual({
				server: 'hosted',
				user: 'user123',
				domainType: WAJIDDomains.HOSTED,
				device: undefined
			})
		})

		it('decodes a hosted.lid jid', () => {
			const result = jidDecode('user123@hosted.lid')
			expect(result).toEqual({
				server: 'hosted.lid',
				user: 'user123',
				domainType: WAJIDDomains.HOSTED_LID,
				device: undefined
			})
		})

		it('decodes a jid with agent', () => {
			const result = jidDecode('1234567890_128@s.whatsapp.net')
			expect(result).toEqual({
				server: 's.whatsapp.net',
				user: '1234567890',
				domainType: 128,
				device: undefined
			})
		})

		it('returns undefined for invalid jid (no @ sign)', () => {
			expect(jidDecode('invalidjid')).toBeUndefined()
		})

		it('returns undefined for undefined input', () => {
			expect(jidDecode(undefined)).toBeUndefined()
		})

		it('decodes a group jid', () => {
			const result = jidDecode('123456789-987654321@g.us')
			expect(result).toEqual({
				server: 'g.us',
				user: '123456789-987654321',
				domainType: WAJIDDomains.WHATSAPP,
				device: undefined
			})
		})

		it('decodes a newsletter jid', () => {
			const result = jidDecode('abc123@newsletter')
			expect(result).toEqual({
				server: 'newsletter',
				user: 'abc123',
				domainType: WAJIDDomains.WHATSAPP,
				device: undefined
			})
		})
	})

	describe('areJidsSameUser', () => {
		it('returns true for same user with different devices', () => {
			expect(areJidsSameUser('1234@s.whatsapp.net', '1234:2@s.whatsapp.net')).toBe(true)
		})

		it('returns true for same user across c.us and s.whatsapp.net', () => {
			expect(areJidsSameUser('1234@c.us', '1234@s.whatsapp.net')).toBe(true)
		})

		it('returns false for different users', () => {
			expect(areJidsSameUser('1234@s.whatsapp.net', '5678@s.whatsapp.net')).toBe(false)
		})

		it('returns true for both undefined', () => {
			expect(areJidsSameUser(undefined, undefined)).toBe(true)
		})

		it('returns false when one is undefined', () => {
			expect(areJidsSameUser('1234@s.whatsapp.net', undefined)).toBe(false)
		})
	})

	describe('JID type checks', () => {
		it('isJidMetaAI detects bot jids', () => {
			expect(isJidMetaAI('13135550002@bot')).toBe(true)
			expect(isJidMetaAI('13135550002@c.us')).toBeFalsy()
			expect(isJidMetaAI(undefined)).toBeUndefined()
		})

		it('isPnUser detects s.whatsapp.net jids', () => {
			expect(isPnUser('1234@s.whatsapp.net')).toBe(true)
			expect(isPnUser('1234@g.us')).toBe(false)
			expect(isPnUser(undefined)).toBeUndefined()
		})

		it('isLidUser detects lid jids', () => {
			expect(isLidUser('abc@lid')).toBe(true)
			expect(isLidUser('abc@s.whatsapp.net')).toBe(false)
			expect(isLidUser(undefined)).toBeUndefined()
		})

		it('isJidBroadcast detects broadcast jids', () => {
			expect(isJidBroadcast('status@broadcast')).toBe(true)
			expect(isJidBroadcast('1234@s.whatsapp.net')).toBe(false)
			expect(isJidBroadcast(undefined)).toBeUndefined()
		})

		it('isJidGroup detects group jids', () => {
			expect(isJidGroup('123-456@g.us')).toBe(true)
			expect(isJidGroup('1234@s.whatsapp.net')).toBe(false)
			expect(isJidGroup(undefined)).toBeUndefined()
		})

		it('isJidStatusBroadcast detects status broadcast', () => {
			expect(isJidStatusBroadcast('status@broadcast')).toBe(true)
			expect(isJidStatusBroadcast('other@broadcast')).toBe(false)
		})

		it('isJidNewsletter detects newsletter jids', () => {
			expect(isJidNewsletter('abc@newsletter')).toBe(true)
			expect(isJidNewsletter('abc@g.us')).toBe(false)
			expect(isJidNewsletter(undefined)).toBeUndefined()
		})

		it('isHostedPnUser detects hosted jids', () => {
			expect(isHostedPnUser('user@hosted')).toBe(true)
			expect(isHostedPnUser('user@s.whatsapp.net')).toBe(false)
			expect(isHostedPnUser(undefined)).toBeUndefined()
		})

		it('isHostedLidUser detects hosted.lid jids', () => {
			expect(isHostedLidUser('user@hosted.lid')).toBe(true)
			expect(isHostedLidUser('user@lid')).toBe(false)
			expect(isHostedLidUser(undefined)).toBeUndefined()
		})
	})

	describe('isJidBot', () => {
		it('detects valid bot jids (1313555xxxx pattern)', () => {
			expect(isJidBot('13135550002@c.us')).toBeTruthy()
			expect(isJidBot('13135559999@c.us')).toBeTruthy()
		})

		it('detects valid bot jids (131655500xx pattern)', () => {
			expect(isJidBot('13165550001@c.us')).toBeTruthy()
			expect(isJidBot('13165550099@c.us')).toBeTruthy()
		})

		it('rejects non-bot jids', () => {
			expect(isJidBot('1234567890@c.us')).toBeFalsy()
			expect(isJidBot('13135550002@g.us')).toBeFalsy()
		})

		it('rejects undefined', () => {
			expect(isJidBot(undefined)).toBeFalsy()
		})
	})

	describe('jidNormalizedUser', () => {
		it('normalizes c.us to s.whatsapp.net', () => {
			expect(jidNormalizedUser('1234@c.us')).toBe('1234@s.whatsapp.net')
		})

		it('strips device from jid', () => {
			expect(jidNormalizedUser('1234:2@s.whatsapp.net')).toBe('1234@s.whatsapp.net')
		})

		it('preserves non-c.us servers', () => {
			expect(jidNormalizedUser('abc@g.us')).toBe('abc@g.us')
		})

		it('returns empty string for undefined', () => {
			expect(jidNormalizedUser(undefined)).toBe('')
		})

		it('returns empty string for invalid jid', () => {
			expect(jidNormalizedUser('nope')).toBe('')
		})
	})

	describe('transferDevice', () => {
		it('transfers device id from one jid to another', () => {
			const result = transferDevice('1234:3@s.whatsapp.net', '5678@s.whatsapp.net')
			expect(result).toBe('5678:3@s.whatsapp.net')
		})

		it('transfers device 0 when no device in source', () => {
			const result = transferDevice('1234@s.whatsapp.net', '5678@s.whatsapp.net')
			expect(result).toBe('5678@s.whatsapp.net')
		})
	})
})
