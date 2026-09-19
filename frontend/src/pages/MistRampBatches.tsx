import { useSearchParams } from '@solidjs/router'
import { createSignal, For, onMount, Show } from 'solid-js'
import { api } from '../api/client'
import type { MistRampBatch, MistRampBatchStatus, Room } from '../types'

const statusLabels: Record<MistRampBatchStatus, string> = {
  open: '进行中',
  complete: '已完成',
  abort: '已中止',
}

const empty = {
  roomId: '',
  startHumidity: '',
  targetHumidity: '',
  notes: '',
}

export default function MistRampBatches() {
  const [searchParams] = useSearchParams()
  const [rows, setRows] = createSignal<MistRampBatch[]>([])
  const [rooms, setRooms] = createSignal<Room[]>([])
  const [form, setForm] = createSignal({ ...empty })
  const [error, setError] = createSignal('')

  const filterRoomId = () => {
    const raw = Array.isArray(searchParams.roomId) ? searchParams.roomId[0] : searchParams.roomId
    const n = Number(raw)
    return Number.isInteger(n) && n > 0 ? n : null
  }

  async function load() {
    const rid = filterRoomId()
    const [batches, roomList] = await Promise.all([
      api<MistRampBatch[]>(rid ? `/api/mist-ramp-batches?roomId=${rid}` : '/api/mist-ramp-batches'),
      api<Room[]>('/api/rooms'),
    ])
    setRows(batches)
    setRooms(roomList)
    if (rid && !form().roomId) setForm({ ...form(), roomId: String(rid) })
  }

  onMount(() => {
    load().catch((e) => setError(e.message))
  })

  function roomLabel(roomId: number) {
    const r = rooms().find((x) => x.id === roomId)
    return r ? `${r.roomCode} · ${r.species}` : `#${roomId}`
  }

  async function onSubmit(e: Event) {
    e.preventDefault()
    setError('')
    try {
      await api('/api/mist-ramp-batches', {
        method: 'POST',
        body: JSON.stringify({
          roomId: Number(form().roomId),
          startHumidity: Number(form().startHumidity),
          targetHumidity: Number(form().targetHumidity),
          notes: form().notes || null,
        }),
      })
      setForm({ ...empty })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    }
  }

  async function complete(id: number) {
    if (!confirm('确认完结该补湿批次？将写入一条达标环境记录。')) return
    setError('')
    try {
      await api(`/api/mist-ramp-batches/${id}/complete`, { method: 'POST' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '完结失败')
    }
  }

  async function abort(id: number) {
    const reason = prompt('请输入中文中止原因')
    if (reason === null) return
    setError('')
    try {
      await api(`/api/mist-ramp-batches/${id}/abort`, {
        method: 'POST',
        body: JSON.stringify({ abortReason: reason }),
      })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '中止失败')
    }
  }

  return (
    <div>
      <header class="page-header">
        <h1>补湿批次</h1>
        <p class="muted">
          雾化补湿爬坡：startHumidity &lt; targetHumidity，幅度 ≤ 30；同室同时仅一条进行中
        </p>
      </header>
      {error() && <div class="error">{error()}</div>}

      <Show when={filterRoomId()}>
        <p class="muted">
          仅显示出菇室 #{filterRoomId()} 的批次 · <a href="/mist-ramp-batches">查看全部</a>
        </p>
      </Show>

      <form class="panel form-grid" onSubmit={onSubmit}>
        <label>
          出菇室
          <select
            value={form().roomId}
            onChange={(e) => setForm({ ...form(), roomId: e.currentTarget.value })}
            required
          >
            <option value="">选择出菇室</option>
            <For each={rooms()}>
              {(r) => (
                <option value={String(r.id)}>
                  {r.roomCode} · {r.species}（{r.status}）
                </option>
              )}
            </For>
          </select>
        </label>
        <label>
          起始湿度 (%)
          <input
            type="number"
            min="1"
            max="100"
            value={form().startHumidity}
            onInput={(e) => setForm({ ...form(), startHumidity: e.currentTarget.value })}
            required
          />
        </label>
        <label>
          目标湿度 (%)
          <input
            type="number"
            min="1"
            max="100"
            value={form().targetHumidity}
            onInput={(e) => setForm({ ...form(), targetHumidity: e.currentTarget.value })}
            required
          />
        </label>
        <label class="span-2">
          备注（sanitize 室必填）
          <input
            value={form().notes}
            onInput={(e) => setForm({ ...form(), notes: e.currentTarget.value })}
          />
        </label>
        <button type="submit" class="btn primary">
          开补湿批次
        </button>
      </form>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>出菇室</th>
              <th>起始湿度</th>
              <th>目标湿度</th>
              <th>状态</th>
              <th>开启时间</th>
              <th>关闭时间</th>
              <th>中止原因</th>
              <th>备注</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>
              {(b) => (
                <tr>
                  <td>{b.id}</td>
                  <td>{roomLabel(b.roomId)}</td>
                  <td>{b.startHumidity}%</td>
                  <td>{b.targetHumidity}%</td>
                  <td>
                    <span class={`badge mist-${b.status}`}>{statusLabels[b.status]}</span>
                  </td>
                  <td>{new Date(b.openedAt).toLocaleString()}</td>
                  <td>{b.closedAt ? new Date(b.closedAt).toLocaleString() : '—'}</td>
                  <td>{b.abortReason || '—'}</td>
                  <td>{b.notes || '—'}</td>
                  <td>
                    <Show when={b.status === 'open'}>
                      <button type="button" class="btn ghost" onClick={() => complete(b.id)}>
                        完结
                      </button>
                      <button type="button" class="btn ghost" onClick={() => abort(b.id)}>
                        中止
                      </button>
                    </Show>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </div>
  )
}
