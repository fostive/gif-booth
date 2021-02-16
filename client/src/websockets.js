const HOST = window.location.origin.replace(/^http/, 'ws')

if (process.env.NODE_ENV === 'development') HOST.replace('3000', '3001')

export const ws = new WebSocket(HOST)

export const onWsEvent = (eventId, callback) => {
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data)
    if (data.id === eventId) callback(data)
  }
}
