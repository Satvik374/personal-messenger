import { Avatar } from './Avatar'

export interface PopupPayload {
  senderName: string
  senderAccent: string
  body: string
  count: number
  durationMs: number
}

export function PopupCard({ payload }: { payload: PopupPayload }) {
  return (
    <div className="popup-root">
      <div className="popup-card">
        <Avatar user={{ displayName: payload.senderName, accent: payload.senderAccent }} />
        <div style={{ minWidth: 0 }}>
          <div className="popup-title">{payload.senderName}</div>
          <div className="popup-body">{payload.body}</div>
        </div>
        {payload.count > 1 ? <span className="popup-count">+{payload.count - 1} more</span> : null}
        <span
          className="popup-progress"
          style={{ animationDuration: `${payload.durationMs}ms` }}
        />
      </div>
    </div>
  )
}
