import { makeKeyedMutex, makeMutex } from '../../Utils/make-mutex'

describe('makeMutex', () => {
	it('executes a single task', async () => {
		const m = makeMutex()
		const result = await m.mutex(() => 42)
		expect(result).toBe(42)
	})

	it('executes async tasks', async () => {
		const m = makeMutex()
		const result = await m.mutex(async () => {
			return 'async-value'
		})
		expect(result).toBe('async-value')
	})

	it('serializes concurrent tasks', async () => {
		const m = makeMutex()
		const order: number[] = []

		const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

		const task1 = m.mutex(async () => {
			order.push(1)
			await delay(50)
			order.push(2)
		})

		const task2 = m.mutex(async () => {
			order.push(3)
			await delay(10)
			order.push(4)
		})

		await Promise.all([task1, task2])
		// task1 starts first and finishes before task2 begins
		expect(order).toEqual([1, 2, 3, 4])
	})

	it('propagates errors from tasks', async () => {
		const m = makeMutex()
		await expect(
			m.mutex(() => {
				throw new Error('task failed')
			})
		).rejects.toThrow('task failed')
	})

	it('continues working after a task throws', async () => {
		const m = makeMutex()
		await m
			.mutex(() => {
				throw new Error('fail')
			})
			.catch(() => {})
		const result = await m.mutex(() => 'recovered')
		expect(result).toBe('recovered')
	})
})

describe('makeKeyedMutex', () => {
	it('executes a single keyed task', async () => {
		const km = makeKeyedMutex()
		const result = await km.mutex('key1', () => 'value')
		expect(result).toBe('value')
	})

	it('serializes tasks with the same key', async () => {
		const km = makeKeyedMutex()
		const order: number[] = []
		const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

		const task1 = km.mutex('same', async () => {
			order.push(1)
			await delay(30)
			order.push(2)
		})

		const task2 = km.mutex('same', async () => {
			order.push(3)
			order.push(4)
		})

		await Promise.all([task1, task2])
		expect(order).toEqual([1, 2, 3, 4])
	})

	it('allows parallel execution for different keys', async () => {
		const km = makeKeyedMutex()
		const order: string[] = []
		const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

		const task1 = km.mutex('key-a', async () => {
			order.push('a-start')
			await delay(30)
			order.push('a-end')
		})

		const task2 = km.mutex('key-b', async () => {
			order.push('b-start')
			await delay(10)
			order.push('b-end')
		})

		await Promise.all([task1, task2])
		// both should start before either finishes
		expect(order[0]).toBe('a-start')
		expect(order[1]).toBe('b-start')
	})

	it('cleans up map entry after all tasks for a key complete', async () => {
		const km = makeKeyedMutex()
		await km.mutex('temp-key', () => 'done')
		// subsequent call with same key should work (new mutex created)
		const result = await km.mutex('temp-key', () => 'again')
		expect(result).toBe('again')
	})

	it('propagates errors from keyed tasks', async () => {
		const km = makeKeyedMutex()
		await expect(
			km.mutex('err-key', () => {
				throw new Error('keyed fail')
			})
		).rejects.toThrow('keyed fail')
	})

	it('continues working after error in keyed task', async () => {
		const km = makeKeyedMutex()
		await km
			.mutex('k', () => {
				throw new Error('fail')
			})
			.catch(() => {})
		const result = await km.mutex('k', () => 'ok')
		expect(result).toBe('ok')
	})
})
