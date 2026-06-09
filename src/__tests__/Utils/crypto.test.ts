import { randomBytes } from 'crypto'
import { KEY_BUNDLE_TYPE } from '../../Defaults'
import {
	aesDecrypt,
	aesDecryptCTR,
	aesDecryptGCM,
	aesDecryptWithIV,
	aesEncrypt,
	aesEncryptCTR,
	aesEncryptGCM,
	aesEncrypWithIV,
	derivePairingCodeKey,
	generateSignalPubKey,
	hmacSign,
	sha256
} from '../../Utils/crypto'

describe('crypto utilities', () => {
	describe('generateSignalPubKey', () => {
		it('prefixes version byte to 32-byte key', () => {
			const pubKey = randomBytes(32)
			const result = generateSignalPubKey(pubKey)
			expect(result.length).toBe(33)
			expect(result[0]).toBe(KEY_BUNDLE_TYPE[0])
			expect(Buffer.from(result.slice(1))).toEqual(pubKey)
		})

		it('returns 33-byte key unchanged', () => {
			const pubKey = Buffer.concat([KEY_BUNDLE_TYPE, randomBytes(32)])
			const result = generateSignalPubKey(pubKey)
			expect(result).toBe(pubKey)
		})
	})

	describe('AES-256-GCM', () => {
		it('encrypts and decrypts back to plaintext', () => {
			const key = randomBytes(32)
			const iv = randomBytes(12)
			const aad = randomBytes(16)
			const plaintext = Buffer.from('hello world gcm')

			const ciphertext = aesEncryptGCM(plaintext, key, iv, aad)
			// ciphertext should be longer than plaintext (includes auth tag)
			expect(ciphertext.length).toBe(plaintext.length + 16)

			const decrypted = aesDecryptGCM(ciphertext, key, iv, aad)
			expect(decrypted).toEqual(plaintext)
		})

		it('fails to decrypt with wrong key', () => {
			const key = randomBytes(32)
			const wrongKey = randomBytes(32)
			const iv = randomBytes(12)
			const aad = randomBytes(16)
			const plaintext = Buffer.from('secret data')

			const ciphertext = aesEncryptGCM(plaintext, key, iv, aad)
			expect(() => aesDecryptGCM(ciphertext, wrongKey, iv, aad)).toThrow()
		})

		it('fails to decrypt with wrong AAD', () => {
			const key = randomBytes(32)
			const iv = randomBytes(12)
			const aad = randomBytes(16)
			const wrongAad = randomBytes(16)
			const plaintext = Buffer.from('secret data')

			const ciphertext = aesEncryptGCM(plaintext, key, iv, aad)
			expect(() => aesDecryptGCM(ciphertext, key, iv, wrongAad)).toThrow()
		})
	})

	describe('AES-256-CTR', () => {
		it('encrypts and decrypts back to plaintext', () => {
			const key = randomBytes(32)
			const iv = randomBytes(16)
			const plaintext = Buffer.from('hello world ctr')

			const ciphertext = aesEncryptCTR(plaintext, key, iv)
			expect(ciphertext.length).toBe(plaintext.length)

			const decrypted = aesDecryptCTR(ciphertext, key, iv)
			expect(decrypted).toEqual(plaintext)
		})

		it('produces different ciphertext with different keys', () => {
			const key1 = randomBytes(32)
			const key2 = randomBytes(32)
			const iv = randomBytes(16)
			const plaintext = Buffer.from('test data')

			const ct1 = aesEncryptCTR(plaintext, key1, iv)
			const ct2 = aesEncryptCTR(plaintext, key2, iv)
			expect(ct1).not.toEqual(ct2)
		})
	})

	describe('AES-256-CBC', () => {
		it('aesEncrypt/aesDecrypt roundtrip (IV prefixed)', () => {
			const key = randomBytes(32)
			const plaintext = Buffer.from('hello world cbc mode')

			const encrypted = aesEncrypt(plaintext, key)
			// first 16 bytes should be the random IV
			expect(encrypted.length).toBeGreaterThan(plaintext.length + 16)

			const decrypted = aesDecrypt(encrypted, key)
			expect(decrypted).toEqual(plaintext)
		})

		it('aesEncrypWithIV/aesDecryptWithIV roundtrip', () => {
			const key = randomBytes(32)
			const iv = randomBytes(16)
			const plaintext = Buffer.from('test with explicit iv')

			const encrypted = aesEncrypWithIV(Buffer.from(plaintext), Buffer.from(key), Buffer.from(iv))
			const decrypted = aesDecryptWithIV(encrypted, key, iv)
			expect(decrypted).toEqual(plaintext)
		})
	})

	describe('hmacSign', () => {
		it('produces a 32-byte HMAC with sha256 (default)', () => {
			const key = randomBytes(32)
			const data = Buffer.from('sign this')

			const mac = hmacSign(data, key)
			expect(mac.length).toBe(32)
		})

		it('produces a 64-byte HMAC with sha512', () => {
			const key = randomBytes(32)
			const data = Buffer.from('sign this')

			const mac = hmacSign(data, key, 'sha512')
			expect(mac.length).toBe(64)
		})

		it('produces consistent output for same input', () => {
			const key = Buffer.from('fixed-key-for-testing-1234567890ab')
			const data = Buffer.from('deterministic test')

			const mac1 = hmacSign(data, key)
			const mac2 = hmacSign(data, key)
			expect(mac1).toEqual(mac2)
		})

		it('produces different output for different data', () => {
			const key = randomBytes(32)
			const mac1 = hmacSign(Buffer.from('data1'), key)
			const mac2 = hmacSign(Buffer.from('data2'), key)
			expect(mac1).not.toEqual(mac2)
		})
	})

	describe('sha256', () => {
		it('produces correct hash for known input', () => {
			const hash = sha256(Buffer.from(''))
			// SHA-256 of empty string
			expect(hash.toString('hex')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
		})

		it('produces 32-byte output', () => {
			const hash = sha256(Buffer.from('some data'))
			expect(hash.length).toBe(32)
		})
	})

	describe('derivePairingCodeKey', () => {
		it('produces a 32-byte derived key', async () => {
			const pairingCode = 'ABCD1234'
			const salt = randomBytes(32)

			const key = await derivePairingCodeKey(pairingCode, salt)
			expect(key.length).toBe(32)
		})

		it('produces deterministic output for same inputs', async () => {
			const pairingCode = 'TESTCODE'
			const salt = Buffer.from('0123456789abcdef0123456789abcdef')

			const key1 = await derivePairingCodeKey(pairingCode, salt)
			const key2 = await derivePairingCodeKey(pairingCode, salt)
			expect(key1).toEqual(key2)
		})

		it('produces different output for different pairing codes', async () => {
			const salt = Buffer.from('0123456789abcdef0123456789abcdef')

			const key1 = await derivePairingCodeKey('CODE1111', salt)
			const key2 = await derivePairingCodeKey('CODE2222', salt)
			expect(key1).not.toEqual(key2)
		})
	})
})
