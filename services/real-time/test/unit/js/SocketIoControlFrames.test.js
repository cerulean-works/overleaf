import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { Receiver } from 'ws'

const require = createRequire(import.meta.url)

// Exercise the dependency's actual parser and transport together. A strict
// modern receiver also checks the bytes a real browser/proxy receives.
function transportFor(version) {
  const Transport = require(`socket.io/lib/transports/websocket/${version}`)
  const frames = []
  const messages = []
  const errors = []
  const manager = {
    get: () => 1024 * 1024,
    log: { debug: () => {}, warn: error => errors.push(error) },
  }
  // POST avoids binding network handlers/timers in the base constructor.
  const transport = new Transport(manager, { id: 'test' }, { method: 'POST' })
  transport.socket = { write: frame => frames.push(Buffer.from(frame)) }
  transport.onMessage = () => {}
  transport.end = () => errors.push('transport ended')
  transport.parser.on('data', message => messages.push(message))
  return { transport, frames, messages, errors }
}

function clientFrame(opcode, payload = Buffer.alloc(0), final = true) {
  const mask = Buffer.from([0x61, 0x62, 0x63, 0x64])
  const length = payload.length
  const header =
    length < 126
      ? Buffer.from([(final ? 0x80 : 0) | opcode, 0x80 | length])
      : Buffer.from([(final ? 0x80 : 0) | opcode, 0xfe, 0, length])
  const masked = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]))
  return Buffer.concat([header, mask, masked])
}

async function decodePong(frame) {
  return await new Promise((resolve, reject) => {
    const receiver = new Receiver({ isServer: false })
    receiver.once('error', reject)
    receiver.once('pong', resolve)
    receiver.write(frame)
  })
}

describe.each(['hybi-07-12', 'hybi-16'])(
  'Socket.IO %s control frames',
  version => {
    it('answers a binary ping with an RFC-valid pong and identical payload', async () => {
      const { transport, frames, errors } = transportFor(version)
      const payload = Buffer.from([0, 0xff, 0x80, 0xc2, 0x8a])
      transport.parser.add(clientFrame(9, payload))
      expect(errors).to.deep.equal([])
      expect(frames).to.have.length(1)
      expect(await decodePong(frames[0])).to.deep.equal(payload)
    })

    it('consumes an empty masked ping without corrupting subsequent messages', async () => {
      const { transport, frames, messages, errors } = transportFor(version)
      transport.parser.add(
        Buffer.concat([clientFrame(9), clientFrame(1, Buffer.from('2::'))])
      )
      expect(errors).to.deep.equal([])
      expect(messages).to.deep.equal(['2::'])
      expect(frames).to.have.length(1)
      expect(await decodePong(frames[0])).to.deep.equal(Buffer.alloc(0))
    })

    it('replies immediately even when the empty ping arrives byte by byte', async () => {
      const { transport, frames, errors } = transportFor(version)
      for (const byte of clientFrame(9))
        transport.parser.add(Buffer.from([byte]))
      expect(errors).to.deep.equal([])
      expect(frames).to.have.length(1)
      expect(await decodePong(frames[0])).to.deep.equal(Buffer.alloc(0))
    })

    it('preserves a fragmented message around an interleaved ping', async () => {
      const { transport, frames, messages, errors } = transportFor(version)
      transport.parser.add(clientFrame(1, Buffer.from('3:::before'), false))
      transport.parser.add(clientFrame(9, Buffer.from('keepalive')))
      transport.parser.add(clientFrame(0, Buffer.from('after')))
      expect(errors).to.deep.equal([])
      expect(messages).to.deep.equal(['3:::beforeafter'])
      expect(await decodePong(frames[0])).to.deep.equal(
        Buffer.from('keepalive')
      )
    })

    it('consumes unsolicited pongs without responding or losing later data', () => {
      const { transport, frames, messages, errors } = transportFor(version)
      transport.parser.add(
        Buffer.concat([
          clientFrame(10),
          clientFrame(10, Buffer.from([0xff, 0])),
          clientFrame(1, Buffer.from('2::')),
        ])
      )
      expect(errors).to.deep.equal([])
      expect(frames).to.deep.equal([])
      expect(messages).to.deep.equal(['2::'])
    })

    it('rejects fragmented and oversized control frames', () => {
      for (const frame of [
        clientFrame(9, Buffer.from('invalid'), false),
        clientFrame(9, Buffer.alloc(126)),
        clientFrame(10, Buffer.alloc(126)),
      ]) {
        const { transport, frames, errors } = transportFor(version)
        transport.parser.add(frame)
        expect(errors).not.to.deep.equal([])
        expect(frames).to.deep.equal([])
      }
    })
  }
)
